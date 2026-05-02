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
import {
  ASPECT_RATIOS,
  DEFAULT_NANO_BANANA_PARAMS,
  MAX_REFERENCE_IMAGES,
  MAX_REFERENCE_IMAGES_TOTAL_BYTES,
  RESOLUTIONS,
  UPSCALE_RESOLUTIONS,
  type AspectRatio,
  type CostEstimateResponse,
  type GenerateResponse,
  type NanoBananaParams,
  type ReferenceImageInput,
  type Resolution,
  type UpscaleResolution,
} from "@/lib/nanoBanana";
import {
  type HistoryEntry,
  clearHistory,
  deleteHistory,
  listHistory,
  migrateLegacyIfNeeded,
  newHistoryId,
  saveHistory,
} from "@/lib/history";

interface UploadedReference {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  base64: string;
  previewUrl: string;
}

const USD_TO_EUR = 0.92;

function formatUsd(value: number): string {
  if (value < 0.001) return `$${value.toFixed(5)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(3)}`;
}

function formatEur(value: number): string {
  const eur = value * USD_TO_EUR;
  if (eur < 0.001) return `${eur.toFixed(5)}€`;
  if (eur < 1) return `${eur.toFixed(4)}€`;
  return `${eur.toFixed(3)}€`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function HomePage() {
  const [params, setParams] = useState<NanoBananaParams>(DEFAULT_NANO_BANANA_PARAMS);
  const [referenceImages, setReferenceImages] = useState<UploadedReference[]>([]);
  const [referenceError, setReferenceError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<CostEstimateResponse | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const estimateAbortRef = useRef<AbortController | null>(null);

  // -------------------------------------------------------------------------
  // History bootstrap
  // -------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await migrateLegacyIfNeeded();
        if (!mounted) return;
        setHistory(await listHistory());
      } catch (err) {
        console.warn("history bootstrap failed", err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Auto-estimate cost on params changes
  // -------------------------------------------------------------------------
  const runEstimate = useCallback(async () => {
    estimateAbortRef.current?.abort();
    const controller = new AbortController();
    estimateAbortRef.current = controller;
    setEstimating(true);
    setEstimateError(null);
    try {
      const refs: ReferenceImageInput[] = referenceImages.map((r) => ({
        data: r.base64,
        mimeType: r.mimeType,
        filename: r.filename,
        size: r.size,
      }));
      const res = await fetch("/api/estimate-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params, referenceImages: refs }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        setEstimateError(`Estimate failed: ${text || res.statusText}`);
        setEstimate(null);
      } else {
        const data = (await res.json()) as CostEstimateResponse;
        setEstimate(data);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setEstimateError((err as Error).message);
      }
    } finally {
      setEstimating(false);
    }
  }, [params, referenceImages]);

  useEffect(() => {
    if (!params.prompt.trim()) {
      // No prompt: just abort any inflight request. The displayed estimate
      // is gated on prompt being non-empty in the render, so no setState
      // is needed here.
      estimateAbortRef.current?.abort();
      return;
    }
    const handle = setTimeout(() => {
      void runEstimate();
    }, 600);
    return () => clearTimeout(handle);
  }, [params.prompt, runEstimate]);

  const displayedEstimate = params.prompt.trim() ? estimate : null;
  const displayedEstimateError = params.prompt.trim() ? estimateError : null;

  // -------------------------------------------------------------------------
  // Reference images
  // -------------------------------------------------------------------------
  const addReferenceFiles = useCallback(
    async (files: FileList | File[]) => {
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
    },
    [referenceImages],
  );

  const onFilesPicked = (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    void addReferenceFiles(e.target.files);
    e.target.value = ""; // allow re-picking the same file
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      void addReferenceFiles(e.dataTransfer.files);
    }
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const removeReference = (id: string) => {
    setReferenceImages((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((r) => r.id !== id);
    });
  };
  const clearReferences = () => {
    referenceImages.forEach((r) => URL.revokeObjectURL(r.previewUrl));
    setReferenceImages([]);
  };

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------
  const generate = async () => {
    if (!params.prompt.trim()) {
      setGenerationError("Prompt is required.");
      return;
    }
    setGenerating(true);
    setGenerationError(null);
    setResult(null);
    const refs: ReferenceImageInput[] = referenceImages.map((r) => ({
      data: r.base64,
      mimeType: r.mimeType,
      filename: r.filename,
      size: r.size,
    }));
    const startMs = Date.now();
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params, referenceImages: refs }),
      });
      const text = await res.text();
      if (!res.ok) {
        setGenerationError(`Generation failed: ${text || res.statusText}`);
        return;
      }
      const data = JSON.parse(text) as GenerateResponse;
      setResult(data);

      // Save in history
      const entry: HistoryEntry = {
        id: newHistoryId(),
        createdAt: data.createdAt,
        durationMs: Date.now() - startMs,
        providerUsed: data.providerUsed,
        endpointId: data.endpointId,
        requestId: data.requestId,
        paramsUsed: data.paramsUsed,
        referenceImages: data.referenceImages,
        cost: data.cost,
        images: data.images,
        originalImages: data.originalImages,
      };
      try {
        await saveHistory(entry);
        setHistory(await listHistory());
      } catch (err) {
        console.warn("save history failed", err);
      }
    } catch (err) {
      setGenerationError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const removeHistoryEntry = async (id: string) => {
    await deleteHistory(id);
    setHistory(await listHistory());
  };

  const clearAllHistory = async () => {
    if (!confirm("Clear all local history?")) return;
    await clearHistory();
    setHistory([]);
  };

  // -------------------------------------------------------------------------
  // UI helpers
  // -------------------------------------------------------------------------

  const totalReferenceBytes = useMemo(
    () => referenceImages.reduce((acc, r) => acc + r.size, 0),
    [referenceImages],
  );

  return (
    <main className="mx-auto max-w-[1480px] px-4 py-6 md:px-8 md:py-10">
      <Header />

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
        <section className="space-y-5">
          <Panel title="Prompt">
            <textarea
              value={params.prompt}
              onChange={(e) => setParams({ ...params, prompt: e.target.value })}
              placeholder="Describe the thumbnail you want. Be specific about subject, style, colors, mood..."
              rows={5}
              className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2.5 text-sm leading-relaxed placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
            />
            <DefaultRow
              label="Reset prompt"
              onReset={() => setParams((p) => ({ ...p, prompt: "" }))}
            />
          </Panel>

          <Panel title="Reference images" subtitle={`${referenceImages.length}/${MAX_REFERENCE_IMAGES} files, ${formatBytes(totalReferenceBytes)} of ${formatBytes(MAX_REFERENCE_IMAGES_TOTAL_BYTES)}`}>
            <div
              className={`rounded-md border border-dashed px-4 py-5 text-center transition ${
                isDragging
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                  : "border-[var(--color-border-strong)] bg-[var(--color-bg-panel-2)]"
              }`}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
            >
              <p className="text-sm text-[var(--color-text-secondary)]">
                Drag & drop images here, or
              </p>
              <button
                type="button"
                className="mt-2 inline-flex items-center rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-panel)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                onClick={() => fileInputRef.current?.click()}
              >
                Browse files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onFilesPicked}
              />
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                PNG, JPG, WEBP. Max {MAX_REFERENCE_IMAGES} files,{" "}
                {MAX_REFERENCE_IMAGES_TOTAL_BYTES / 1024 / 1024} MB total.
              </p>
            </div>
            {referenceError && <p className="mt-2 text-xs text-[var(--color-danger)]">{referenceError}</p>}

            {referenceImages.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {referenceImages.map((r) => (
                  <div key={r.id} className="group relative overflow-hidden rounded-md border border-[var(--color-border)] bg-black/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.previewUrl} alt={r.filename} className="aspect-square w-full object-cover" />
                    <button
                      type="button"
                      className="absolute right-1 top-1 rounded-md bg-black/70 px-1.5 py-0.5 text-xs text-white opacity-0 transition group-hover:opacity-100"
                      onClick={() => removeReference(r.id)}
                    >
                      Remove
                    </button>
                    <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 text-[10px] text-white">
                      {r.filename.length > 20 ? `${r.filename.slice(0, 18)}…` : r.filename}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {referenceImages.length > 0 && (
              <button
                type="button"
                className="mt-3 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
                onClick={clearReferences}
              >
                Clear all
              </button>
            )}
          </Panel>

          <Panel title="Generation parameters">
            <div className="space-y-4">
              <Field label="Number of images" defaultValue={DEFAULT_NANO_BANANA_PARAMS.num_images} value={params.num_images} onReset={() => setParams({ ...params, num_images: DEFAULT_NANO_BANANA_PARAMS.num_images })}>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={4}
                    value={params.num_images}
                    onChange={(e) => setParams({ ...params, num_images: Number(e.target.value) })}
                    className="flex-1"
                  />
                  <span className="w-6 text-right text-sm tabular-nums">{params.num_images}</span>
                </div>
              </Field>

              <Field label="Aspect ratio" defaultValue={DEFAULT_NANO_BANANA_PARAMS.aspect_ratio} value={params.aspect_ratio} onReset={() => setParams({ ...params, aspect_ratio: DEFAULT_NANO_BANANA_PARAMS.aspect_ratio })}>
                <SelectChips
                  value={params.aspect_ratio}
                  options={ASPECT_RATIOS}
                  onChange={(v) => setParams({ ...params, aspect_ratio: v as AspectRatio })}
                />
              </Field>

              <Field label="Resolution" defaultValue={DEFAULT_NANO_BANANA_PARAMS.resolution} value={params.resolution} onReset={() => setParams({ ...params, resolution: DEFAULT_NANO_BANANA_PARAMS.resolution })}>
                <SelectChips
                  value={params.resolution}
                  options={RESOLUTIONS}
                  onChange={(v) => setParams({ ...params, resolution: v as Resolution })}
                />
              </Field>

              <ToggleField
                label="Flex mode"
                description="~50% cheaper. Variable latency: 10–15s in low-traffic windows, up to a few minutes during peak."
                checked={params.flex_mode}
                onChange={(v) => setParams({ ...params, flex_mode: v })}
                onReset={() => setParams({ ...params, flex_mode: DEFAULT_NANO_BANANA_PARAMS.flex_mode })}
                isDefault={params.flex_mode === DEFAULT_NANO_BANANA_PARAMS.flex_mode}
              />

              <ToggleField
                label="Enable Google Search grounding"
                description="Lets Gemini search the web for context. May incur extra Google charges."
                checked={params.enable_google_search}
                onChange={(v) => setParams({ ...params, enable_google_search: v })}
                onReset={() => setParams({ ...params, enable_google_search: DEFAULT_NANO_BANANA_PARAMS.enable_google_search })}
                isDefault={params.enable_google_search === DEFAULT_NANO_BANANA_PARAMS.enable_google_search}
              />
            </div>
          </Panel>

          <Panel title="Upscale (post-process via fal.ai seedvr)">
            <ToggleField
              label="Enable upscaling"
              checked={params.upscale_enabled}
              onChange={(v) => setParams({ ...params, upscale_enabled: v })}
              onReset={() => setParams({ ...params, upscale_enabled: DEFAULT_NANO_BANANA_PARAMS.upscale_enabled })}
              isDefault={params.upscale_enabled === DEFAULT_NANO_BANANA_PARAMS.upscale_enabled}
            />
            <Field label="Target resolution" defaultValue={DEFAULT_NANO_BANANA_PARAMS.upscale_resolution} value={params.upscale_resolution} onReset={() => setParams({ ...params, upscale_resolution: DEFAULT_NANO_BANANA_PARAMS.upscale_resolution })}>
              <SelectChips
                value={params.upscale_resolution}
                options={UPSCALE_RESOLUTIONS}
                onChange={(v) => setParams({ ...params, upscale_resolution: v as UpscaleResolution })}
                disabled={!params.upscale_enabled}
              />
            </Field>
            <p className="text-xs text-[var(--color-text-muted)]">
              Only runs when target is higher than the base resolution.
            </p>
          </Panel>

          <button
            type="button"
            disabled={generating || !params.prompt.trim()}
            onClick={generate}
            className="w-full rounded-md bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-black transition hover:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate thumbnail"}
          </button>

          {params.flex_mode && (
            <div className="rounded-md border border-[var(--color-info)]/40 bg-[var(--color-info)]/10 p-3 text-xs text-[var(--color-text-secondary)]">
              <strong className="text-[var(--color-text-primary)]">Flex mode is on.</strong>{" "}
              Generation can take from a few seconds up to several minutes depending on Google capacity at this hour.
            </div>
          )}
          {generationError && (
            <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 text-xs text-[var(--color-text-secondary)]">
              <strong className="text-[var(--color-danger)]">Error:</strong> {generationError}
            </div>
          )}
        </section>

        <section className="space-y-6">
          <CostPanel estimate={displayedEstimate} estimating={estimating} error={displayedEstimateError} params={params} />
          <ResultPanel result={result} generating={generating} />
          <HistoryPanel
            history={history}
            onDelete={removeHistoryEntry}
            onClear={clearAllHistory}
          />
        </section>
      </div>

      <Footer />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function Header() {
  return (
    <header className="flex items-center justify-between border-b border-[var(--color-border)] pb-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-accent)] text-black">
          <span className="text-lg font-bold">M</span>
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">MiniAItures</h1>
          <p className="text-xs text-[var(--color-text-muted)]">
            AI-generated YouTube thumbnails — Gemini + fal.ai
          </p>
        </div>
      </div>
      <nav className="hidden items-center gap-4 text-sm text-[var(--color-text-secondary)] md:flex">
        <a href="#" className="hover:text-[var(--color-accent)]">Pricing</a>
        <a href="#" className="hover:text-[var(--color-accent)]">For creators</a>
        <a href="#" className="hover:text-[var(--color-accent)]">Affiliates</a>
        <button className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)]">
          Sign in
        </button>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-[var(--color-border)] pt-6 text-xs text-[var(--color-text-muted)]">
      <p>
        Free plan: 100 daily credits, 512px output, watermark, Gemini Flex only. Pro: more credits, higher resolutions, persistent gallery, no watermark.
      </p>
      <p className="mt-1">100 credits = 1 thumbnail. Resets 24h after first daily use.</p>
    </footer>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {subtitle && <span className="text-xs text-[var(--color-text-muted)]">{subtitle}</span>}
      </header>
      {children}
    </div>
  );
}

function DefaultRow({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      className="mt-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
    >
      {label}
    </button>
  );
}

interface FieldProps<T> {
  label: string;
  defaultValue: T;
  value: T;
  onReset: () => void;
  children: React.ReactNode;
}

function Field<T>({ label, defaultValue, value, onReset, children }: FieldProps<T>) {
  const isDefault = defaultValue === value;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</span>
        {!isDefault && (
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
          >
            Default
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
  onReset,
  isDefault,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  onReset: () => void;
  isDefault: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--color-border-strong)]"
          />
          <span>{label}</span>
        </label>
        {description && (
          <p className="mt-1 pl-6 text-xs text-[var(--color-text-muted)]">{description}</p>
        )}
      </div>
      {!isDefault && (
        <button
          type="button"
          onClick={onReset}
          className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
        >
          Default
        </button>
      )}
    </div>
  );
}

function SelectChips<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt)}
            className={`rounded-md border px-2.5 py-1 text-xs transition ${
              active
                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : "border-[var(--color-border-strong)] bg-[var(--color-bg-panel-2)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function CostPanel({
  estimate,
  estimating,
  error,
  params,
}: {
  estimate: CostEstimateResponse | null;
  estimating: boolean;
  error: string | null;
  params: NanoBananaParams;
}) {
  const cheaperProvider = useMemo(() => {
    if (!estimate) return null;
    return estimate.fal.total <= estimate.google.total ? "fal" : "google";
  }, [estimate]);

  return (
    <Panel title="Estimated cost (before generation)">
      {!params.prompt.trim() && (
        <p className="text-sm text-[var(--color-text-muted)]">Enter a prompt to see cost estimates.</p>
      )}
      {params.prompt.trim() && estimating && !estimate && (
        <p className="text-sm text-[var(--color-text-secondary)]">Calculating…</p>
      )}
      {error && (
        <p className="text-xs text-[var(--color-danger)]">{error}</p>
      )}
      {estimate && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CostCard
            title="Upscale"
            highlight={estimate.upscale.enabled}
            primary={`${formatUsd(estimate.upscale.totalEstimatedCost)} · ${formatEur(estimate.upscale.totalEstimatedCost)}`}
            secondary={
              estimate.upscale.enabled
                ? `Per image: ${formatUsd(estimate.upscale.estimatedCostPerImage)} → target ${estimate.upscale.targetResolution}`
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
        <p className="mt-3 text-sm text-[var(--color-text-secondary)] animate-pulse-soft">
          Generating thumbnails...
        </p>
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
      subtitle={`${result.providerUsed.toUpperCase()} · ${result.images.length} image(s) · ${formatUsd(result.cost.total)} total`}
    >
      {result.fallbackTriggered && (
        <Banner kind="info">
          Fell back to fal.ai because Google failed: {result.fallbackReason}
        </Banner>
      )}
      {result.googleTierFallback && (
        <Banner kind="info">
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
                {img.source} {img.upscaled ? "· upscaled" : ""} {img.width && img.height ? `· ${img.width}×${img.height}` : ""}
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
      {result.originalImages && result.originalImages.length > 0 && (
        <details className="mt-3 text-xs text-[var(--color-text-secondary)]">
          <summary className="cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
            View pre-upscale originals ({result.originalImages.length})
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {result.originalImages.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={`data:${img.mimeType};base64,${img.data}`}
                alt={`Original ${i + 1}`}
                className="rounded-md border border-[var(--color-border)]"
              />
            ))}
          </div>
        </details>
      )}
      <details className="mt-4 text-xs text-[var(--color-text-secondary)]">
        <summary className="cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
          Generation metadata
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-[var(--color-bg-panel-2)] p-3 text-[11px]">
          {JSON.stringify(
            {
              providerUsed: result.providerUsed,
              endpointId: result.endpointId,
              requestId: result.requestId,
              cost: result.cost,
              paramsUsed: result.paramsUsed,
              referenceImages: result.referenceImages,
              fallbackInfo: result.fallbackInfo,
              googleTierFallback: result.googleTierFallback,
              primaryFailure: result.primaryFailure,
              startedAt: result.startedAt,
              endedAt: result.endedAt,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </Panel>
  );
}

function Banner({ kind, children }: { kind: "info" | "danger"; children: React.ReactNode }) {
  const cls =
    kind === "info"
      ? "border-[var(--color-info)]/40 bg-[var(--color-info)]/10"
      : "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10";
  return (
    <div className={`mb-3 rounded-md border p-2.5 text-xs text-[var(--color-text-secondary)] ${cls}`}>
      {children}
    </div>
  );
}

function HistoryPanel({
  history,
  onDelete,
  onClear,
}: {
  history: HistoryEntry[];
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  if (history.length === 0) {
    return (
      <Panel title="Local history">
        <p className="text-sm text-[var(--color-text-muted)]">
          History will appear here. Stored locally in your browser (IndexedDB), max 40 entries.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Local history" subtitle={`${history.length} entries`}>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
        >
          Clear all
        </button>
      </div>
      <ul className="space-y-3">
        {history.map((entry) => (
          <li key={entry.id} className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="line-clamp-2 text-sm">{entry.paramsUsed.prompt}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {new Date(entry.createdAt).toLocaleString()} · {entry.providerUsed} ·{" "}
                  {entry.paramsUsed.resolution} · {entry.paramsUsed.aspect_ratio} ·{" "}
                  {formatUsd(entry.cost.total)} · {(entry.durationMs / 1000).toFixed(1)}s
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDelete(entry.id)}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
              >
                Delete
              </button>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {entry.images.slice(0, 4).map((img, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={`History ${i + 1}`}
                  className="aspect-square rounded-md border border-[var(--color-border)] object-cover"
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
