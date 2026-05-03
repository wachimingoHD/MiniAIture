import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAppCheck } from "firebase-admin/app-check";

export interface VerifiedUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
}

let cachedApp: App | null | undefined;

function parseServiceAccountFromEnv(): Record<string, unknown> | null {
  const raw = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.private_key && typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getAdminApp(): App | null {
  if (cachedApp !== undefined) return cachedApp;

  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return cachedApp;
  }

  const serviceAccount = parseServiceAccountFromEnv();
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ??
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  try {
    cachedApp = serviceAccount
      ? initializeApp({
          credential: cert(serviceAccount as Parameters<typeof cert>[0]),
          storageBucket,
        })
      : initializeApp({ credential: applicationDefault(), storageBucket });
    return cachedApp;
  } catch {
    cachedApp = null;
    return null;
  }
}

export async function verifyIdToken(idToken: string): Promise<VerifiedUser | null> {
  const app = getAdminApp();
  if (!app) return null;
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: Boolean(decoded.email_verified),
    };
  } catch {
    return null;
  }
}

export function adminFirestore(): Firestore | null {
  const app = getAdminApp();
  if (!app) return null;
  return getFirestore(app);
}

export async function verifyAppCheckToken(token: string): Promise<boolean> {
  const app = getAdminApp();
  if (!app) return false;
  try {
    await getAppCheck(app).verifyToken(token);
    return true;
  } catch {
    return false;
  }
}
