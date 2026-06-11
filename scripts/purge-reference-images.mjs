// Purga las imágenes de referencia que se persistieron en el pasado.
//
// Desde 2026-06-11 las imágenes de referencia NO se guardan (solo se envían al
// proveedor de IA y se descartan). Este script limpia las antiguas: recorre
// `generations` con referenceImageUrl != null, borra el objeto de Storage y
// pone el campo a null. Es idempotente: se puede relanzar sin peligro.
//
// Uso:
//   node scripts/purge-reference-images.mjs           (dry-run: solo lista)
//   node scripts/purge-reference-images.mjs --apply   (borra de verdad)

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const apply = process.argv.includes("--apply");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);

initializeApp({ credential: cert(JSON.parse(env.FIREBASE_ADMIN_CREDENTIALS)) });
const db = getFirestore();
const bucketName = env.FIREBASE_STORAGE_BUCKET || env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
if (!bucketName) {
  console.error("Falta FIREBASE_STORAGE_BUCKET en .env.local");
  process.exit(1);
}
const bucket = getStorage().bucket(bucketName);

// Extrae la key del objeto desde la URL pública de Firebase Storage.
function keyFromUrl(url) {
  const m = url.match(/\/o\/([^?]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

const snap = await db.collection("generations").where("referenceImageUrl", "!=", null).get();
console.log(`${snap.size} generaciones con imagen de referencia guardada.`);

let deleted = 0;
for (const doc of snap.docs) {
  const url = doc.data().referenceImageUrl;
  const key = typeof url === "string" ? keyFromUrl(url) : null;
  if (!apply) {
    console.log(`[dry-run] ${doc.id} -> ${key ?? "(url no reconocida)"}`);
    continue;
  }
  if (key) {
    try { await bucket.file(key).delete({ ignoreNotFound: true }); } catch {}
  }
  await doc.ref.update({ referenceImageUrl: null });
  deleted += 1;
}

console.log(apply ? `Hecho: ${deleted} limpiadas.` : "Dry-run. Relanza con --apply para borrar.");
process.exit(0);
