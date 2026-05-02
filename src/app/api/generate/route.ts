import { NextRequest, NextResponse } from "next/server";
import {
  validateGenerationRequest,
  isGoogleCapacityFailure,
  shouldFallbackToFal,
  type FailureDetail,
  type GenerateResponse,
  type ReferenceImageMetadata,
  type GeneratedImage,
} from "@/lib/nanoBanana";
import { runGoogleGeneration, type GoogleResult } from "@/lib/google";
import { runFalGeneration, applyUpscaleIfEnabled } from "@/lib/fal";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateGenerationRequest(body);
  if (!validation.ok) {
    return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 400 });
  }
  const { params, referenceImages } = validation.value;

  const geminiKey = process.env.GEMINI_API_KEY;
  const falKey = process.env.FAL_API_KEY;
  const autoFallback =
    (process.env.AUTO_FALLBACK_TO_FAL ?? "true").toLowerCase() !== "false";

  if (!geminiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured on server." },
      { status: 500 },
    );
  }

  // ---------------- 1) Google primary attempt ----------------
  let googleResult: GoogleResult = await runGoogleGeneration({
    params,
    referenceImages,
    tier: params.flex_mode ? "flex" : "standard",
    apiKey: geminiKey,
  });

  let googleTierFallback: GenerateResponse["googleTierFallback"];
  let primaryFailure: FailureDetail | undefined;

  // ---------------- 2) Flex -> Standard retry on capacity failure ----------------
  if (!googleResult.ok && googleResult.tier === "flex" && isGoogleCapacityFailure(googleResult.failure)) {
    const capacityFailure = googleResult.failure;
    const standardAttempt = await runGoogleGeneration({
      params,
      referenceImages,
      tier: "standard",
      apiKey: geminiKey,
    });
    googleTierFallback = {
      triggered: true,
      fromTier: "flex",
      toTier: "standard",
      capacityFailure,
    };
    googleResult = standardAttempt;
    if (!standardAttempt.ok) primaryFailure = standardAttempt.failure;
  } else if (!googleResult.ok) {
    primaryFailure = googleResult.failure;
  }

  // ---------------- 3) Decide fallback to fal ----------------
  let falTriggered = false;
  let fallbackInfo: GenerateResponse["fallbackInfo"];
  let providerUsed: "google" | "fal" = "google";
  let images: GeneratedImage[] = [];
  let cost = null as GenerateResponse["cost"] | null;
  let endpointId = "google:gemini-3.1-flash-image-preview";
  let requestId = "";
  let requestIds: string[] = [];

  if (googleResult.ok) {
    images = googleResult.images;
    cost = googleResult.cost;
    requestIds = googleResult.requestIds;
    requestId = requestIds[0] ?? `req-${Date.now().toString(36)}`;
  } else {
    const failure = googleResult.failure;
    const eligible = shouldFallbackToFal(failure);
    if (eligible && autoFallback && falKey) {
      const falResult = await runFalGeneration({ params, referenceImages, apiKey: falKey });
      if (falResult.ok) {
        falTriggered = true;
        providerUsed = "fal";
        images = falResult.images;
        cost = falResult.cost;
        endpointId = falResult.endpointId;
        requestId = falResult.requestId;
        requestIds = [falResult.requestId];
        fallbackInfo = {
          triggered: true,
          reason: failure.message,
          fromProvider: "google",
          toProvider: "fal",
          endpointId: falResult.endpointId,
        };
      } else {
        return NextResponse.json(
          {
            error: "Generation failed in both providers.",
            primaryFailure: failure,
            falFailure: falResult.failure,
          },
          { status: 502 },
        );
      }
    } else {
      const reasonNoFallback = !autoFallback
        ? "AUTO_FALLBACK_TO_FAL disabled."
        : !falKey
          ? "FAL_API_KEY missing."
          : "Failure not eligible for fallback.";
      return NextResponse.json(
        {
          error: "Google generation failed and fallback not used.",
          primaryFailure: failure,
          fallbackSkippedReason: reasonNoFallback,
          googleTierFallback,
        },
        { status: 502 },
      );
    }
  }

  if (!cost) {
    return NextResponse.json({ error: "Cost was not computed." }, { status: 500 });
  }

  // ---------------- 4) Optional upscale post-processing ----------------
  const upscaleResult = await applyUpscaleIfEnabled({
    params,
    apiKey: falKey,
    baseImages: images,
    baseCost: cost,
  });

  const finalImages = upscaleResult.finalImages;
  const finalCost = upscaleResult.mergedCost;

  // ---------------- 5) Build response ----------------
  const referenceMetadata: ReferenceImageMetadata[] = referenceImages.map((ref) => ({
    filename: ref.filename,
    mimeType: ref.mimeType,
    size: ref.size ?? 0,
  }));

  const endedAt = new Date().toISOString();

  const response: GenerateResponse = {
    providerUsed,
    fallbackTriggered: falTriggered,
    fallbackReason: fallbackInfo?.reason ?? null,
    endpointId,
    requestId,
    requestIds,
    paramsUsed: params,
    referenceImages: referenceMetadata,
    cost: finalCost,
    images: finalImages,
    originalImages: upscaleResult.applied ? upscaleResult.originalImages : undefined,
    primaryFailure,
    fallbackInfo,
    googleTierFallback,
    startedAt,
    endedAt,
    createdAt: endedAt,
  };

  // Stash duration for clients that want it.
  (response as GenerateResponse & { durationMs: number }).durationMs = Date.now() - startMs;

  return NextResponse.json(response);
}
