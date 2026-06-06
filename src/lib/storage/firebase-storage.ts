import { getStorage } from "firebase-admin/storage";
import { getAdminApp } from "@/lib/auth/firebase-admin";

export interface FirebaseStorageConfig {
  bucketName: string;
}

export function getFirebaseStorageConfig(): FirebaseStorageConfig | null {
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET ??
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) return null;
  return { bucketName };
}

export interface UploadImageInput {
  uid: string;
  data: string; // base64
  mimeType: string;
}

export interface UploadImageResult {
  publicUrl: string;
  key: string;
}

export async function uploadGalleryImage(input: UploadImageInput): Promise<UploadImageResult> {
  const cfg = getFirebaseStorageConfig();
  const app = getAdminApp();
  if (!cfg || !app) {
    throw new Error("Firebase Storage is not configured. Set FIREBASE_STORAGE_BUCKET.");
  }

  const ext = mimeToExt(input.mimeType);
  const key = `users/${input.uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const token = crypto.randomUUID();
  const bytes = Buffer.from(input.data, "base64");

  const bucket = getStorage(app).bucket(cfg.bucketName);
  const file = bucket.file(key);
  await file.save(bytes, {
    contentType: input.mimeType,
    resumable: false,
    metadata: {
      cacheControl: "public, max-age=31536000, immutable",
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  const encodedPath = encodeURIComponent(key);
  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${cfg.bucketName}/o/${encodedPath}?alt=media&token=${token}`;

  return {
    key,
    publicUrl,
  };
}

// Extrae la key del objeto a partir de la URL pública de Firebase Storage
// (https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encodedKey>?...).
export function storageKeyFromUrl(url: string): string | null {
  const m = url.match(/\/o\/([^?]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

// Borra un objeto de Storage por su key. Best-effort (ignora "no existe").
export async function deleteGalleryImageByKey(key: string): Promise<void> {
  const cfg = getFirebaseStorageConfig();
  const app = getAdminApp();
  if (!cfg || !app) return;
  try {
    await getStorage(app).bucket(cfg.bucketName).file(key).delete({ ignoreNotFound: true });
  } catch {
    /* best-effort */
  }
}

function mimeToExt(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}
