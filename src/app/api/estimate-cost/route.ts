import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  validateGenerationRequest,
  upscaleIsHigherThanBase,
  type CostEstimateResponse,
  type EstimateBlock,
  type UpscaleEstimate,
} from "@/lib/nanoBanana";
import {
  estimateGoogleTokens,
  GOOGLE_MODEL,
} from "@/lib/google";
import {
  computeFalCostSummary,
  computeTokenCostSummary,
  computeUpscaleCost,
  extractFalUnitPrice,
  fetchFalPricing,
} from "@/lib/cost";
import {
  FAL_GEN_EDIT_MODEL,
  FAL_GEN_MODEL,
  FAL_UPSCALE_MODEL,
} from "@/lib/fal";
import { verifyIdToken } from "@/lib/auth/firebase-admin";
import { readBearerToken } from "@/lib/server/request";

export const runtime = "nodejs";

interface CacheEntry {
  ts: number;
  payload: CostEstimateResponse;
}
const ESTIMATE_CACHE_TTL_MS = 30_000;
const ESTIMATE_CACHE_MAX = 200;
const estimateCache = new Map<string, CacheEntry>();

function bodyHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function readCache(key: string): CostEstimateResponse | null {
  const entry = estimateCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ESTIMATE_CACHE_TTL_MS) {
    estimateCache.delete(key);
    return null;
  }
  return entry.payload;
}

function writeCache(key: string, payload: CostEstimateResponse): void {
  if (estimateCache.size >= ESTIMATE_CACHE_MAX) {
    const oldestKey = estimateCache.keys().next().value;
    if (oldestKey) estimateCache.delete(oldestKey);
  }
  estimateCache.set(key, { ts: Date.now(), payload });
}

export async function POST(req: NextRequest): Promise<NextResponse<CostEstimateResponse | { error: string }>> {
  // Authentication required: this endpoint hits Google's countTokens API and
  // accepts up to 5MB of base64 references — leaving it open is a free DoS
  // vector against our Gemini quota.
  const token = readBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const user = await verifyIdToken(token);
  if (!user) {
    return NextResponse.json({ error: "Invalid or expired auth token." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const validation = validateGenerationRequest(body);
  if (!validation.ok) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }
  const { params, referenceImages } = validation.value;

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured." }, { status: 500 });
  }

  // Per-user cache to absorb the keystroke-debounced calls from the UI
  // without re-billing Gemini countTokens for the same input.
  const cacheKey = `${user.uid}:${bodyHash({ params, referenceImages })}`;
  const cached = readCache(cacheKey);
  if (cached) return NextResponse.json(cached);

  // ---------------- Upscale block (computed first, reused in both totals) ----------------
  const pricing = await fetchFalPricing();

  const willUpscale =
    params.upscale_enabled &&
    upscaleIsHigherThanBase(params.resolution, params.upscale_resolution);

  let upscale: UpscaleEstimate;
  if (willUpscale) {
    const apiUnitPricePerMp = extractFalUnitPrice(pricing, FAL_UPSCALE_MODEL);
    const upscaleCost = computeUpscaleCost({
      numImages: params.num_images,
      upscaleResolution: params.upscale_resolution,
      apiUnitPricePerMp,
    });
    upscale = {
      enabled: true,
      targetResolution: params.upscale_resolution,
      estimatedCostPerImage: upscaleCost.perImage,
      totalEstimatedCost: upscaleCost.totalUpscaleCost,
      notes: upscaleCost.notes.join(" "),
    };
  } else {
    upscale = {
      enabled: false,
      targetResolution: null,
      estimatedCostPerImage: 0,
      totalEstimatedCost: 0,
      notes: params.upscale_enabled
        ? "Upscale enabled but target not higher than base; skipped."
        : "Upscale disabled.",
    };
  }

  // ---------------- Google estimate ----------------
  const tokens = await estimateGoogleTokens({
    params,
    referenceImages,
    apiKey: geminiKey,
  });
  const googleCostSummary = computeTokenCostSummary(
    {
      inputTokens: tokens.inputTokens,
      outputTextTokens: tokens.outputTextTokens,
      outputImageTokens: tokens.outputImageTokens,
    },
    params.flex_mode ? "flex" : "standard",
    params.num_images,
    params.enable_google_search,
  );

  const googleTotal = googleCostSummary.total + upscale.totalEstimatedCost;
  const googleBlock: EstimateBlock = {
    total: googleTotal,
    perImage: params.num_images > 0 ? googleTotal / params.num_images : googleTotal,
    breakdown: { ...googleCostSummary.breakdown, upscaleCost: upscale.totalEstimatedCost },
    includesUpscale: willUpscale,
    notes: [
      `Model: ${GOOGLE_MODEL}`,
      `Token source: ${tokens.source}`,
      ...googleCostSummary.notes,
    ],
  };

  // ---------------- fal estimate ----------------
  const falEndpoint = referenceImages.length > 0 ? FAL_GEN_EDIT_MODEL : FAL_GEN_MODEL;
  const apiUnitPriceUsd = extractFalUnitPrice(pricing, falEndpoint);
  const falCostSummary = computeFalCostSummary({
    numImages: params.num_images,
    resolution: params.resolution,
    enableWebSearch: params.enable_google_search,
    apiUnitPriceUsd,
  });

  const falTotal = falCostSummary.total + upscale.totalEstimatedCost;
  const falBlock: EstimateBlock = {
    total: falTotal,
    perImage: params.num_images > 0 ? falTotal / params.num_images : falTotal,
    breakdown: { ...falCostSummary.breakdown, upscaleCost: upscale.totalEstimatedCost },
    includesUpscale: willUpscale,
    notes: [`Endpoint: ${falEndpoint}`, ...falCostSummary.notes],
  };

  const payload: CostEstimateResponse = {
    upscale,
    google: googleBlock,
    fal: falBlock,
  };
  writeCache(cacheKey, payload);

  return NextResponse.json(payload);
}
