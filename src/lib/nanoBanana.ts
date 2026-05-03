// Shared types, enums, defaults and limits for the MiniAItures generation flow.
// This module is consumed by /api/generate, /api/estimate-cost and the UI.

export type AspectRatio =
  | "1:1"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4"
  | "21:9";

export type Resolution = "512" | "1K" | "2K" | "4K";
export type UpscaleResolution = "1K" | "2K" | "4K";

export const ASPECT_RATIOS: AspectRatio[] = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "21:9",
];

export const RESOLUTIONS: Resolution[] = ["512", "1K", "2K", "4K"];
export const UPSCALE_RESOLUTIONS: UpscaleResolution[] = ["1K", "2K", "4K"];

export interface NanoBananaParams {
  prompt: string;
  num_images: number;
  flex_mode: boolean;
  enable_google_search: boolean;
  aspect_ratio: AspectRatio;
  resolution: Resolution;
  upscale_enabled: boolean;
  upscale_resolution: UpscaleResolution;
}

export const DEFAULT_NANO_BANANA_PARAMS: NanoBananaParams = {
  prompt: "",
  num_images: 1,
  flex_mode: false,
  enable_google_search: false,
  aspect_ratio: "16:9",
  resolution: "1K",
  upscale_enabled: false,
  upscale_resolution: "2K",
};

export const MAX_REFERENCE_IMAGES = 10;
export const MAX_REFERENCE_IMAGES_TOTAL_BYTES = 5 * 1024 * 1024;

export interface ReferenceImageInput {
  // base64 payload (without `data:` prefix)
  data: string;
  mimeType: string;
  filename?: string;
  size?: number;
}

export interface ReferenceImageMetadata {
  filename?: string;
  mimeType: string;
  size: number;
}

export interface GeneratedImage {
  // base64 of the image content
  data: string;
  mimeType: string;
  width?: number;
  height?: number;
  source: "google" | "fal";
  upscaled?: boolean;
}

export type Provider = "google" | "fal";
export type ServiceTier = "standard" | "flex";

// Google failure categories
export type GoogleFailureReason =
  | "CONTENT_BLOCKED"
  | "SAFETY"
  | "QUOTA"
  | "CAPACITY"
  | "TIMEOUT"
  | "AUTH"
  | "INVALID_REQUEST"
  | "IMAGE_OTHER"
  | "OTHER";

export interface FailureDetail {
  provider: Provider;
  reason: GoogleFailureReason | "FAL_ERROR";
  message: string;
  statusCode?: number;
  fallbackEligible: boolean;
  raw?: unknown;
}

export interface FallbackDetail {
  triggered: boolean;
  reason: string;
  fromProvider: Provider;
  toProvider: Provider;
  endpointId?: string;
}

export interface TierFallbackDetail {
  triggered: true;
  fromTier: "flex";
  toTier: "standard";
  capacityFailure: FailureDetail;
}

export interface CostBreakdown {
  inputTokens?: number;
  outputTokens?: number;
  inputCost?: number;
  outputCost?: number;
  baseCost?: number;
  resolutionMultiplier?: number;
  webSearchExtra?: number;
  upscaleCost?: number;
}

export interface CostSummary {
  total: number;
  perImage: number;
  currency: "USD";
  method:
    | "token_usage_estimate"
    | "fal_rate_formula"
    | "merged"
    | "fallback_static";
  notes: string[];
  breakdown: CostBreakdown;
  pricingSource?: "fal_api" | "static_fallback";
}

export interface UpscaleEstimate {
  enabled: boolean;
  targetResolution: UpscaleResolution | null;
  estimatedCostPerImage: number;
  totalEstimatedCost: number;
  notes: string;
}

export interface EstimateBlock {
  total: number;
  perImage: number;
  breakdown: CostBreakdown;
  includesUpscale: boolean;
  notes?: string[];
}

export interface CostEstimateResponse {
  upscale: UpscaleEstimate;
  google: EstimateBlock;
  fal: EstimateBlock;
}

export interface GenerateResponse {
  providerUsed: Provider;
  fallbackTriggered: boolean;
  fallbackReason: string | null;
  endpointId: string;
  requestId: string;
  requestIds: string[];
  paramsUsed: NanoBananaParams;
  referenceImages: ReferenceImageMetadata[];
  cost: CostSummary;
  images: GeneratedImage[];
  originalImages?: GeneratedImage[];
  primaryFailure?: FailureDetail;
  fallbackInfo?: FallbackDetail;
  googleTierFallback?: TierFallbackDetail;
  startedAt: string;
  endedAt: string;
  createdAt: string;
  userPlan?: "free" | "pro";
  creditsRemaining?: {
    daily: number;
    monthly: number;
  };
  watermarkApplied?: boolean;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidatedRequest {
  params: NanoBananaParams;
  referenceImages: ReferenceImageInput[];
}

export function validateGenerationRequest(
  body: unknown,
): { ok: true; value: ValidatedRequest } | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  if (!body || typeof body !== "object") {
    return { ok: false, errors: [{ field: "body", message: "Invalid request body" }] };
  }

  const raw = body as Record<string, unknown>;
  const paramsRaw = (raw.params ?? {}) as Record<string, unknown>;

  const prompt = typeof paramsRaw.prompt === "string" ? paramsRaw.prompt.trim() : "";
  if (!prompt) errors.push({ field: "prompt", message: "Prompt is required" });

  const num_images = clampInt(paramsRaw.num_images, 1, 4, 1);
  const flex_mode = Boolean(paramsRaw.flex_mode);
  const enable_google_search = Boolean(paramsRaw.enable_google_search);
  const upscale_enabled = Boolean(paramsRaw.upscale_enabled);

  const aspect_ratio = enumOrDefault(paramsRaw.aspect_ratio, ASPECT_RATIOS, "16:9");
  const resolution = enumOrDefault(paramsRaw.resolution, RESOLUTIONS, "1K");
  const upscale_resolution = enumOrDefault(
    paramsRaw.upscale_resolution,
    UPSCALE_RESOLUTIONS,
    "2K",
  );

  const referenceImagesRaw = Array.isArray(raw.referenceImages) ? raw.referenceImages : [];
  if (referenceImagesRaw.length > MAX_REFERENCE_IMAGES) {
    errors.push({
      field: "referenceImages",
      message: `Max ${MAX_REFERENCE_IMAGES} reference images allowed`,
    });
  }

  const referenceImages: ReferenceImageInput[] = [];
  let totalBytes = 0;
  for (const item of referenceImagesRaw) {
    if (!item || typeof item !== "object") continue;
    const ref = item as Record<string, unknown>;
    const data = typeof ref.data === "string" ? ref.data : "";
    const mimeType = typeof ref.mimeType === "string" ? ref.mimeType : "";
    if (!data || !mimeType.startsWith("image/")) continue;
    const size = typeof ref.size === "number" ? ref.size : approxBase64Size(data);
    totalBytes += size;
    referenceImages.push({
      data,
      mimeType,
      filename: typeof ref.filename === "string" ? ref.filename : undefined,
      size,
    });
  }
  if (totalBytes > MAX_REFERENCE_IMAGES_TOTAL_BYTES) {
    errors.push({
      field: "referenceImages",
      message: `Reference images exceed ${MAX_REFERENCE_IMAGES_TOTAL_BYTES / 1024 / 1024}MB total`,
    });
  }

  if (errors.length) return { ok: false, errors };

  const params: NanoBananaParams = {
    prompt,
    num_images,
    flex_mode,
    enable_google_search,
    aspect_ratio,
    resolution,
    upscale_enabled,
    upscale_resolution,
  };
  return { ok: true, value: { params, referenceImages } };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function enumOrDefault<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function approxBase64Size(b64: string): number {
  // base64 decoded size approximation
  const len = b64.length;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

// ---------------------------------------------------------------------------
// Capacity failure detection (for Flex -> Standard retry)
// ---------------------------------------------------------------------------

export function isGoogleCapacityFailure(failure: FailureDetail): boolean {
  if (failure.reason === "CAPACITY" || failure.reason === "QUOTA") return true;
  if (failure.statusCode === 503) return true;
  if (failure.statusCode === 429) return true;
  return false;
}

export function shouldFallbackToFal(failure: FailureDetail): boolean {
  if (failure.fallbackEligible) return true;
  if (failure.reason === "OTHER" || failure.reason === "IMAGE_OTHER") return true;
  if (failure.statusCode && failure.statusCode >= 500) return true;
  if (failure.statusCode === 429) return true;
  if (failure.statusCode === 422) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Resolution -> imageSize mapping for Google
// ---------------------------------------------------------------------------

export function googleImageSize(res: Resolution): "512" | "1K" | "2K" | "4K" {
  return res;
}

// fal endpoint expects the literal "0.5K" instead of "512"
export function falResolutionToken(res: Resolution): string {
  return res === "512" ? "0.5K" : res;
}

// ---------------------------------------------------------------------------
// Output token estimates per resolution (fallback when countTokens fails)
// ---------------------------------------------------------------------------

export const ESTIMATED_OUTPUT_TOKENS_PER_IMAGE: Record<Resolution, number> = {
  "512": 560,
  "1K": 1120,
  "2K": 1120,
  "4K": 2000,
};

// Cost-per-MP estimates for upscale targets (used when fal pricing API fails
// or doesn't return per-image dimensions).
export const UPSCALE_TARGET_MP: Record<UpscaleResolution, number> = {
  "1K": 2.0736,
  "2K": 3.6864,
  "4K": 8.2944,
};

// fal target token used by seedvr/upscale/image
export const UPSCALE_FAL_TARGET: Record<UpscaleResolution, string> = {
  "1K": "1080p",
  "2K": "1440p",
  "4K": "2160p",
};

// Required for upscale to apply: target must be strictly higher than base.
export function upscaleIsHigherThanBase(
  base: Resolution,
  target: UpscaleResolution,
): boolean {
  const order: Record<string, number> = { "512": 0, "1K": 1, "2K": 2, "4K": 3 };
  return order[target] > order[base];
}
