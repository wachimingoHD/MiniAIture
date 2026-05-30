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
import { STYLE_PRESETS } from "@/lib/constants/style-presets";
import {
  getCurrentIdToken,
  signInWithGoogle,
  signOutUser,
  subscribeToAuthState,
} from "@/lib/auth/firebase-client";

type StyleMode = "preset" | "custom" | "gallery";

const FORM_STORAGE_KEY = "miniaitura:genform:v1";

interface PersistedReference {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  base64: string;
}

interface PersistedForm {
  params: NanoBananaParams;
  videoTitle: string;
  referenceInstructions: string;
  styleMode: StyleMode;
  selectedPresetId: string | null;
  customStyle: string;
  galleryStyle: { id: string; prompt: string } | null;
  userResolution: UserFacingResolution;
  lowPriorityMode: boolean;
  referenceImages: PersistedReference[];
}

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

  // Campos del formulario (doc §4)
  const [videoTitle, setVideoTitle] = useState(""); // campo 1
  const [referenceInstructions, setReferenceInstructions] = useState(""); // campo 3
  const [styleMode, setStyleMode] = useState<StyleMode>("preset"); // campo 4
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [customStyle, setCustomStyle] = useState("");
  const [galleryStyle, setGalleryStyle] = useState<{ id: string; prompt: string } | null>(null);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);

  // Estilo efectivo derivado de la selección del campo 4.
  const styleSelection = useMemo(() => {
    if (styleMode === "preset" && selectedPresetId) {
      const p = STYLE_PRESETS.find((x) => x.id === selectedPresetId);
      return { styleType: "preset" as const, styleId: selectedPresetId, stylePrompt: p?.prompt ?? "", nicho: p?.nicho ?? null };
    }
    if (styleMode === "gallery" && galleryStyle) {
      return { styleType: "gallery" as const, styleId: galleryStyle.id, stylePrompt: galleryStyle.prompt, nicho: null };
    }
    return { styleType: "custom" as const, styleId: null, stylePrompt: customStyle, nicho: null };
  }, [styleMode, selectedPresetId, customStyle, galleryStyle]);

  // Precarga de estilo desde la galería pública (doc §6.3, ?styleFrom=<id>).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("styleFrom");
    if (!id) return;
    void (async () => {
      try {
        const res = await fetch(`/api/generations/${id}`);
        if (!res.ok) return;
        const data = (await res.json()) as { stylePrompt?: string | null };
        if (data.stylePrompt) {
          setStyleMode("gallery");
          setGalleryStyle({ id, prompt: data.stylePrompt });
        }
      } catch {
        // ignorar: la precarga es opcional
      }
    })();
  }, []);

  // -------- Persistencia del formulario (fix: no perder el texto al navegar) --------
  // El formulario vive en una ruta distinta a la galería; navegar desmonta el
  // componente y se perdía el estado. Guardamos en sessionStorage y restauramos
  // al montar, de modo que todos los campos (incluida la imagen subida y el
  // estilo) quedan intactos al volver.
  const formHydratedRef = useRef(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- hidratación desde sessionStorage tras el primer render (evita mismatch SSR) */
    try {
      const raw = sessionStorage.getItem(FORM_STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<PersistedForm>;
        if (s.params) setParams(s.params);
        if (typeof s.videoTitle === "string") setVideoTitle(s.videoTitle);
        if (typeof s.referenceInstructions === "string") setReferenceInstructions(s.referenceInstructions);
        if (s.styleMode) setStyleMode(s.styleMode);
        if (s.selectedPresetId !== undefined) setSelectedPresetId(s.selectedPresetId);
        if (typeof s.customStyle === "string") setCustomStyle(s.customStyle);
        if (s.galleryStyle !== undefined) setGalleryStyle(s.galleryStyle);
        if (s.userResolution) setUserResolution(s.userResolution);
        if (typeof s.lowPriorityMode === "boolean") setLowPriorityMode(s.lowPriorityMode);
        if (Array.isArray(s.referenceImages)) {
          setReferenceImages(
            s.referenceImages.map((r) => ({ ...r, previewUrl: `data:${r.mimeType};base64,${r.base64}` })),
          );
        }
      }
    } catch {
      // sessionStorage no disponible o JSON corrupto: empezar limpio.
    }
    formHydratedRef.current = true;
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!formHydratedRef.current) return;
    const core = {
      params,
      videoTitle,
      referenceInstructions,
      styleMode,
      selectedPresetId,
      customStyle,
      galleryStyle,
      userResolution,
      lowPriorityMode,
    };
    const refs = referenceImages.map((r) => ({
      id: r.id,
      filename: r.filename,
      mimeType: r.mimeType,
      size: r.size,
      base64: r.base64,
    }));
    try {
      sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify({ ...core, referenceImages: refs }));
    } catch {
      // Cuota excedida (imágenes grandes): guardar sin imágenes.
      try {
        sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify({ ...core, referenceImages: [] }));
      } catch {
        // sin persistencia disponible
      }
    }
  }, [
    params,
    videoTitle,
    referenceInstructions,
    styleMode,
    selectedPresetId,
    customStyle,
    galleryStyle,
    userResolution,
    lowPriorityMode,
    referenceImages,
  ]);

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

  const insufficientCredits = creditSnapshot
    ? creditSnapshot.daily + creditSnapshot.monthly < creditsCost
    : false;

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
          // Campos del enhancer / generations (doc §3.3 / §4 / §10)
          videoTitle: videoTitle.trim() || null,
          userPrompt: derivedParams.prompt,
          referenceInstructions: referenceImages.length > 0 ? referenceInstructions.trim() || null : null,
          styleType: styleSelection.styleType,
          styleId: styleSelection.styleId,
          stylePrompt: styleSelection.stylePrompt,
          nicho: styleSelection.nicho,
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
          <Link href="/gallery" className="hover:text-[var(--color-accent)]">Comunidad</Link>
          {authEmail ? (
            <>
              <Link href="/dashboard/gallery" className="hover:text-[var(--color-accent)]">Mi galería</Link>
              <Link href="/dashboard/settings" className="hover:text-[var(--color-accent)]">Ajustes</Link>
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
          {/* Campo 1 — Título del vídeo (opcional) */}
          <Panel title="Título del vídeo" subtitle="opcional">
            <input
              type="text"
              value={videoTitle}
              maxLength={200}
              onChange={(e) => setVideoTitle(e.target.value)}
              placeholder="¿Cuál es el título de tu vídeo? (opcional)"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2.5 text-sm"
            />
          </Panel>

          {/* Campo 2 — Descripción del contenido (obligatorio) */}
          <Panel title="Descripción del contenido">
            <textarea
              value={params.prompt}
              maxLength={2000}
              onChange={(e) => setParams({ ...params, prompt: e.target.value })}
              placeholder="Describe qué quieres en tu miniatura..."
              rows={5}
              className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2.5 text-sm"
            />
          </Panel>

          {/* Campo 3 — Imagen de referencia (opcional) */}
          <Panel title="Imagen de referencia" subtitle={`opcional · ${referenceImages.length}/${MAX_REFERENCE_IMAGES} · ${formatBytes(totalReferenceBytes)}`}>
            <div className={`rounded-md border border-dashed px-4 py-5 text-center ${isDragging ? "border-[var(--color-accent)]" : "border-[var(--color-border-strong)]"}`} onDrop={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(false); void addReferenceFiles(e.dataTransfer.files); }} onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}>
              <button type="button" className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm" onClick={() => fileInputRef.current?.click()}>Subir imagen</button>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.files?.length) void addReferenceFiles(e.target.files); e.target.value = ""; }} />
            </div>
            {referenceError && <p className="mt-2 text-xs text-[var(--color-danger)]">{referenceError}</p>}
            {referenceImages.length > 0 && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {referenceImages.map((ref) => (
                    <div key={ref.id} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ref.previewUrl} alt={ref.filename} className="h-16 w-16 rounded-md border border-[var(--color-border)] object-cover" />
                      <button
                        type="button"
                        onClick={() => setReferenceImages((prev) => prev.filter((x) => x.id !== ref.id))}
                        className="absolute -right-1.5 -top-1.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-bg-panel)] px-1.5 text-xs"
                        aria-label="Eliminar imagen"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <textarea
                  value={referenceInstructions}
                  maxLength={500}
                  onChange={(e) => setReferenceInstructions(e.target.value)}
                  placeholder="Instrucciones sobre esta imagen (ej: 'quiero esta cara pero sorprendida')"
                  rows={2}
                  className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2 text-sm"
                />
              </div>
            )}
          </Panel>

          {/* Campo 4 — Estilo visual */}
          <Panel title="Estilo visual">
            <div className="mb-3 flex gap-1.5">
              {([["preset", "Presets"], ["custom", "Personalizado"], ["gallery", "Galería"]] as Array<[StyleMode, string]>).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setStyleMode(mode)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${styleMode === mode ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border-strong)]"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {styleMode === "preset" && (
              <div className="grid grid-cols-2 gap-2">
                {STYLE_PRESETS.map((preset) => {
                  const active = selectedPresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setSelectedPresetId(preset.id)}
                      className={`rounded-md border p-2 text-left text-xs ${active ? "border-[var(--color-accent)]" : "border-[var(--color-border-strong)]"}`}
                    >
                      <span className="block font-semibold">{preset.name}</span>
                      <span className="block text-[10px] text-[var(--color-text-muted)]">{preset.description}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {styleMode === "custom" && (
              <textarea
                value={customStyle}
                onChange={(e) => setCustomStyle(e.target.value)}
                placeholder="Describe el estilo visual que buscas..."
                rows={3}
                className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2 text-sm"
              />
            )}

            {styleMode === "gallery" && (
              galleryStyle ? (
                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] p-2 text-xs text-[var(--color-text-secondary)]">
                  <p className="mb-1 font-medium text-[var(--color-text-primary)]">Estilo de la galería</p>
                  <p className="line-clamp-3">{galleryStyle.prompt}</p>
                </div>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Abre la <Link href="/gallery" className="text-[var(--color-accent)] hover:underline">galería de la comunidad</Link> y pulsa &quot;Usar este estilo&quot;.
                </p>
              )
            )}
          </Panel>

          {/* Campo 5 — Modo Fetch (solo PRO) + opciones */}
          <Panel title="Opciones">
            <div className="space-y-4">
              {!isFreePlan && (
                <div>
                  <label className="flex items-center justify-between text-sm">
                    <span>Modo de baja prioridad (Fetch)</span>
                    <input type="checkbox" checked={lowPriorityMode} onChange={(e) => setLowPriorityMode(e.target.checked)} />
                  </label>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Tu miniatura se genera cuando hay disponibilidad. Puede tardar más. Ahorras 30 créditos.
                    {lowPriorityMode ? " Coste: 100 → 70 créditos." : ""}
                  </p>
                </div>
              )}

              {!isFreePlan && (
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Resolución</p>
                  <div className="grid grid-cols-2 gap-2">
                    {RESOLUTION_OPTIONS.map((opt) => {
                      if (opt.value === "512") return null;
                      const active = effectiveResolution === opt.value;
                      return (
                        <button key={opt.value} type="button" onClick={() => setUserResolution(opt.value)} className={`rounded-md border px-2 py-2 text-xs ${active ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border-strong)]"}`}>
                          <span className="block font-semibold">{opt.label}</span>
                          <span className="block text-[10px] text-[var(--color-text-muted)]">{opt.creditsHint}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {isFreePlan && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Plan FREE: resolución 512 y modo de baja prioridad automáticos.
                </p>
              )}
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

          <button type="button" disabled={generating || !derivedParams.prompt.trim() || insufficientCredits} onClick={generate} className="w-full rounded-md bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-black disabled:opacity-50">
            {generating
              ? "Generando..."
              : insufficientCredits
                ? "Créditos insuficientes"
                : `Generar (${creditsCost} créditos${creditSnapshot ? ` · saldo D ${creditSnapshot.daily} M ${creditSnapshot.monthly}` : ""})`}
          </button>

          {generationError && <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 text-xs">{generationError}</div>}
        </section>

        <section className="space-y-6">
          <CostPanel estimate={estimate} estimating={estimating} hasPrompt={Boolean(derivedParams.prompt.trim())} signedIn={Boolean(authToken)} />
          <ResultPanel
            result={result}
            generating={generating}
            isPro={planLabel === "pro"}
            authToken={authToken}
            publishMsg={publishMsg}
            onPublishMsg={setPublishMsg}
          />
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

function PublishControls({
  result,
  authToken,
  publishMsg,
  onPublishMsg,
}: {
  result: GenerateResponse;
  authToken: string | null;
  publishMsg: string | null;
  onPublishMsg: (m: string | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const generationIds = (result as GenerateResponse & { generationIds?: string[] }).generationIds ?? [];
  if (generationIds.length === 0) return null;

  const publish = async () => {
    if (!authToken) {
      onPublishMsg("Inicia sesión para publicar.");
      return;
    }
    setBusy(true);
    onPublishMsg(null);
    try {
      const results = await Promise.all(
        generationIds.map((id) =>
          fetch(`/api/generations/${id}/publish`, {
            method: "POST",
            headers: { Authorization: `Bearer ${authToken}` },
          }),
        ),
      );
      const ok = results.every((r) => r.ok);
      onPublishMsg(ok ? "Publicado en la galería de la comunidad." : "Algunas miniaturas no se pudieron publicar.");
      setConfirming(false);
    } catch (err) {
      onPublishMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] p-3 text-xs">
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 hover:border-[var(--color-accent)]"
        >
          Publicar en la galería de MiniAItura
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-[var(--color-text-secondary)]">
            Acepto publicar mi miniatura en la galería pública de MiniAItura. Si el estilo es propio (custom),
            otras personas podrán usar tu prompt de estilo como referencia.
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 disabled:opacity-50">Cancelar</button>
            <button type="button" disabled={busy} onClick={() => void publish()} className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-semibold text-black disabled:opacity-50">{busy ? "Publicando…" : "Publicar"}</button>
          </div>
        </div>
      )}
      {publishMsg && <p className="mt-2 text-[var(--color-text-muted)]">{publishMsg}</p>}
    </div>
  );
}

function ResultPanel({
  result,
  generating,
  isPro,
  authToken,
  publishMsg,
  onPublishMsg,
}: {
  result: GenerateResponse | null;
  generating: boolean;
  isPro: boolean;
  authToken: string | null;
  publishMsg: string | null;
  onPublishMsg: (m: string | null) => void;
}) {
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
      {isPro && (
        <PublishControls result={result} authToken={authToken} publishMsg={publishMsg} onPublishMsg={onPublishMsg} />
      )}
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
