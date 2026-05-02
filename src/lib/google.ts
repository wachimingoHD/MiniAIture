// Google Gemini integration for MiniAItures.
// Uses the public REST API directly to retain full control over service_tier,
// safetySettings and imageConfig, which the official SDK does not currently
// expose 1:1 for the gemini-3.1-flash-image-preview model.

import type {
  CostSummary,
  FailureDetail,
  GeneratedImage,
  GoogleFailureReason,
  NanoBananaParams,
  ReferenceImageInput,
  ServiceTier,
} from "./nanoBanana";
import {
  ESTIMATED_OUTPUT_TOKENS_PER_IMAGE,
  googleImageSize,
} from "./nanoBanana";
import {
  computeTokenCostSummary,
  GoogleTokenUsage,
} from "./cost";

export const GOOGLE_MODEL = "gemini-3.1-flash-image-preview";

const STANDARD_TIMEOUT_MS = 2 * 60 * 1000;
const FLEX_TIMEOUT_MS = 10 * 60 * 1000;

const SAFETY_CATEGORIES = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_CIVIC_INTEGRITY",
] as const;

interface GoogleApiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GoogleApiCandidate {
  content?: { parts?: GoogleApiPart[]; role?: string };
  finishReason?: string;
  finishMessage?: string;
  safetyRatings?: Array<{ category: string; probability: string; blocked?: boolean }>;
}

interface GoogleApiResponse {
  candidates?: GoogleApiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
    candidatesTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  };
  responseId?: string;
  promptFeedback?: {
    blockReason?: string;
    blockReasonMessage?: string;
    safetyRatings?: Array<{ category: string; probability: string; blocked?: boolean }>;
  };
}

export interface GoogleSuccess {
  ok: true;
  tier: ServiceTier;
  images: GeneratedImage[];
  cost: CostSummary;
  requestIds: string[];
  responseIds: string[];
  finishReasons: string[];
  finishMessages: string[];
  texts: string[];
  safetyRatings: GoogleApiCandidate["safetyRatings"];
  totalUsage: GoogleTokenUsage;
}

export interface GoogleFailure {
  ok: false;
  tier: ServiceTier;
  failure: FailureDetail;
  partial: GeneratedImage[];
}

export type GoogleResult = GoogleSuccess | GoogleFailure;

export interface RunGoogleOptions {
  params: NanoBananaParams;
  referenceImages: ReferenceImageInput[];
  tier: ServiceTier;
  apiKey: string;
}

export async function runGoogleGeneration(
  opts: RunGoogleOptions,
): Promise<GoogleResult> {
  const { params, referenceImages, tier, apiKey } = opts;
  const timeoutMs = tier === "flex" ? FLEX_TIMEOUT_MS : STANDARD_TIMEOUT_MS;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:generateContent`;

  const safetySettings = SAFETY_CATEGORIES.map((category) => ({
    category,
    threshold: "OFF",
  }));

  const baseContents = buildContents(params.prompt, referenceImages);

  const totalUsage: GoogleTokenUsage = {
    inputTokens: 0,
    outputTextTokens: 0,
    outputImageTokens: 0,
  };
  const images: GeneratedImage[] = [];
  const requestIds: string[] = [];
  const responseIds: string[] = [];
  const finishReasons: string[] = [];
  const finishMessages: string[] = [];
  const texts: string[] = [];
  const allSafetyRatings: NonNullable<GoogleApiCandidate["safetyRatings"]> = [];

  let lastFailure: FailureDetail | null = null;

  for (let i = 0; i < params.num_images; i++) {
    const requestId = randomId();
    requestIds.push(requestId);

    const body = {
      contents: baseContents,
      generationConfig: {
        imageConfig: {
          aspectRatio: params.aspect_ratio,
          imageSize: googleImageSize(params.resolution),
        },
        responseModalities: ["IMAGE", "TEXT"],
      },
      safetySettings,
      service_tier: tier,
      ...(params.enable_google_search ? { tools: [{ google_search: {} }] } : {}),
    };

    const result = await callGoogleApi({ url, apiKey, body, timeoutMs, requestId });
    if (!result.ok) {
      lastFailure = result.failure;
      continue;
    }

    const candidate = result.response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    let producedImage = false;
    for (const part of parts) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("image/")) {
        images.push({
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType,
          source: "google",
        });
        producedImage = true;
      } else if (typeof part.text === "string" && part.text.length > 0) {
        texts.push(part.text);
      }
    }
    if (candidate?.finishReason) finishReasons.push(candidate.finishReason);
    if (candidate?.finishMessage) finishMessages.push(candidate.finishMessage);
    if (candidate?.safetyRatings) allSafetyRatings.push(...candidate.safetyRatings);
    if (result.response.responseId) responseIds.push(result.response.responseId);

    accumulateUsage(totalUsage, result.response, producedImage);

    if (!producedImage) {
      lastFailure = formatGoogleNoImageError(result.response, candidate);
    }
  }

  if (images.length > 0) {
    const cost = computeTokenCostSummary(
      totalUsage,
      tier,
      params.num_images,
      params.enable_google_search,
    );
    return {
      ok: true,
      tier,
      images,
      cost,
      requestIds,
      responseIds,
      finishReasons,
      finishMessages,
      texts,
      safetyRatings: allSafetyRatings,
      totalUsage,
    };
  }

  return {
    ok: false,
    tier,
    failure:
      lastFailure ?? {
        provider: "google",
        reason: "OTHER",
        message: "Google produced no images and no usable error info.",
        fallbackEligible: true,
      },
    partial: images,
  };
}

function buildContents(
  prompt: string,
  references: ReferenceImageInput[],
): Array<{ role: "user"; parts: GoogleApiPart[] }> {
  const parts: GoogleApiPart[] = [];
  for (const ref of references) {
    parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
  }
  parts.push({ text: prompt });
  return [{ role: "user", parts }];
}

interface GoogleCallSuccess {
  ok: true;
  response: GoogleApiResponse;
  rawStatus: number;
  rawText: string;
}
interface GoogleCallFailure {
  ok: false;
  failure: FailureDetail;
}
type GoogleCallResult = GoogleCallSuccess | GoogleCallFailure;

async function callGoogleApi(args: {
  url: string;
  apiKey: string;
  body: unknown;
  timeoutMs: number;
  requestId: string;
}): Promise<GoogleCallResult> {
  const { url, apiKey, body, timeoutMs, requestId } = args;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
        "x-goog-request-params": `requestId=${requestId}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        failure: classifyHttpError(res.status, text),
      };
    }
    let parsed: GoogleApiResponse;
    try {
      parsed = JSON.parse(text) as GoogleApiResponse;
    } catch {
      return {
        ok: false,
        failure: {
          provider: "google",
          reason: "OTHER",
          message: "Google response was not valid JSON.",
          statusCode: res.status,
          fallbackEligible: true,
          raw: text.slice(0, 1000),
        },
      };
    }
    return { ok: true, response: parsed, rawStatus: res.status, rawText: text };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return {
        ok: false,
        failure: {
          provider: "google",
          reason: "TIMEOUT",
          message: `Google request timed out after ${timeoutMs}ms.`,
          fallbackEligible: true,
        },
      };
    }
    return {
      ok: false,
      failure: {
        provider: "google",
        reason: "OTHER",
        message: (err as Error).message ?? "Unknown Google error",
        fallbackEligible: true,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function classifyHttpError(status: number, body: string): FailureDetail {
  let reason: GoogleFailureReason = "OTHER";
  let fallbackEligible = false;

  if (status === 401 || status === 403) {
    reason = "AUTH";
    fallbackEligible = false;
  } else if (status === 400) {
    reason = "INVALID_REQUEST";
    fallbackEligible = false;
  } else if (status === 422) {
    reason = "CONTENT_BLOCKED";
    fallbackEligible = true;
  } else if (status === 429) {
    reason = "QUOTA";
    fallbackEligible = true;
  } else if (status === 503) {
    reason = "CAPACITY";
    fallbackEligible = true;
  } else if (status >= 500) {
    reason = "OTHER";
    fallbackEligible = true;
  }

  // Attempt to refine using body content (look for safety / capacity hints).
  const lower = body.toLowerCase();
  if (lower.includes("safety") || lower.includes("blocked")) {
    reason = "SAFETY";
    fallbackEligible = true;
  } else if (lower.includes("capacity") || lower.includes("overloaded")) {
    reason = "CAPACITY";
    fallbackEligible = true;
  } else if (lower.includes("quota") || lower.includes("rate")) {
    reason = "QUOTA";
    fallbackEligible = true;
  }

  return {
    provider: "google",
    reason,
    message: `Google HTTP ${status}: ${body.slice(0, 500)}`,
    statusCode: status,
    fallbackEligible,
    raw: body.slice(0, 1000),
  };
}

export function formatGoogleNoImageError(
  response: GoogleApiResponse,
  candidate?: GoogleApiCandidate,
): FailureDetail {
  const blockReason = response.promptFeedback?.blockReason;
  const finish = candidate?.finishReason;
  const safetyBlock = (candidate?.safetyRatings ?? []).some((r) => r.blocked);

  if (blockReason) {
    return {
      provider: "google",
      reason: "CONTENT_BLOCKED",
      message: `Prompt blocked: ${blockReason}${
        response.promptFeedback?.blockReasonMessage
          ? ` - ${response.promptFeedback.blockReasonMessage}`
          : ""
      }`,
      fallbackEligible: true,
    };
  }
  if (safetyBlock || finish === "SAFETY") {
    return {
      provider: "google",
      reason: "SAFETY",
      message: "Generation blocked by safety filters.",
      fallbackEligible: true,
    };
  }
  if (finish && finish !== "STOP") {
    return {
      provider: "google",
      reason: "IMAGE_OTHER",
      message: `Finished without image (reason: ${finish}).`,
      fallbackEligible: true,
    };
  }
  return {
    provider: "google",
    reason: "IMAGE_OTHER",
    message: "Google response contained no image parts.",
    fallbackEligible: true,
  };
}

function accumulateUsage(
  acc: GoogleTokenUsage,
  response: GoogleApiResponse,
  producedImage: boolean,
): void {
  const usage = response.usageMetadata;
  if (!usage) return;
  acc.inputTokens += usage.promptTokenCount ?? 0;

  const candidatesDetails = usage.candidatesTokensDetails ?? [];
  let textTokens = 0;
  let imageTokens = 0;
  let modalityFound = false;
  for (const detail of candidatesDetails) {
    if (detail.modality === "TEXT") {
      textTokens += detail.tokenCount ?? 0;
      modalityFound = true;
    } else if (detail.modality === "IMAGE") {
      imageTokens += detail.tokenCount ?? 0;
      modalityFound = true;
    }
  }
  if (modalityFound) {
    acc.outputTextTokens += textTokens;
    acc.outputImageTokens += imageTokens;
  } else {
    // Conservative fallback: if we got an image, assume all output is image tokens.
    const out = usage.candidatesTokenCount ?? 0;
    if (producedImage) acc.outputImageTokens += out;
    else acc.outputTextTokens += out;
  }
}

function randomId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Estimator: countTokens with local fallback
// ---------------------------------------------------------------------------

export interface EstimateGoogleTokensInput {
  params: NanoBananaParams;
  referenceImages: ReferenceImageInput[];
  apiKey: string | undefined;
}

export interface GoogleTokenEstimate {
  inputTokens: number;
  outputTextTokens: number;
  outputImageTokens: number;
  source: "count_tokens_api" | "local_fallback";
}

export async function estimateGoogleTokens(
  input: EstimateGoogleTokensInput,
): Promise<GoogleTokenEstimate> {
  const outputImagePerImage = ESTIMATED_OUTPUT_TOKENS_PER_IMAGE[input.params.resolution];
  const outputImageTokens = outputImagePerImage * input.params.num_images;

  if (input.apiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:countTokens`;
      const body = {
        contents: buildContents(input.params.prompt, input.referenceImages),
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": input.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const json = (await res.json()) as { totalTokens?: number };
        if (typeof json.totalTokens === "number" && json.totalTokens > 0) {
          return {
            inputTokens: json.totalTokens,
            outputTextTokens: 0,
            outputImageTokens,
            source: "count_tokens_api",
          };
        }
      }
    } catch {
      // fall through to local fallback
    }
  }

  const promptTokens = Math.ceil(input.params.prompt.length / 4);
  const referenceTokens = input.referenceImages.length * 560;
  return {
    inputTokens: promptTokens + referenceTokens,
    outputTextTokens: 0,
    outputImageTokens,
    source: "local_fallback",
  };
}
