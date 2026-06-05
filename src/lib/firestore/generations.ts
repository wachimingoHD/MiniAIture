// Colección `generations` (doc §1.2)
// =============================================================================
// Cada documento representa una imagen generada. Reemplaza al array `gallery`
// que antes vivía dentro del documento de usuario.
//
// Timestamps como ISO string para mantener la convención del resto del repo
// (ver schema.ts). Los índices compuestos requeridos están documentados en
// firestore.indexes.json.
// =============================================================================

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { GENERATIONS_COLLECTION } from "./schema";

export type StyleType = "preset" | "custom" | "gallery";
export type GenerationProvider = "gemini" | "fal";
export type GenerationMode = "normal" | "flex" | "fetch";
export type GenerationResolution = 512 | 1024;

export interface Generation {
  userId: string;
  videoTitle: string | null;
  userPrompt: string; // lo que escribió el usuario
  enhancedPrompt: string; // prompt final que generó el LLM
  referenceImageUrl: string | null;
  referenceInstructions: string | null;
  styleType: StyleType;
  styleId: string | null; // ID del preset o generationId de galería si usa estilo ajeno
  stylePrompt: string; // texto del estilo visual usado
  imageUrl: string;
  provider: GenerationProvider;
  resolution: GenerationResolution;
  mode: GenerationMode;
  creditsUsed: number;
  isPublic: boolean;
  publishedAt: string | null;
  timesStyleCopied: number;
  nicho: string | null;
  createdAt: string; // ISO string
}

export type NewGenerationInput = Omit<
  Generation,
  "isPublic" | "publishedAt" | "timesStyleCopied" | "createdAt"
> & {
  isPublic?: boolean;
  createdAt?: string;
};

// Construye un documento de generación con los defaults correctos.
export function buildGeneration(input: NewGenerationInput): Generation {
  return {
    userId: input.userId,
    videoTitle: input.videoTitle ?? null,
    userPrompt: input.userPrompt,
    enhancedPrompt: input.enhancedPrompt,
    referenceImageUrl: input.referenceImageUrl ?? null,
    referenceInstructions: input.referenceInstructions ?? null,
    styleType: input.styleType,
    styleId: input.styleId ?? null,
    stylePrompt: input.stylePrompt,
    imageUrl: input.imageUrl,
    provider: input.provider,
    resolution: input.resolution,
    mode: input.mode,
    creditsUsed: input.creditsUsed,
    isPublic: input.isPublic ?? false,
    publishedAt: null,
    timesStyleCopied: 0,
    nicho: input.nicho ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

// Crea el documento en Firestore y devuelve su id.
export async function createGeneration(
  db: Firestore,
  input: NewGenerationInput,
): Promise<{ id: string; generation: Generation }> {
  const generation = buildGeneration(input);
  const ref = await db.collection(GENERATIONS_COLLECTION).add(generation);
  return { id: ref.id, generation };
}

export interface GenerationWithId extends Generation {
  id: string;
}

function withId(doc: FirebaseFirestore.QueryDocumentSnapshot): GenerationWithId {
  return { id: doc.id, ...(doc.data() as Generation) };
}

// Galería personal (doc §5.1): generaciones del usuario, más recientes primero.
// `limit` acota (FREE -> 30); `startAfterCreatedAt` permite paginación PRO.
export async function getUserGenerations(
  db: Firestore,
  uid: string,
  opts: { limit: number; startAfterCreatedAt?: string },
): Promise<GenerationWithId[]> {
  let q = db
    .collection(GENERATIONS_COLLECTION)
    .where("userId", "==", uid)
    .orderBy("createdAt", "desc");
  if (opts.startAfterCreatedAt) q = q.startAfter(opts.startAfterCreatedAt);
  const snap = await q.limit(opts.limit).get();
  return snap.docs.map(withId);
}

// Galería pública (doc §6.2): isPublic == true, paginación por cursor.
export async function getPublicGenerations(
  db: Firestore,
  opts: { limit: number; startAfterCreatedAt?: string; orderBy?: "createdAt" | "timesStyleCopied" },
): Promise<GenerationWithId[]> {
  const orderField = opts.orderBy ?? "createdAt";
  let q = db
    .collection(GENERATIONS_COLLECTION)
    .where("isPublic", "==", true)
    .orderBy(orderField, "desc");
  if (opts.startAfterCreatedAt) q = q.startAfter(opts.startAfterCreatedAt);
  const snap = await q.limit(opts.limit).get();
  return snap.docs.map(withId);
}

export async function getGenerationById(
  db: Firestore,
  id: string,
): Promise<GenerationWithId | null> {
  const snap = await db.collection(GENERATIONS_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Generation) };
}

// Publicar en galería pública (doc §6.1). Solo el propietario.
export async function publishGeneration(
  db: Firestore,
  args: { id: string; uid: string },
): Promise<{ ok: boolean; reason?: "NOT_FOUND" | "FORBIDDEN" }> {
  const ref = db.collection(GENERATIONS_COLLECTION).doc(args.id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "NOT_FOUND" as const };
    const gen = snap.data() as Generation;
    if (gen.userId !== args.uid) return { ok: false, reason: "FORBIDDEN" as const };
    tx.set(
      ref,
      { isPublic: true, publishedAt: new Date().toISOString() } as Partial<Generation>,
      { merge: true },
    );
    return { ok: true };
  });
}

// Incrementa el contador de usos del estilo (doc §6.3).
export async function incrementTimesStyleCopied(db: Firestore, id: string): Promise<void> {
  await db
    .collection(GENERATIONS_COLLECTION)
    .doc(id)
    .set({ timesStyleCopied: FieldValue.increment(1) }, { merge: true });
}
