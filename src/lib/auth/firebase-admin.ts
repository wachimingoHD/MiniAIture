// Phase 2 - Firebase Admin (server-side)
// =============================================================================
// Initializes Firebase Admin SDK for server-side token verification and
// Firestore writes. The admin credential should be a JSON service account
// stored as a single-line env var FIREBASE_ADMIN_CREDENTIALS.
//
// To activate Phase 2:
//   1. In Firebase console > Project settings > Service accounts, generate a
//      new private key. Save the JSON content (single line) into .env.local
//      as FIREBASE_ADMIN_CREDENTIALS.
//   2. Install: `npm install firebase-admin`
//   3. Uncomment the implementation below.
// =============================================================================

// import {
//   initializeApp,
//   cert,
//   getApps,
//   type App,
// } from "firebase-admin/app";
// import { getAuth, type Auth } from "firebase-admin/auth";
// import { getFirestore, type Firestore } from "firebase-admin/firestore";

export interface VerifiedUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
}

export async function verifyIdToken(_idToken: string): Promise<VerifiedUser | null> {
  // TODO[Phase 2]: replace with admin.auth().verifyIdToken(idToken)
  return null;
}

export function adminFirestore(): null {
  // TODO[Phase 2]: replace with admin.firestore()
  return null;
}
