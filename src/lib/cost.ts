// Cost calculation module.
// Handles Google token-based pricing, fal rate-based pricing, and merging
// upscale costs into the generation cost.

import type {
  CostBreakdown,
  CostSummary,
  NanoBananaParams,
  Resolution,
  ServiceTier,
  UpscaleResolution,
} from "./nanoBanana";
import { UPSCALE_TARGET_MP } from "./nanoBanana";

// USD per 1M tokens
export const GOOGLE_PRICING_USD_PER_1M = {
  standard: { input: 0.5, outputText: 3, outputImage: 60 },
  flex: { input: 0.25, outputText: 1.5, outputImage: 30 },
} as const;

export const RESOLUTION_MULTIPLIER: Record<Resolution, number> = {
  "512": 0.75,
  "1K": 1,
  "2K": 1.5,
  "4K": 2,
};

export const FAL_BASE_USD_FALLBACK = 0.08;
export const FAL_UPSCALE_USD_PER_MP_FALLBACK = 0.001;
export const GOOGLE_SEARCH_EXTRA_USD_PER_REQUEST = 0.015;

export interface GoogleTokenUsage {
  inputTokens: number;
  outputTextTokens: number;
  outputImageTokens: number;
}

export function computeTokenCostSummary(
  usage: GoogleTokenUsage,
  tier: ServiceTier,
  numImages: number,
  enableSearch: boolean,
): CostSummary {
  const pricing = GOOGLE_PRICING_USD_PER_1M[tier];
  const inputCost = (usage.inputTokens * pricing.input) / 1_000_000;
  const outputTextCost = (usage.outputTextTokens * pricing.outputText) / 1_000_000;
  const outputImageCost = (usage.outputImageTokens * pricing.outputImage) / 1_000_000;
  const total = inputCost + outputTextCost + outputImageCost;

  const notes: string[] = [];
  notes.push(`Google ${tier} pricing applied (token usage from API).`);
  if (enableSearch) {
    notes.push(
      "google_search tool may incur extra Google charges not modelled here.",
    );
  }

  return {
    total,
    perImage: numImages > 0 ? total / numImages : total,
    currency: "USD",
    method: "token_usage_estimate",
    notes,
    breakdown: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTextTokens + usage.outputImageTokens,
      inputCost,
      outputCost: outputTextCost + outputImageCost,
    },
  };
}

export interface FalCostInput {
  numImages: number;
  resolution: Resolution;
  enableWebSearch: boolean;
  apiUnitPriceUsd?: number; // pulled from fal pricing API if available
}

export function computeFalCostSummary(input: FalCostInput): CostSummary {
  const base = input.apiUnitPriceUsd ?? FAL_BASE_USD_FALLBACK;
  const multiplier = RESOLUTION_MULTIPLIER[input.resolution];
  const webSearchExtra = input.enableWebSearch
    ? GOOGLE_SEARCH_EXTRA_USD_PER_REQUEST * input.numImages
    : 0;
  const perImage = base * multiplier;
  const total = perImage * input.numImages + webSearchExtra;

  const notes: string[] = [];
  notes.push(
    input.apiUnitPriceUsd != null
      ? "fal pricing fetched live from fal pricing API."
      : `fal pricing fallback used (${FAL_BASE_USD_FALLBACK} USD base).`,
  );
  if (input.enableWebSearch) {
    notes.push(`enable_web_search adds ${GOOGLE_SEARCH_EXTRA_USD_PER_REQUEST} USD/request.`);
  }

  return {
    total,
    perImage,
    currency: "USD",
    method: "fal_rate_formula",
    notes,
    breakdown: {
      baseCost: base,
      resolutionMultiplier: multiplier,
      webSearchExtra,
    },
    pricingSource: input.apiUnitPriceUsd != null ? "fal_api" : "static_fallback",
  };
}

export interface UpscaleCostInput {
  numImages: number;
  upscaleResolution: UpscaleResolution;
  apiUnitPricePerMp?: number;
  realImageMp?: number[];
}

export interface UpscaleCostResult {
  perImage: number;
  totalUpscaleCost: number;
  notes: string[];
  pricingSource: "fal_api" | "static_fallback";
}

export function computeUpscaleCost(input: UpscaleCostInput): UpscaleCostResult {
  const pricePerMp = input.apiUnitPricePerMp ?? FAL_UPSCALE_USD_PER_MP_FALLBACK;
  const fallbackMp = UPSCALE_TARGET_MP[input.upscaleResolution];
  const notes: string[] = [];

  let totalUpscaleCost = 0;
  if (input.realImageMp && input.realImageMp.length === input.numImages) {
    for (const mp of input.realImageMp) totalUpscaleCost += mp * pricePerMp;
    notes.push("Upscale cost computed using real image MP.");
  } else {
    totalUpscaleCost = pricePerMp * fallbackMp * input.numImages;
    notes.push(`Upscale cost estimated using ${fallbackMp} MP fallback per image.`);
  }
  notes.push(
    input.apiUnitPricePerMp != null
      ? "Upscale price-per-MP from fal pricing API."
      : `Upscale price-per-MP fallback (${FAL_UPSCALE_USD_PER_MP_FALLBACK} USD/MP).`,
  );

  return {
    perImage: input.numImages > 0 ? totalUpscaleCost / input.numImages : totalUpscaleCost,
    totalUpscaleCost,
    notes,
    pricingSource: input.apiUnitPricePerMp != null ? "fal_api" : "static_fallback",
  };
}

export function mergeCostWithUpscale(
  base: CostSummary,
  upscale: UpscaleCostResult,
  numImages: number,
): CostSummary {
  const total = base.total + upscale.totalUpscaleCost;
  const breakdown: CostBreakdown = { ...base.breakdown, upscaleCost: upscale.totalUpscaleCost };
  return {
    total,
    perImage: numImages > 0 ? total / numImages : total,
    currency: "USD",
    method: "merged",
    notes: [...base.notes, ...upscale.notes],
    breakdown,
    pricingSource: upscale.pricingSource,
  };
}

// ---------------------------------------------------------------------------
// fal.ai pricing API client (server-side)
// ---------------------------------------------------------------------------

interface PricingCacheEntry {
  ts: number;
  data: Record<string, unknown>;
}

let pricingCache: PricingCacheEntry | null = null;
const PRICING_TTL_MS = 5 * 60 * 1000;

export async function fetchFalPricing(): Promise<Record<string, unknown> | null> {
  if (pricingCache && Date.now() - pricingCache.ts < PRICING_TTL_MS) {
    return pricingCache.data;
  }
  try {
    const res = await fetch("https://api.fal.ai/v1/models/pricing", {
      headers: process.env.FAL_API_KEY
        ? { Authorization: `Key ${process.env.FAL_API_KEY}` }
        : undefined,
      // pricing API is public-ish, but auth never hurts
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    pricingCache = { ts: Date.now(), data };
    return data;
  } catch {
    return null;
  }
}

export function extractFalUnitPrice(
  pricing: Record<string, unknown> | null,
  modelId: string,
): number | undefined {
  if (!pricing) return undefined;
  const node = pricing[modelId];
  if (!node || typeof node !== "object") return undefined;
  const obj = node as Record<string, unknown>;
  if (typeof obj.unit_price === "number") return obj.unit_price;
  if (typeof obj.price === "number") return obj.price;
  if (typeof obj.usd_per_image === "number") return obj.usd_per_image;
  if (typeof obj.usd_per_mp === "number") return obj.usd_per_mp;
  return undefined;
}

export function buildEstimateNote(params: NanoBananaParams): string {
  const bits: string[] = [];
  bits.push(`${params.num_images} image(s)`);
  bits.push(`resolution ${params.resolution}`);
  bits.push(`aspect ${params.aspect_ratio}`);
  if (params.flex_mode) bits.push("flex tier");
  if (params.enable_google_search) bits.push("google_search on");
  return bits.join(", ");
}
