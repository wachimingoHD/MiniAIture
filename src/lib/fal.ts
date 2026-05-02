// fal.ai integration for MiniAItures.
// Handles fallback generation (nano-banana-2 / nano-banana-2/edit) and the
// optional seedvr upscaling.

import type {
  CostSummary,
  FailureDetail,
  GeneratedImage,
  NanoBananaParams,
  ReferenceImageInput,
  UpscaleResolution,
} from "./nanoBanana";
import {
  UPSCALE_FAL_TARGET,
  UPSCALE_TARGET_MP,
  falResolutionToken,
  upscaleIsHigherThanBase,
} from "./nanoBanana";
import {
  computeFalCostSummary,
  computeUpscaleCost,
  extractFalUnitPrice,
  fetchFalPricing,
  mergeCostWithUpscale,
} from "./cost";

const FAL_TIMEOUT_MS = 10 * 60 * 1000;
const FAL_BASE_URL = "https://fal.run";

export const FAL_GEN_MODEL = "fal-ai/nano-banana-2";
export const FAL_GEN_EDIT_MODEL = "fal-ai/nano-banana-2/edit";
export const FAL_UPSCALE_MODEL = "fal-ai/seedvr/upscale/image";

export interface FalSuccess {
  ok: true;
  endpointId: string;
  images: GeneratedImage[];
  requestId: string;
  cost: CostSummary;
}

export interface FalFailure {
  ok: false;
  endpointId: string;
  failure: FailureDetail;
}

export type FalResult = FalSuccess | FalFailure;

export interface RunFalGenerationOptions {
  params: NanoBananaParams;
  referenceImages: ReferenceImageInput[];
  apiKey: string;
}

interface FalImageResponse {
  url?: string;
  content_type?: string;
  width?: number;
  height?: number;
  // some endpoints return base64 inline
  data?: string;
}

interface FalGenResponseBody {
  images?: FalImageResponse[];
  request_id?: string;
  detail?: unknown;
}

export async function runFalGeneration(
  opts: RunFalGenerationOptions,
): Promise<FalResult> {
  const { params, referenceImages, apiKey } = opts;
  const endpointId = referenceImages.length > 0 ? FAL_GEN_EDIT_MODEL : FAL_GEN_MODEL;

  const payload: Record<string, unknown> = {
    prompt: params.prompt,
    num_images: params.num_images,
    aspect_ratio: params.aspect_ratio,
    resolution: falResolutionToken(params.resolution),
    enable_web_search: params.enable_google_search,
    safety_tolerance: "6",
    limit_generations: true,
    output_format: "png",
    sync_mode: false,
  };
  if (referenceImages.length > 0) {
    payload.image_urls = referenceImages.map(
      (ref) => `data:${ref.mimeType};base64,${ref.data}`,
    );
  }

  const result = await callFalEndpoint<FalGenResponseBody>({
    endpointId,
    apiKey,
    body: payload,
    timeoutMs: FAL_TIMEOUT_MS,
  });
  if (!result.ok) {
    return { ok: false, endpointId, failure: result.failure };
  }

  const images = await collectFalImages(result.body.images ?? []);
  if (images.length === 0) {
    return {
      ok: false,
      endpointId,
      failure: {
        provider: "fal",
        reason: "FAL_ERROR",
        message: "fal returned no images.",
        fallbackEligible: false,
        raw: result.body.detail,
      },
    };
  }

  const pricing = await fetchFalPricing();
  const apiUnitPriceUsd = extractFalUnitPrice(pricing, endpointId);
  const baseCost = computeFalCostSummary({
    numImages: params.num_images,
    resolution: params.resolution,
    enableWebSearch: params.enable_google_search,
    apiUnitPriceUsd,
  });

  return {
    ok: true,
    endpointId,
    images,
    requestId: result.body.request_id ?? `fal-${Date.now().toString(36)}`,
    cost: baseCost,
  };
}

interface FalCallOk<T> { ok: true; body: T; requestId?: string }
interface FalCallErr { ok: false; failure: FailureDetail }
type FalCallResult<T> = FalCallOk<T> | FalCallErr;

async function callFalEndpoint<T>(args: {
  endpointId: string;
  apiKey: string;
  body: unknown;
  timeoutMs: number;
}): Promise<FalCallResult<T>> {
  const { endpointId, apiKey, body, timeoutMs } = args;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${FAL_BASE_URL}/${endpointId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        failure: {
          provider: "fal",
          reason: "FAL_ERROR",
          message: `fal HTTP ${res.status}: ${text.slice(0, 500)}`,
          statusCode: res.status,
          fallbackEligible: false,
          raw: text.slice(0, 1000),
        },
      };
    }
    try {
      const parsed = JSON.parse(text) as T;
      return { ok: true, body: parsed };
    } catch {
      return {
        ok: false,
        failure: {
          provider: "fal",
          reason: "FAL_ERROR",
          message: "fal response was not valid JSON.",
          fallbackEligible: false,
          raw: text.slice(0, 1000),
        },
      };
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return {
        ok: false,
        failure: {
          provider: "fal",
          reason: "FAL_ERROR",
          message: `fal request timed out after ${timeoutMs}ms.`,
          fallbackEligible: false,
        },
      };
    }
    return {
      ok: false,
      failure: {
        provider: "fal",
        reason: "FAL_ERROR",
        message: (err as Error).message ?? "Unknown fal error",
        fallbackEligible: false,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function collectFalImages(items: FalImageResponse[]): Promise<GeneratedImage[]> {
  const out: GeneratedImage[] = [];
  for (const item of items) {
    if (item.data) {
      out.push({
        data: item.data,
        mimeType: item.content_type ?? "image/png",
        width: item.width,
        height: item.height,
        source: "fal",
      });
      continue;
    }
    if (!item.url) continue;
    const fetched = await fetchAsBase64(item.url);
    if (!fetched) continue;
    out.push({
      data: fetched.data,
      mimeType: item.content_type ?? fetched.mimeType,
      width: item.width,
      height: item.height,
      source: "fal",
    });
  }
  return out;
}

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") ?? "image/png";
    return { data: buf.toString("base64"), mimeType };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Upscale post-processing
// ---------------------------------------------------------------------------

export interface ApplyUpscaleArgs {
  params: NanoBananaParams;
  apiKey: string | undefined;
  baseImages: GeneratedImage[];
  baseCost: CostSummary;
}

export interface ApplyUpscaleResult {
  applied: boolean;
  finalImages: GeneratedImage[];
  originalImages?: GeneratedImage[];
  mergedCost: CostSummary;
  upscaleNote: string;
}

export async function applyUpscaleIfEnabled(
  args: ApplyUpscaleArgs,
): Promise<ApplyUpscaleResult> {
  const { params, apiKey, baseImages, baseCost } = args;
  if (!params.upscale_enabled) {
    return {
      applied: false,
      finalImages: baseImages,
      mergedCost: baseCost,
      upscaleNote: "Upscale disabled.",
    };
  }
  if (!upscaleIsHigherThanBase(params.resolution, params.upscale_resolution)) {
    return {
      applied: false,
      finalImages: baseImages,
      mergedCost: baseCost,
      upscaleNote: "Upscale target not higher than base resolution; skipped.",
    };
  }
  if (!apiKey) {
    return {
      applied: false,
      finalImages: baseImages,
      mergedCost: baseCost,
      upscaleNote: "FAL_API_KEY missing; upscale skipped.",
    };
  }

  const target = params.upscale_resolution as UpscaleResolution;
  const upscaled: GeneratedImage[] = [];
  const realMp: number[] = [];

  for (const img of baseImages) {
    const result = await upscaleSingle(img, target, apiKey);
    if (result) {
      upscaled.push(result.image);
      if (result.image.width && result.image.height) {
        realMp.push((result.image.width * result.image.height) / 1_000_000);
      }
    } else {
      // If upscale fails for one image, keep the original to not lose data.
      upscaled.push(img);
    }
  }

  const pricing = await fetchFalPricing();
  const apiUnitPricePerMp = extractFalUnitPrice(pricing, FAL_UPSCALE_MODEL);
  const upscaleCost = computeUpscaleCost({
    numImages: baseImages.length,
    upscaleResolution: target,
    apiUnitPricePerMp,
    realImageMp: realMp.length === baseImages.length ? realMp : undefined,
  });

  const merged = mergeCostWithUpscale(baseCost, upscaleCost, baseImages.length);

  return {
    applied: true,
    finalImages: upscaled.map((img) => ({ ...img, upscaled: true })),
    originalImages: baseImages,
    mergedCost: merged,
    upscaleNote: `Upscaled to ${UPSCALE_FAL_TARGET[target]} (~${UPSCALE_TARGET_MP[target]} MP target).`,
  };
}

interface UpscaleSingleResult {
  image: GeneratedImage;
}

async function upscaleSingle(
  base: GeneratedImage,
  target: UpscaleResolution,
  apiKey: string,
): Promise<UpscaleSingleResult | null> {
  const payload = {
    image_url: `data:${base.mimeType};base64,${base.data}`,
    target_resolution: UPSCALE_FAL_TARGET[target],
  };

  const result = await callFalEndpoint<{
    image?: FalImageResponse;
    request_id?: string;
  }>({
    endpointId: FAL_UPSCALE_MODEL,
    apiKey,
    body: payload,
    timeoutMs: FAL_TIMEOUT_MS,
  });
  if (!result.ok) return null;

  const item = result.body.image;
  if (!item) return null;

  if (item.data) {
    return {
      image: {
        data: item.data,
        mimeType: item.content_type ?? "image/png",
        width: item.width,
        height: item.height,
        source: "fal",
      },
    };
  }
  if (item.url) {
    const fetched = await fetchAsBase64(item.url);
    if (!fetched) return null;
    return {
      image: {
        data: fetched.data,
        mimeType: item.content_type ?? fetched.mimeType,
        width: item.width,
        height: item.height,
        source: "fal",
      },
    };
  }
  return null;
}
