// Phase 2 - Firebase client (browser-side)
// =============================================================================
// This module sets up Firebase Auth (Google Sign-In) and Firebase App Check
// in the browser. It's imported by the auth context and by client-side code
// that needs the current user's ID token.
//
// To activate Phase 2:
//   1. Create a Firebase project at https://console.firebase.google.com
//   2. Enable Google Sign-In in Authentication > Sign-in method
//   3. Register a Web App and copy the config into .env.local (NEXT_PUBLIC_*)
//   4. Enable App Check with reCAPTCHA v3 and add the site key to .env.local
//   5. Install firebase: `npm install firebase`
//   6. Uncomment the implementation below
// =============================================================================

// import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
// import {
//   getAuth,
//   GoogleAuthProvider,
//   signInWithPopup,
//   signOut,
//   onAuthStateChanged,
//   type Auth,
//   type User,
// } from "firebase/auth";
// import {
//   initializeAppCheck,
//   ReCaptchaV3Provider,
// } from "firebase/app-check";

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  appCheckSiteKey?: string;
}

export function getFirebaseClientConfig(): FirebaseClientConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
    appCheckSiteKey: process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY,
  };
}

// TODO[Phase 2]: implement
export function getFirebaseApp(): null {
  return null;
}

export async function signInWithGoogle(): Promise<never> {
  throw new Error("Firebase Auth not implemented yet (Phase 2).");
}

export async function signOutUser(): Promise<void> {
  // no-op until Phase 2
}

export async function getCurrentIdToken(): Promise<string | null> {
  return null;
}
