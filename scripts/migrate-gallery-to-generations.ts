// Migración: gallery[] (en users) -> colección generations (doc §1.6)
// =============================================================================
// Reglas del documento:
//   1. Leer todos los users con campo `gallery`.
//   2. Por cada entrada del array, crear un doc en `generations` con los campos
//      disponibles (rellenar los nuevos con null / defaults).
//   3. Sólo tras confirmar la copia, eliminar el campo `gallery` de cada user.
//   4. NO borrar nada hasta verificar. Primero copiar, verificar, luego limpiar.
//
// Por eso el script tiene 3 fases y es dry-run por defecto:
//   node --experimental-strip-types scripts/migrate-gallery-to-generations.ts copy
//   node --experimental-strip-types scripts/migrate-gallery-to-generations.ts copy --commit
//   node --experimental-strip-types scripts/migrate-gallery-to-generations.ts verify
//   node --experimental-strip-types scripts/migrate-gallery-to-generations.ts cleanup --commit
//
// La fase `copy` usa un id determinista por entrada (`${uid}__mig__${i}`) para
// ser idempotente: re-ejecutarla no crea duplicados.
//
// Requiere FIREBASE_ADMIN_CREDENTIALS en el entorno (mismo JSON que usa la app).
// =============================================================================

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

type Phase = "copy" | "verify" | "cleanup";

const phase = (process.argv[2] ?? "copy") as Phase;
const commit = process.argv.includes("--commit");

function initAdmin() {
  if (getApps().length > 0) return;
  const raw = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!raw) {
    throw new Error("Falta FIREBASE_ADMIN_CREDENTIALS en el entorno.");
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  initializeApp({ credential: cert(parsed as Parameters<typeof cert>[0]) });
}

interface LegacyImageEntry {
  url?: string;
  prompt?: string;
  createdAt?: string | number;
  provider?: string;
}

function mapProvider(p: string | undefined): "gemini" | "fal" {
  return p === "fal" ? "fal" : "gemini";
}

function toIso(value: string | number | undefined): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value).toISOString();
  return new Date().toISOString();
}

async function main() {
  initAdmin();
  const db = getFirestore();
  const usersSnap = await db.collection("users").get();

  let usersWithGallery = 0;
  let totalEntries = 0;
  let written = 0;
  let cleaned = 0;

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data() as { gallery?: LegacyImageEntry[] };
    const gallery = Array.isArray(data.gallery) ? data.gallery : [];
    if (gallery.length === 0) continue;
    usersWithGallery += 1;
    totalEntries += gallery.length;
    const uid = userDoc.id;

    if (phase === "copy") {
      for (let i = 0; i < gallery.length; i++) {
        const entry = gallery[i];
        if (!entry?.url) continue;
        const genId = `${uid}__mig__${i}`;
        const generation = {
          userId: uid,
          videoTitle: null,
          userPrompt: entry.prompt ?? "",
          enhancedPrompt: entry.prompt ?? "",
          referenceImageUrl: null,
          referenceInstructions: null,
          styleType: "custom" as const,
          styleId: null,
          stylePrompt: "",
          imageUrl: entry.url,
          provider: mapProvider(entry.provider),
          resolution: 1024 as const,
          mode: "normal" as const,
          creditsUsed: 0,
          isPublic: false,
          publishedAt: null,
          timesStyleCopied: 0,
          nicho: null,
          createdAt: toIso(entry.createdAt),
          migratedFrom: "gallery",
        };
        if (commit) {
          await db.collection("generations").doc(genId).set(generation, { merge: true });
        }
        written += 1;
      }
    }

    if (phase === "cleanup") {
      // Sólo limpiar si ya existen las generaciones migradas de este usuario.
      const migrated = await db
        .collection("generations")
        .where("userId", "==", uid)
        .where("migratedFrom", "==", "gallery")
        .limit(1)
        .get();
      if (migrated.empty) {
        console.warn(`[skip] ${uid}: no hay generaciones migradas; no se limpia gallery.`);
        continue;
      }
      if (commit) {
        await userDoc.ref.update({ gallery: FieldValue.delete() });
      }
      cleaned += 1;
    }
  }

  console.log(JSON.stringify({
    phase,
    commit,
    usersWithGallery,
    totalEntries,
    generationsWritten: written,
    usersCleaned: cleaned,
    note: commit ? "Cambios aplicados." : "DRY-RUN: nada escrito. Añade --commit para aplicar.",
  }, null, 2));

  if (phase === "verify") {
    const gensSnap = await db.collection("generations").where("migratedFrom", "==", "gallery").get();
    console.log(`Verificación: ${gensSnap.size} generaciones migradas existen en Firestore.`);
    console.log(`Esperadas (entradas de gallery): ${totalEntries}.`);
    console.log(gensSnap.size >= totalEntries ? "OK: copia completa." : "AVISO: faltan generaciones, NO ejecutes cleanup todavía.");
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Migración falló:", err);
  process.exit(1);
});
