// Edición de perfil: displayName (doc §7.2)
// =============================================================================
// PATCH /api/user/profile  { displayName }
// Valida formato + palabras ofensivas y garantiza unicidad (case-insensitive)
// mediante reservas atómicas en la colección `usernames` (doc id = nombre en
// minúsculas), todo dentro de una transacción.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getOrCreateUserDocument } from "@/lib/firestore/users";
import { USERS_COLLECTION, type UserDocument } from "@/lib/firestore/schema";
import { validateDisplayName } from "@/lib/profile/display-name";
import { readBearerToken } from "@/lib/server/request";

export const runtime = "nodejs";

const USERNAMES_COLLECTION = "usernames";

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const token = readBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });

  const user = await verifyIdToken(token);
  if (!user) return NextResponse.json({ error: "Invalid or expired auth token." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const displayNameRaw = (body as { displayName?: unknown })?.displayName;

  const validation = validateDisplayName(displayNameRaw);
  if (!validation.ok || !validation.normalized) {
    return NextResponse.json(
      { error: validation.message ?? "Invalid display name.", code: validation.error },
      { status: 400 },
    );
  }
  const newName = validation.normalized;
  const newLower = newName.toLowerCase();

  const db = adminFirestore();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin not configured. Set FIREBASE_ADMIN_CREDENTIALS." },
      { status: 500 },
    );
  }

  // Asegura que el doc del usuario existe antes de la transacción.
  await getOrCreateUserDocument(db, { uid: user.uid, email: user.email, displayName: user.name });

  try {
    await db.runTransaction(async (tx) => {
      const userRef = db.collection(USERS_COLLECTION).doc(user.uid);
      const newNameRef = db.collection(USERNAMES_COLLECTION).doc(newLower);

      const [userSnap, newNameSnap] = await Promise.all([tx.get(userRef), tx.get(newNameRef)]);

      if (newNameSnap.exists && (newNameSnap.data() as { uid?: string }).uid !== user.uid) {
        throw new Error("DISPLAY_NAME_TAKEN");
      }

      const current = userSnap.data() as UserDocument | undefined;
      const oldName = current?.displayName;
      const oldLower = oldName ? oldName.toLowerCase() : null;

      // Reserva el nuevo nombre y libera el anterior si cambió.
      tx.set(newNameRef, { uid: user.uid });
      if (oldLower && oldLower !== newLower) {
        tx.delete(db.collection(USERNAMES_COLLECTION).doc(oldLower));
      }
      tx.set(userRef, { displayName: newName } as Partial<UserDocument>, { merge: true });
    });
  } catch (err) {
    if ((err as Error).message === "DISPLAY_NAME_TAKEN") {
      return NextResponse.json({ error: "Ese nombre ya está en uso.", code: "TAKEN" }, { status: 409 });
    }
    return NextResponse.json({ error: "No se pudo actualizar el nombre." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, displayName: newName });
}
