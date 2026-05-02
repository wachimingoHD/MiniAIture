import { NextRequest, NextResponse } from "next/server";
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

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse<CostEstimateResponse | { error: string }>> {
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

  return NextResponse.json({
    upscale,
    google: googleBlock,
    fal: falBlock,
  } satisfies CostEstimateResponse);
}
