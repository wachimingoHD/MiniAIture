// One-off: borra TODOS los documentos de una colección. Dry-run por defecto.
//   node --env-file=.env.local --experimental-strip-types scripts/delete-collection.ts <coleccion>
//   ... add --commit para aplicar.
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const name = process.argv[2];
const commit = process.argv.includes("--commit");

function initAdmin() {
  if (getApps().length > 0) return;
  const raw = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!raw) throw new Error("Falta FIREBASE_ADMIN_CREDENTIALS.");
  const p = JSON.parse(raw) as Record<string, unknown>;
  if (typeof p.private_key === "string") p.private_key = p.private_key.replace(/\\n/g, "\n");
  initializeApp({ credential: cert(p as Parameters<typeof cert>[0]) });
}

async function main() {
  if (!name) throw new Error("Uso: delete-collection.ts <coleccion> [--commit]");
  initAdmin();
  const db = getFirestore();
  const snap = await db.collection(name).get();
  console.log(`Colección "${name}": ${snap.size} documentos.`);
  if (!commit) {
    console.log("DRY-RUN: nada borrado. Añade --commit para aplicar.");
    return;
  }
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  console.log(`Borrados ${snap.size} documentos de "${name}".`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Fallo:", err);
  process.exit(1);
});
