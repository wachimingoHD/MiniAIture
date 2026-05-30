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
