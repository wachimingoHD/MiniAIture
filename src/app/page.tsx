"use client";

import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  ASPECT_RATIOS,
  DEFAULT_NANO_BANANA_PARAMS,
  MAX_REFERENCE_IMAGES,
  MAX_REFERENCE_IMAGES_TOTAL_BYTES,
  type AspectRatio,
  type CostEstimateResponse,
  type GenerateResponse,
  type NanoBananaParams,
  type ReferenceImageInput,
} from "@/lib/nanoBanana";
import { computeGenerationCreditsCost, type UserFacingResolution } from "@/lib/firestore/credit-pricing";
import {
  getCurrentIdToken,
  signInWithGoogle,
  signOutUser,
  subscribeToAuthState,
} from "@/lib/auth/firebase-client";

interface UploadedReference {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  base64: string;
  previewUrl: string;
}

const RESOLUTION_OPTIONS: Array<{ value: UserFacingResolution; label: string; creditsHint: string }> = [
  { value: "512", label: "512", creditsHint: "-25% credits" },
  { value: "1K", label: "1K", creditsHint: "No change" },
  { value: "2K", label: "2K", creditsHint: "+25% credits" },
  { value: "4K", label: "4K", creditsHint: "+50% credits" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatUsd(value: number): string {
  if (value < 0.001) return `$${value.toFixed(5)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(3)}`;
}

function formatEur(value: number): string {
  const eur = value * 0.92;
  if (eur < 0.001) return `${eur.toFixed(5)} EUR`;
  if (eur < 1) return `${eur.toFixed(4)} EUR`;
  return `${eur.toFixed(3)} EUR`;
}

function mapUserResolutionToParams(res: UserFacingResolution): Pick<NanoBananaParams, "resolution" | "upscale_enabled" | "upscale_resolution"> {
  if (res === "512") return { resolution: "512", upscale_enabled: false, upscale_resolution: "1K" };
  if (res === "1K") return { resolution: "512", upscale_enabled: true, upscale_resolution: "1K" };
  if (res === "2K") return { resolution: "1K", upscale_enabled: true, upscale_resolution: "2K" };
  return { resolution: "1K", upscale_enabled: true, upscale_resolution: "4K" };
}

export default function HomePage() {
  const [params, setParams] = useState<NanoBananaParams>(DEFAULT_NANO_BANANA_PARAMS);
  const [referenceImages, setReferenceImages] = useState<UploadedReference[]>([]);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<CostEstimateResponse | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [planLabel, setPlanLabel] = useState<"free" | "pro" | null>(null);
  const [creditSnapshot, setCreditSnapshot] = useState<{ daily: number; monthly: number } | null>(null);

  const [userResolution, setUserResolution] = useState<UserFacingResolution>("1K");
  const [lowPriorityMode, setLowPriorityMode] = useState(false);
  const [devSimEnabled, setDevSimEnabled] = useState(false);
  const [devSimReject, setDevSimReject] = useState(false);
  const [devOpen, setDevOpen] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const estimateAbortRef = useRef<AbortController | null>(null);

  const effectiveResolution: UserFacingResolution = planLabel === "free" ? "512" : userResolution;
  const effectiveLowPriority = planLabel === "free" ? true : lowPriorityMode;
  const pricingPlan = planLabel ?? "free";
  const isFreePlan = planLabel !== "pro";

  const derivedParams = useMemo<NanoBananaParams>(() => {
    const mapping = mapUserResolutionToParams(effectiveResolution);
    return {
      ...params,
      flex_mode: effectiveLowPriority,
      resolution: mapping.resolution,
      upscale_enabled: mapping.upscale_enabled,
      upscale_resolution: mapping.upscale_resolution,
    };
  }, [effectiveLowPriority, effectiveResolution, params]);

  const creditsCost = useMemo(() => {
    return computeGenerationCreditsCost({
      plan: pricingPlan,
      lowPriority: effectiveLowPriority,
      resolution: effectiveResolution,
    });
  }, [effectiveLowPriority, effectiveResolution, pricingPlan]);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState(async (user) => {
      if (!user) {
        setAuthEmail(null);
        setAuthToken(null);
        setPlanLabel(null);
        setCreditSnapshot(null);
        return;
      }
      setAuthEmail(user.email ?? "signed-in-user");
      const token = await user.getIdToken();
      setAuthToken(token);
      const creditsRes = await fetch("/api/user/credits", { headers: { Authorization: `Bearer ${token}` } });
      if (creditsRes.ok) {
        const payload = (await creditsRes.json()) as { plan?: "free" | "pro"; credits?: { daily: number; monthly: number } };
        setPlanLabel(payload.plan ?? null);
        if (payload.credits) setCreditSnapshot(payload.credits);
      }
    });
    return () => unsubscribe();
  }, []);

  const runEstimate = useCallback(async () => {
    if (!derivedParams.prompt.trim()) return;
    if (!authToken) {
      setEstimate(null);
      return;
    }
    estimateAbortRef.current?.abort();
    const controller = new AbortController();
    estimateAbortRef.current = controller;
    setEstimating(true);
    try {
      const refs: ReferenceImageInput[] = referenceImages.map((r) => ({ data: r.base64, mimeType: r.mimeType, filename: r.filename, size: r.size }));
      const res = await fetch("/api/estimate-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ params: derivedParams, referenceImages: refs }),
        signal: controller.signal,
      });
      if (res.ok) setEstimate((await res.json()) as CostEstimateResponse);
    } finally {
      setEstimating(false);
    }
  }, [authToken, derivedParams, referenceImages]);

  useEffect(() => {
    const handle = setTimeout(() => void runEstimate(), 500);
    return () => clearTimeout(handle);
  }, [runEstimate]);

  const addReferenceFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const next: UploadedReference[] = [...referenceImages];
    let totalBytes = next.reduce((acc, r) => acc + r.size, 0);
    let error: string | null = null;

    for (const file of arr) {
      if (next.length >= MAX_REFERENCE_IMAGES) {
        error = `Max ${MAX_REFERENCE_IMAGES} reference images.`;
        break;
      }
      if (!file.type.startsWith("image/")) {
        error = "Only image files are allowed.";
        continue;
      }
      if (totalBytes + file.size > MAX_REFERENCE_IMAGES_TOTAL_BYTES) {
        error = `Total size limit ${MAX_REFERENCE_IMAGES_TOTAL_BYTES / 1024 / 1024} MB exceeded.`;
        break;
      }
      const base64 = await fileToBase64(file);
      next.push({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 6)}`,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        base64,
        previewUrl: URL.createObjectURL(file),
      });
      totalBytes += file.size;
    }
    setReferenceImages(next);
    setReferenceError(error);
  }, [referenceImages]);

  const generate = async () => {
    if (!derivedParams.prompt.trim()) {
      setGenerationError("Prompt is required.");
      return;
    }
    const token = authToken ?? (await getCurrentIdToken());
    if (!token) {
      setGenerationError("Sign in is required before generating.");
      return;
    }
    setGenerating(true);
    setGenerationError(null);
    setResult(null);

    const refs: ReferenceImageInput[] = referenceImages.map((r) => ({ data: r.base64, mimeType: r.mimeType, filename: r.filename, size: r.size }));
    const devSimulationMode = devSimEnabled ? (devSimReject ? "reject" : "success") : "off";

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          params: derivedParams,
          referenceImages: refs,
          userFacingResolution: effectiveResolution,
          lowPriorityMode: effectiveLowPriority,
          devSimulationMode,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        setGenerationError(`Generation failed: ${text || res.statusText}`);
        return;
      }
      const data = JSON.parse(text) as GenerateResponse;
      setResult(data);
      if (data.creditsRemaining) setCreditSnapshot(data.creditsRemaining);
      if (data.userPlan) setPlanLabel(data.userPlan);
    } catch (err) {
      setGenerationError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const totalReferenceBytes = useMemo(() => referenceImages.reduce((acc, r) => acc + r.size, 0), [referenceImages]);

  return (
    <main className="mx-auto max-w-[1480px] px-4 py-6 md:px-8 md:py-10">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] pb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">MiniAItures</h1>
          <p className="text-xs text-[var(--color-text-muted)]">AI-generated YouTube thumbnails - Gemini + fal.ai</p>
        </div>
        <nav className="hidden items-center gap-4 text-sm text-[var(--color-text-secondary)] md:flex">
          <Link href="/pricing" className="hover:text-[var(--color-accent)]">Pricing</Link>
          <Link href="/gallery" className="hover:text-[var(--color-accent)]">Gallery</Link>
          {authEmail ? (
            <>
              <div className="text-right text-xs">
                <p className="text-[var(--color-text-primary)]">{authEmail}</p>
                <p className="text-[var(--color-text-muted)]">
                  {planLabel ? planLabel.toUpperCase() : "PLAN ?"}
                  {creditSnapshot ? ` - Daily ${creditSnapshot.daily} - Monthly ${creditSnapshot.monthly}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => void signOutUser()} className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm">Sign out</button>
            </>
          ) : (
            <button type="button" onClick={() => void signInWithGoogle()} className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm">Sign in</button>
          )}
        </nav>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
        <section className="space-y-5">
          <Panel title="Prompt">
            <textarea value={params.prompt} onChange={(e) => setParams({ ...params, prompt: e.target.value })} placeholder="Describe the thumbnail you want" rows={5} className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2.5 text-sm" />
          </Panel>

          <Panel title="Reference images" subtitle={`${referenceImages.length}/${MAX_REFERENCE_IMAGES} files, ${formatBytes(totalReferenceBytes)} of ${formatBytes(MAX_REFERENCE_IMAGES_TOTAL_BYTES)}`}>
            <div className={`rounded-md border border-dashed px-4 py-5 text-center ${isDragging ? "border-[var(--color-accent)]" : "border-[var(--color-border-strong)]"}`} onDrop={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(false); void addReferenceFiles(e.dataTransfer.files); }} onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}>
              <button type="button" className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm" onClick={() => fileInputRef.current?.click()}>Browse files</button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.files?.length) void addReferenceFiles(e.target.files); e.target.value = ""; }} />
            </div>
            {referenceError && <p className="mt-2 text-xs text-[var(--color-danger)]">{referenceError}</p>}
          </Panel>

          <Panel title="User options">
            <div className="space-y-4">
              <label className="flex items-center justify-between text-sm">
                <span>{isFreePlan ? "Low priority mode" : "Low priority mode (-25% credits)"}</span>
                <input type="checkbox" checked={effectiveLowPriority} disabled={planLabel === "free"} onChange={(e) => setLowPriorityMode(e.target.checked)} />
              </label>
              {planLabel === "free" && <p className="text-xs text-[var(--color-text-muted)]">Free users always run in low priority mode and cannot disable it.</p>}

              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Resolution</p>
                <div className="grid grid-cols-2 gap-2">
                  {RESOLUTION_OPTIONS.map((opt) => {
                    if (planLabel === "pro" && opt.value === "512") return null;
                    const disabled = planLabel === "free" && opt.value !== "512";
                    const active = effectiveResolution === opt.value;
                    const freeHint = opt.value === "512" ? "Free included" : "Pro feature";
                    const hint = planLabel === "free" ? freeHint : opt.creditsHint;
                    return (
                      <button key={opt.value} type="button" disabled={disabled} onClick={() => setUserResolution(opt.value)} className={`rounded-md border px-2 py-2 text-xs ${active ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border-strong)]"} disabled:opacity-40`}>
                        <span className="block font-semibold">{opt.label}</span>
                        <span className="block text-[10px] text-[var(--color-text-muted)]">{hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </Panel>

          <details open={devOpen} onToggle={(e) => setDevOpen((e.target as HTMLDetailsElement).open)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4">
            <summary className="cursor-pointer text-sm font-semibold">Developer parameters</summary>
            <div className="mt-3 space-y-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={devSimEnabled} onChange={(e) => setDevSimEnabled(e.target.checked)} /> Simulate generation (no real image)</label>
              {devSimEnabled && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={devSimReject} onChange={(e) => setDevSimReject(e.target.checked)} /> Simulate rejection</label>}
              <Field label="Aspect ratio" defaultValue={DEFAULT_NANO_BANANA_PARAMS.aspect_ratio} value={params.aspect_ratio} onReset={() => setParams({ ...params, aspect_ratio: DEFAULT_NANO_BANANA_PARAMS.aspect_ratio })}>
                <SelectChips value={params.aspect_ratio} options={ASPECT_RATIOS} onChange={(v) => setParams({ ...params, aspect_ratio: v as AspectRatio })} />
              </Field>
              <pre className="max-h-56 overflow-auto rounded-md bg-[var(--color-bg-panel-2)] p-3 text-[11px]">{JSON.stringify(derivedParams, null, 2)}</pre>
            </div>
          </details>

          <button type="button" disabled={generating || !derivedParams.prompt.trim()} onClick={generate} className="w-full rounded-md bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-black disabled:opacity-50">
            {generating ? "Generating..." : `Generate thumbnail (${creditsCost} credits${creditSnapshot ? ` | Balance D ${creditSnapshot.daily} M ${creditSnapshot.monthly}` : ""})`}
          </button>

          {generationError && <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 text-xs">{generationError}</div>}
        </section>

        <section className="space-y-6">
          <CostPanel estimate={estimate} estimating={estimating} hasPrompt={Boolean(derivedParams.prompt.trim())} signedIn={Boolean(authToken)} />
          <ResultPanel result={result} generating={generating} />
        </section>
      </div>
    </main>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4"><header className="mb-3 flex items-baseline justify-between"><h2 className="text-sm font-semibold tracking-tight">{title}</h2>{subtitle && <span className="text-xs text-[var(--color-text-muted)]">{subtitle}</span>}</header>{children}</div>;
}

interface FieldProps<T> { label: string; defaultValue: T; value: T; onReset: () => void; children: React.ReactNode }
function Field<T>({ label, defaultValue, value, onReset, children }: FieldProps<T>) {
  const isDefault = defaultValue === value;
  return <div><div className="mb-1.5 flex items-center justify-between"><span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</span>{!isDefault && <button type="button" onClick={onReset} className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Default</button>}</div>{children}</div>;
}

function SelectChips<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return <div className="flex flex-wrap gap-1.5">{options.map((opt) => <button key={opt} type="button" onClick={() => onChange(opt)} className={`rounded-md border px-2.5 py-1 text-xs ${value === opt ? "border-[var(--color-accent)]" : "border-[var(--color-border-strong)]"}`}>{opt}</button>)}</div>;
}

function CostPanel({
  estimate,
  estimating,
  hasPrompt,
  signedIn,
}: {
  estimate: CostEstimateResponse | null;
  estimating: boolean;
  hasPrompt: boolean;
  signedIn: boolean;
}) {
  const cheaperProvider = useMemo(() => {
    if (!estimate) return null;
    return estimate.fal.total <= estimate.google.total ? "fal" : "google";
  }, [estimate]);

  return (
    <Panel title="Estimated cost (before generation)">
      {!hasPrompt && (
        <p className="text-sm text-[var(--color-text-muted)]">Enter a prompt to see cost estimates.</p>
      )}
      {hasPrompt && !signedIn && (
        <p className="text-sm text-[var(--color-text-muted)]">Sign in to see cost estimates.</p>
      )}
      {hasPrompt && signedIn && estimating && !estimate && (
        <p className="text-sm text-[var(--color-text-secondary)]">Calculating...</p>
      )}
      {estimate && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CostCard
            title="Upscale"
            highlight={estimate.upscale.enabled}
            primary={`${formatUsd(estimate.upscale.totalEstimatedCost)} · ${formatEur(estimate.upscale.totalEstimatedCost)}`}
            secondary={
              estimate.upscale.enabled
                ? `Per image: ${formatUsd(estimate.upscale.estimatedCostPerImage)} -> target ${estimate.upscale.targetResolution}`
                : "Disabled"
            }
            note={estimate.upscale.notes}
          />
          <CostCard
            title="Google Gemini"
            highlight={cheaperProvider === "google"}
            primary={`${formatUsd(estimate.google.total)} · ${formatEur(estimate.google.total)}`}
            secondary={`Per image: ${formatUsd(estimate.google.perImage)}${estimate.google.includesUpscale ? " · incl. upscale" : ""}`}
            note={(estimate.google.notes ?? []).join(" ")}
          />
          <CostCard
            title="fal.ai"
            highlight={cheaperProvider === "fal"}
            primary={`${formatUsd(estimate.fal.total)} · ${formatEur(estimate.fal.total)}`}
            secondary={`Per image: ${formatUsd(estimate.fal.perImage)}${estimate.fal.includesUpscale ? " · incl. upscale" : ""}`}
            note={(estimate.fal.notes ?? []).join(" ")}
          />
        </div>
      )}
    </Panel>
  );
}

function CostCard({
  title,
  primary,
  secondary,
  note,
  highlight,
}: {
  title: string;
  primary: string;
  secondary: string;
  note?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        highlight
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
          : "border-[var(--color-border)] bg-[var(--color-bg-panel-2)]"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">{title}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums">{primary}</p>
      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{secondary}</p>
      {note && <p className="mt-1.5 text-[10px] text-[var(--color-text-muted)]">{note}</p>}
    </div>
  );
}

function ResultPanel({ result, generating }: { result: GenerateResponse | null; generating: boolean }) {
  if (generating) {
    return (
      <Panel title="Result">
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-video w-full rounded-md shimmer" />
          ))}
        </div>
        <p className="mt-3 text-sm text-[var(--color-text-secondary)]">Generating thumbnails...</p>
      </Panel>
    );
  }
  if (!result) {
    return (
      <Panel title="Result">
        <p className="text-sm text-[var(--color-text-muted)]">No generation yet. Generate a thumbnail to see the result here.</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Result"
      subtitle={`${result.providerUsed.toUpperCase()} - ${result.images.length} image(s) - ${formatUsd(result.cost.total)} total`}
    >
      {result.fallbackTriggered && (
        <Banner>
          Fell back to fal.ai because Google failed: {result.fallbackReason}
        </Banner>
      )}
      {result.googleTierFallback && (
        <Banner>
          Flex was rate-limited; retried in Standard tier transparently.
        </Banner>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {result.images.map((img, i) => (
          <figure key={i} className="overflow-hidden rounded-md border border-[var(--color-border)] bg-black/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:${img.mimeType};base64,${img.data}`}
              alt={`Generated thumbnail ${i + 1}`}
              className="block w-full"
            />
            <figcaption className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
              <span>
                {img.source} {img.upscaled ? "- upscaled" : ""} {img.width && img.height ? `- ${img.width}x${img.height}` : ""}
              </span>
              <a
                href={`data:${img.mimeType};base64,${img.data}`}
                download={`thumbnail-${result.requestId}-${i + 1}.png`}
                className="text-[var(--color-accent)] hover:underline"
              >
                Download
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
      <details className="mt-4 text-xs text-[var(--color-text-secondary)]">
        <summary className="cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
          Generation metadata
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-[var(--color-bg-panel-2)] p-3 text-[11px]">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </Panel>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-md border border-[var(--color-info)]/40 bg-[var(--color-info)]/10 p-2.5 text-xs text-[var(--color-text-secondary)]">
      {children}
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
