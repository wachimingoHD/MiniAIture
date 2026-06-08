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
} from "@/lib/firestore/users";
import {
  BASE_GENERATION_CREDITS,
  computeGenerationCreditsCost,
  deriveModesFromParams,
  resolveGenerationMode,
  type UserFacingResolution,
} from "@/lib/firestore/credit-pricing";
import { getClientIp, readBearerToken } from "@/lib/server/request";
import { getFirebaseStorageConfig, uploadGalleryImage } from "@/lib/storage/firebase-storage";
import { enhancePrompt } from "@/lib/services/prompt-enhancer";
import { createGeneration } from "@/lib/firestore/generations";

export const runtime = "nodejs";
export const maxDuration = 120;

interface EnhancerFields {
  videoTitle: string | null;
  userPrompt: string;
  referenceInstructions: string | null;
  stylePrompt: string;
}

function optStr(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

// Extrae los campos del enhancer (doc §3.3) del body. Devuelve null si no viene
// `userPrompt`, en cuyo caso se mantiene el comportamiento previo (params.prompt).
function extractEnhancerFields(raw: Record<string, unknown>): EnhancerFields | null {
  const userPrompt = typeof raw.userPrompt === "string" ? raw.userPrompt.trim() : "";
  if (!userPrompt) return null;
  return {
    videoTitle: optStr(raw.videoTitle),
    userPrompt,
    referenceInstructions: optStr(raw.referenceInstructions),
    stylePrompt: typeof raw.stylePrompt === "string" ? raw.stylePrompt : "",
  };
}

// Metadatos de estilo para el documento `generations` (doc §1.2 / §4.1 campo 4).
function extractStyleMeta(raw: Record<string, unknown>): {
  styleType: "preset" | "custom" | "gallery";
  styleId: string | null;
  nicho: string | null;
} {
  const t = raw.styleType;
  const styleType = t === "preset" || t === "gallery" ? t : "custom";
  return { styleType, styleId: optStr(raw.styleId), nicho: optStr(raw.nicho) };
}

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

  // ---------------- LLM enhancer (doc §3.3) ----------------
  // Compatible hacia atrás: solo se ejecuta si la petición trae los campos
  // nuevos del formulario (userPrompt). Si no, se usa params.prompt tal cual.
  const enhancerFields = extractEnhancerFields(rawBody);
  let enhancedPrompt = params.prompt;
  let userPromptForRecord = params.prompt;
  if (enhancerFields) {
    userPromptForRecord = enhancerFields.userPrompt;
    // Pasamos TODAS las imágenes etiquetadas "Image N" en el mismo orden en que
    // se envían al generador de imágenes, para que el enhancer pueda casar cada
    // [Image N] citada en el contenido con su imagen real.
    const enhancerReferenceImages = referenceImages.map((ref, i) => ({
      data: ref.data,
      mimeType: ref.mimeType,
      label: `Image ${i + 1}`,
    }));
    const enhanced = await enhancePrompt(
      {
        videoTitle: enhancerFields.videoTitle,
        userPrompt: enhancerFields.userPrompt,
        referenceImages: enhancerReferenceImages,
        referenceInstructions: enhancerFields.referenceInstructions,
        stylePrompt: enhancerFields.stylePrompt,
      },
      { apiKey: geminiKey },
    );
    enhancedPrompt = enhanced.enhancedPrompt;
    // El prompt que recibe la IA de imagen es el enhanced.
    params.prompt = enhancedPrompt;
  }

  // Metadatos para el documento `generations` (doc §1.2 / §10).
  const styleMeta = extractStyleMeta(rawBody);
  const stylePromptForRecord = enhancerFields?.stylePrompt ?? "";
  const videoTitleForRecord = enhancerFields?.videoTitle ?? null;
  const referenceInstructionsForRecord = enhancerFields?.referenceInstructions ?? null;

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
      displayName: authenticatedUser.name,
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

    const generationCreditsCost = computeGenerationCreditsCost(
      userDoc.plan,
      deriveModesFromParams(params),
    );

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

    // ---------------- 2) Cola -> Normal retry on capacity failure (SOLO PRO) ----------------
    // Si la cola de baja prioridad (flex) cae, los PRO reintentan en Gemini normal.
    // Los FREE NO tienen este fallback (su modo siempre es la cola).
    if (userPlan === "pro" && !googleResult.ok && googleResult.tier === "flex" && isGoogleCapacityFailure(googleResult.failure)) {
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

    // ---------------- 5) Persistencia en `generations` (doc §1.2 / §10) ----------------
    const generationIds: string[] = [];
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
        // Persistimos generations para TODOS los usuarios (la galería personal
        // FREE muestra los últimos 30, doc §5.2 opción A).
        if (storageCfg) {
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
            const genProvider = providerForStats === "fal" ? "fal" : "gemini";
            const genResolution = userFacingResolution === "512" ? 512 : 1024;
            const genMode = resolveGenerationMode(userPlan ?? "free", requestedLowPriority);

            // Persistimos también la imagen de referencia (si la hubo) para
            // poder mostrarla en el detalle de la generación.
            let referenceImageUrl: string | null = null;
            const firstRef = referenceImages[0];
            if (firstRef?.data) {
              try {
                const refUp = await uploadGalleryImage({
                  uid: authenticatedUser.uid,
                  data: firstRef.data,
                  mimeType: firstRef.mimeType,
                });
                referenceImageUrl = refUp.publicUrl;
              } catch (err) {
                console.warn("No se pudo persistir la imagen de referencia:", err);
              }
            }

            for (const item of uploaded) {
              const { id } = await createGeneration(db, {
                userId: authenticatedUser.uid,
                videoTitle: videoTitleForRecord,
                userPrompt: userPromptForRecord,
                enhancedPrompt,
                referenceImageUrl,
                referenceInstructions: referenceInstructionsForRecord,
                styleType: styleMeta.styleType,
                styleId: styleMeta.styleId,
                stylePrompt: stylePromptForRecord,
                imageUrl: item.publicUrl,
                provider: genProvider,
                resolution: genResolution,
                mode: genMode,
                creditsUsed: chargedCredits,
                nicho: styleMeta.nicho,
              });
              generationIds.push(id);
            }
          } catch (err) {
            console.warn("Persistencia de generations falló:", err);
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

    (response as GenerateResponse & { durationMs: number; generationIds: string[] }).durationMs =
      Date.now() - startMs;
    (response as GenerateResponse & { generationIds: string[] }).generationIds = generationIds;

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
