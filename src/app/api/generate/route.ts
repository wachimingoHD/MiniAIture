import { NextRequest, NextResponse } from "next/server";
import {
  validateGenerationRequest,
  isGoogleCapacityFailure,
  shouldFallbackToFal,
  deriveUserFacingResolution,
  type FailureDetail,
  type GenerateResponse,
  type ReferenceImageMetadata,
  type GeneratedImage,
} from "@/lib/nanoBanana";
import { safeErrorMessage } from "@/lib/server/errors";
import { runGoogleGeneration, type GoogleResult } from "@/lib/google";
import { runFalGeneration, applyUpscaleIfEnabled } from "@/lib/fal";
import { adminFirestore, verifyAppCheckToken, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getRuntimeConfig } from "@/lib/config/runtime";
import {
  checkAndConsumeFreeIpRateLimit,
  deductGenerationCredits,
  enforcePlanRules,
  getOrCreateUserDocument,
  recordGenerationSuccess,
  refundGenerationCredits,
  storeProGalleryImages,
} from "@/lib/firestore/users";
import { BASE_GENERATION_CREDITS, computeGenerationCreditsCost, type UserFacingResolution } from "@/lib/firestore/credit-pricing";
import { getClientIp, readBearerToken } from "@/lib/server/request";
import { getFirebaseStorageConfig, uploadGalleryImage } from "@/lib/storage/firebase-storage";

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
  const rawBody = body as Record<string, unknown>;
  // Pricing inputs are derived from the validated technical params, NOT from
  // the raw body. Trusting client-supplied `userFacingResolution` /
  // `lowPriorityMode` allowed a paying user to generate at high resolution
  // while paying for low resolution.
  const userFacingResolution: UserFacingResolution =
    deriveUserFacingResolution(params) as UserFacingResolution;
  const requestedLowPriority = params.flex_mode;
  const devSimulationMode =
    typeof rawBody.devSimulationMode === "string" ? rawBody.devSimulationMode : "off";

  const cfg = getRuntimeConfig();
  const geminiKey = process.env.GEMINI_API_KEY;
  const falKey = process.env.FAL_API_KEY;
  const autoFallback = (process.env.AUTO_FALLBACK_TO_FAL ?? "true").toLowerCase() !== "false";

  if (!geminiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured on server." },
      { status: 500 },
    );
  }

  let authenticatedUser: Awaited<ReturnType<typeof verifyIdToken>> | null = null;
  let chargedCredits = 0;
  let chargedFrom: { daily: number; monthly: number } = { daily: 0, monthly: 0 };
  let creditsAfterDeduction: { daily: number; monthly: number } | null = null;
  let userPlan: "free" | "pro" | undefined;

    if (cfg.security.requireAuthForGenerate) {
    const token = readBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });
    }
    authenticatedUser = await verifyIdToken(token);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Invalid or expired auth token." }, { status: 401 });
    }

    if (cfg.security.enforceAppCheck) {
      const appCheckToken = req.headers.get("x-firebase-appcheck");
      if (!appCheckToken) {
        return NextResponse.json({ error: "Missing x-firebase-appcheck header." }, { status: 401 });
      }
      const appCheckOk = await verifyAppCheckToken(appCheckToken);
      if (!appCheckOk) {
        return NextResponse.json({ error: "Invalid Firebase App Check token." }, { status: 401 });
      }
    }

    const db = adminFirestore();
    if (!db) {
      return NextResponse.json(
        { error: "Firebase Admin not configured. Set FIREBASE_ADMIN_CREDENTIALS." },
        { status: 500 },
      );
    }

    const userDoc = await getOrCreateUserDocument(db, {
      uid: authenticatedUser.uid,
      email: authenticatedUser.email,
    });
    userPlan = userDoc.plan;

    const planRule = enforcePlanRules(userDoc, {
      resolution: params.resolution,
      flex_mode: params.flex_mode,
      upscale_enabled: params.upscale_enabled,
    });
    if (!planRule.ok) {
      return NextResponse.json({ error: planRule.message }, { status: planRule.status });
    }

    if (userDoc.plan === "free") {
      const clientIp = getClientIp(req, cfg.security.trustedProxyHeader);
      const rate = await checkAndConsumeFreeIpRateLimit(db, { ip: clientIp });
      if (!rate.ok) {
        return NextResponse.json(
          { error: "Free plan rate limit reached for this IP today." },
          { status: 429 },
        );
      }
    }

    const generationCreditsCost = computeGenerationCreditsCost({
      plan: userDoc.plan,
      lowPriority: requestedLowPriority,
      resolution: userFacingResolution,
    });

    const charge = await deductGenerationCredits(db, {
      uid: authenticatedUser.uid,
      email: authenticatedUser.email,
      cost: generationCreditsCost,
    });
    if (!charge.ok) {
      return NextResponse.json(
        {
          error: "Insufficient credits.",
          creditsRemaining: {
            daily: charge.userDoc.credits.daily,
            monthly: charge.userDoc.credits.monthly,
          },
        },
        { status: 402 },
      );
    }

    chargedFrom = charge.chargedFrom;
    chargedCredits = charge.chargedFrom.daily + charge.chargedFrom.monthly;
    creditsAfterDeduction = {
      daily: charge.userDoc.credits.daily,
      monthly: charge.userDoc.credits.monthly,
    };

    if (process.env.NODE_ENV !== "production" && devSimulationMode !== "off") {
      if (devSimulationMode === "reject") {
        await refundGenerationCredits(db, { uid: authenticatedUser.uid, chargedFrom });
        return NextResponse.json(
          {
            error: "Simulated rejection (developer mode).",
            simulated: true,
            simulatedMode: "reject",
          },
          { status: 502 },
        );
      }

      if (devSimulationMode === "success") {
        await recordGenerationSuccess(db, {
          uid: authenticatedUser.uid,
          provider: "google",
          generatedImages: 1,
          chargedCredits,
        });
        return NextResponse.json({
          providerUsed: "google",
          fallbackTriggered: false,
          fallbackReason: null,
          endpointId: "simulated:developer-mode",
          requestId: `sim-${Date.now().toString(36)}`,
          requestIds: [`sim-${Date.now().toString(36)}`],
          paramsUsed: params,
          referenceImages: [],
          cost: {
            total: 0,
            perImage: 0,
            currency: "USD",
            method: "fallback_static",
            notes: [`Simulated success. Charged ${chargedCredits} credits.`],
            breakdown: {},
          },
          images: [],
          startedAt,
          endedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          userPlan,
          creditsRemaining: creditsAfterDeduction ?? undefined,
          watermarkApplied: false,
          simulated: true,
          simulatedMode: "success",
          chargedCredits,
          baseCredits: BASE_GENERATION_CREDITS,
        });
      }
    }
  }

  try {
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
          if (authenticatedUser && chargedCredits > 0) {
            const db = adminFirestore();
          if (db) {
              await refundGenerationCredits(db, { uid: authenticatedUser.uid, chargedFrom });
            }
          }
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
        if (authenticatedUser && chargedCredits > 0) {
          const db = adminFirestore();
          if (db) {
            await refundGenerationCredits(db, { uid: authenticatedUser.uid, chargedFrom });
          }
        }
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
      if (authenticatedUser && chargedCredits > 0) {
        const db = adminFirestore();
        if (db) {
          await refundGenerationCredits(db, { uid: authenticatedUser.uid, chargedFrom });
        }
      }
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

    // ---------------- 5) Optional Pro gallery persistence ----------------
    if (authenticatedUser) {
      const db = adminFirestore();
      if (db) {
        const providerForStats =
          providerUsed === "fal" || endpointId.startsWith("fal") ? "fal" : "google";
        await recordGenerationSuccess(db, {
          uid: authenticatedUser.uid,
          provider: providerForStats,
          generatedImages: finalImages.length,
          chargedCredits,
        });

        const storageCfg = getFirebaseStorageConfig();

        if (userPlan === "pro" && storageCfg) {
          try {
            const uploaded = await Promise.all(
              finalImages.map((img) =>
                uploadGalleryImage({
                  uid: authenticatedUser.uid,
                  data: img.data,
                  mimeType: img.mimeType,
                }),
              ),
            );
            await storeProGalleryImages(db, {
              uid: authenticatedUser.uid,
              prompt: params.prompt,
              imageUrls: uploaded.map((item) => item.publicUrl),
              provider: providerUsed,
            });
          } catch (err) {
            console.warn("Firebase Storage gallery persistence failed:", err);
          }
        }
      }
    }

    // ---------------- 6) Build response ----------------
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
      userPlan,
      creditsRemaining: creditsAfterDeduction ?? undefined,
      watermarkApplied: false,
    };

    (response as GenerateResponse & { durationMs: number }).durationMs = Date.now() - startMs;

    return NextResponse.json(response);
  } catch (err) {
    if (authenticatedUser && chargedCredits > 0) {
      const db = adminFirestore();
      if (db) {
        await refundGenerationCredits(db, { uid: authenticatedUser.uid, chargedFrom });
      }
    }
    return NextResponse.json(
      { error: "Unexpected generation error.", detail: safeErrorMessage(err, "internal_error") },
      { status: 500 },
    );
  }
}
