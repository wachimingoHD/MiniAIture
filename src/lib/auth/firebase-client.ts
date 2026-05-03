import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  appCheckSiteKey?: string;
}

let appCheckInitialized = false;

export function getFirebaseClientConfig(): FirebaseClientConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  if (!apiKey || !authDomain || !projectId || !storageBucket || !messagingSenderId || !appId) {
    return null;
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    appCheckSiteKey: process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY,
  };
}

export function getFirebaseApp(): FirebaseApp | null {
  const cfg = getFirebaseClientConfig();
  if (!cfg) return null;

  const app = getApps()[0] ?? initializeApp(cfg);
  if (!appCheckInitialized && cfg.appCheckSiteKey && typeof window !== "undefined") {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(cfg.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckInitialized = true;
  }

  return app;
}

export async function signInWithGoogle(): Promise<User> {
  const app = getFirebaseApp();
  if (!app) {
    throw new Error("Firebase client config missing. Set NEXT_PUBLIC_FIREBASE_* env vars.");
  }
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  const credential = await signInWithPopup(auth, provider);
  return credential.user;
}

export async function signOutUser(): Promise<void> {
  const app = getFirebaseApp();
  if (!app) return;
  await signOut(getAuth(app));
}

export async function getCurrentIdToken(): Promise<string | null> {
  const app = getFirebaseApp();
  if (!app) return null;
  const user = getAuth(app).currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export function subscribeToAuthState(listener: (user: User | null) => void): () => void {
  const app = getFirebaseApp();
  if (!app) {
    listener(null);
    return () => {};
  }
  return onAuthStateChanged(getAuth(app), listener);
}
