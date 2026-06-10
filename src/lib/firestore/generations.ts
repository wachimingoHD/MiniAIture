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

// DTO público: SOLO los campos seguros para exponer sin autenticación.
// Nunca incluir userId, enhancedPrompt, creditsUsed, provider, mode, etc.
// El stylePrompt solo se expone si el estilo es propio (custom) — doc §6.3.
export interface PublicGenerationDTO {
  id: string;
  imageUrl: string;
  userPrompt: string;
  styleType: StyleType;
  stylePrompt: string | null;
  nicho: string | null;
  timesStyleCopied: number;
  createdAt: string;
  authorName?: string;
}

export function toPublicDTO(gen: GenerationWithId, authorName?: string): PublicGenerationDTO {
  return {
    id: gen.id,
    imageUrl: gen.imageUrl,
    userPrompt: gen.userPrompt,
    styleType: gen.styleType,
    stylePrompt: gen.styleType === "custom" ? gen.stylePrompt : null,
    nicho: gen.nicho,
    timesStyleCopied: gen.timesStyleCopied,
    createdAt: gen.createdAt,
    ...(authorName ? { authorName } : {}),
  };
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

// Muestreo ALEATORIO eficiente de generaciones públicas (banner de la landing
// y modo aleatorio de la galería). Truco estándar de Firestore: se genera un id
// de documento aleatorio y se usa como cursor sobre __name__, con vuelta al
// principio si no se llena el cupo. Máximo 2 consultas de `limit` docs cada una
// — nunca se lee la colección entera, da igual cuántas miniaturas haya.
export async function getRandomPublicGenerations(
  db: Firestore,
  opts: { limit: number },
): Promise<GenerationWithId[]> {
  const randomId = db.collection(GENERATIONS_COLLECTION).doc().id;
  const base = db.collection(GENERATIONS_COLLECTION).where("isPublic", "==", true);

  const first = await base.orderBy("__name__").startAt(randomId).limit(opts.limit).get();
  let docs = first.docs;
  if (docs.length < opts.limit) {
    const wrap = await base
      .orderBy("__name__")
      .endBefore(randomId)
      .limit(opts.limit - docs.length)
      .get();
    docs = [...docs, ...wrap.docs];
  }

  // Barajado Fisher-Yates: el cursor devuelve ids consecutivos (correlacionados
  // entre sí); el shuffle rompe ese orden para que el grid se vea aleatorio.
  const items = docs.map(withId);
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// Para el sitemap: ids + fecha de TODAS las generaciones públicas (campo mínimo).
// Usa el índice isPublic+createdAt. `max` acota por seguridad (el límite por
// sitemap de Google es 50.000 URLs).
export async function getAllPublicGenerationIds(
  db: Firestore,
  max = 5000,
): Promise<{ id: string; createdAt: string }[]> {
  const snap = await db
    .collection(GENERATIONS_COLLECTION)
    .where("isPublic", "==", true)
    .orderBy("createdAt", "desc")
    .limit(max)
    .select("createdAt")
    .get();
  return snap.docs.map((d) => ({
    id: d.id,
    createdAt: (d.data() as { createdAt?: string }).createdAt ?? new Date().toISOString(),
  }));
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

// Despublicar: vuelve la generación privada. Solo el propietario (cualquier plan).
export async function unpublishGeneration(
  db: Firestore,
  args: { id: string; uid: string },
): Promise<{ ok: boolean; reason?: "NOT_FOUND" | "FORBIDDEN" }> {
  const ref = db.collection(GENERATIONS_COLLECTION).doc(args.id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "NOT_FOUND" as const };
    const gen = snap.data() as Generation;
    if (gen.userId !== args.uid) return { ok: false, reason: "FORBIDDEN" as const };
    tx.set(ref, { isPublic: false, publishedAt: null } as Partial<Generation>, { merge: true });
    return { ok: true };
  });
}

// Borrar una generación. Solo el propietario. Devuelve la imageUrl para que el
// llamante limpie también el objeto en Storage.
export async function deleteGeneration(
  db: Firestore,
  args: { id: string; uid: string },
): Promise<{ ok: boolean; reason?: "NOT_FOUND" | "FORBIDDEN"; imageUrl?: string }> {
  const ref = db.collection(GENERATIONS_COLLECTION).doc(args.id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "NOT_FOUND" as const };
    const gen = snap.data() as Generation;
    if (gen.userId !== args.uid) return { ok: false, reason: "FORBIDDEN" as const };
    tx.delete(ref);
    return { ok: true, imageUrl: gen.imageUrl };
  });
}

// Incrementa el contador de usos del estilo (doc §6.3).
export async function incrementTimesStyleCopied(db: Firestore, id: string): Promise<void> {
  await db
    .collection(GENERATIONS_COLLECTION)
    .doc(id)
    .set({ timesStyleCopied: FieldValue.increment(1) }, { merge: true });
}
