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
  DEFAULT_NANO_BANANA_PARAMS,
  MAX_REFERENCE_IMAGES,
  MAX_REFERENCE_IMAGES_TOTAL_BYTES,
  type GenerateResponse,
  type NanoBananaParams,
  type ReferenceImageInput,
} from "@/lib/nanoBanana";
import { computeGenerationCreditsCost } from "@/lib/firestore/credit-pricing";
import { STYLE_PRESETS } from "@/lib/constants/style-presets";
import MascotLoader from "@/components/mascots/MascotLoader";
import MascotEmpty from "@/components/mascots/MascotEmpty";
import {
  getCurrentIdToken,
  signInWithGoogle,
  signOutUser,
  subscribeToAuthState,
} from "@/lib/auth/firebase-client";

// El estilo es un texto editable. `source` recuerda de dónde salió (preset o
// galería) para conservar styleType/styleId mientras el texto no se edite; en
// cuanto el usuario lo cambia, pasa a ser "custom".
type StyleSource = { kind: "custom" | "preset" | "gallery"; id: string | null; nicho: string | null; base: string };
const EMPTY_STYLE: StyleSource = { kind: "custom", id: null, nicho: null, base: "" };

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
  styleText: string;
  styleSource: StyleSource;
  saver: boolean;
  highQuality: boolean;
  highRes: boolean;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function HomePage() {
  const [params, setParams] = useState<NanoBananaParams>(DEFAULT_NANO_BANANA_PARAMS);
  const [referenceImages, setReferenceImages] = useState<UploadedReference[]>([]);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [planLabel, setPlanLabel] = useState<"free" | "pro" | null>(null);
  const [creditSnapshot, setCreditSnapshot] = useState<{ daily: number; monthly: number } | null>(null);

  // Opciones PRO (toggles). FREE las ignora (512 + cola forzada).
  const [saver, setSaver] = useState(false); // ahorro (cola baja prioridad)
  const [highQuality, setHighQuality] = useState(false); // genera nativo en 1K
  const [highRes, setHighRes] = useState(false); // resultado final 2K

  // Campos del formulario (doc §4)
  const [videoTitle, setVideoTitle] = useState(""); // campo 1
  const [referenceInstructions, setReferenceInstructions] = useState(""); // campo 3
  const [styleText, setStyleText] = useState(""); // campo Estilo (texto copiable)
  const [styleSource, setStyleSource] = useState<StyleSource>(EMPTY_STYLE);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);

  // Aplica un preset al campo de estilo (queda editable).
  const applyPreset = (p: (typeof STYLE_PRESETS)[number]) => {
    setStyleText(p.prompt);
    setStyleSource({ kind: "preset", id: p.id, nicho: p.nicho ?? null, base: p.prompt });
  };

  // Estilo efectivo: si el texto no se ha tocado desde su origen (preset/galería)
  // conserva ese tipo; si el usuario lo editó, pasa a "custom".
  const styleSelection = useMemo(() => {
    const text = styleText.trim();
    if (styleSource.kind === "preset" && styleSource.id && styleText === styleSource.base) {
      return { styleType: "preset" as const, styleId: styleSource.id, stylePrompt: text, nicho: styleSource.nicho };
    }
    if (styleSource.kind === "gallery" && styleSource.id && styleText === styleSource.base) {
      return { styleType: "gallery" as const, styleId: styleSource.id, stylePrompt: text, nicho: null };
    }
    return { styleType: "custom" as const, styleId: null, stylePrompt: text, nicho: null };
  }, [styleText, styleSource]);

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
          // Rellena SOLO el campo de estilo (no toca el contenido que estés escribiendo).
          setStyleText(data.stylePrompt);
          setStyleSource({ kind: "gallery", id, nicho: null, base: data.stylePrompt });
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
        if (typeof s.styleText === "string") setStyleText(s.styleText);
        if (s.styleSource) setStyleSource(s.styleSource);
        if (typeof s.saver === "boolean") setSaver(s.saver);
        if (typeof s.highQuality === "boolean") setHighQuality(s.highQuality);
        if (typeof s.highRes === "boolean") setHighRes(s.highRes);
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
      styleText,
      styleSource,
      saver,
      highQuality,
      highRes,
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
    styleText,
    styleSource,
    saver,
    highQuality,
    highRes,
    referenceImages,
  ]);

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pricingPlan = planLabel ?? "free";
  const isFreePlan = planLabel !== "pro";
  // Modos efectivos: FREE no usa opciones (512 + cola forzada).
  const effSaver = isFreePlan ? true : saver;
  const effHighQuality = isFreePlan ? false : highQuality;
  const effHighRes = isFreePlan ? false : highRes;

  const derivedParams = useMemo<NanoBananaParams>(() => {
    if (isFreePlan) {
      // FREE: 512 nativo, sin upscale, cola forzada.
      return { ...params, flex_mode: true, resolution: "512", upscale_enabled: false, upscale_resolution: "1K" };
    }
    const resolution = highQuality ? "1K" : "512";
    let upscale_enabled: boolean;
    let upscale_resolution: NanoBananaParams["upscale_resolution"];
    if (highRes) {
      upscale_enabled = true;
      upscale_resolution = "2K";
    } else if (highQuality) {
      upscale_enabled = false; // nativo 1K, sin escalado
      upscale_resolution = "1K";
    } else {
      upscale_enabled = true; // default: 512 → 1K
      upscale_resolution = "1K";
    }
    return { ...params, flex_mode: saver, resolution, upscale_enabled, upscale_resolution };
  }, [isFreePlan, saver, highQuality, highRes, params]);

  const creditsCost = useMemo(() => {
    return computeGenerationCreditsCost(pricingPlan, {
      saver: effSaver,
      highQuality: effHighQuality,
      highRes: effHighRes,
    });
  }, [pricingPlan, effSaver, effHighQuality, effHighRes]);

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

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          params: derivedParams,
          referenceImages: refs,
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

          {/* Campo 2 — Contenido (obligatorio, personal) */}
          <Panel title="Contenido" subtitle="qué aparece en tu miniatura — personal, no se comparte">
            <textarea
              value={params.prompt}
              maxLength={2000}
              onChange={(e) => setParams({ ...params, prompt: e.target.value })}
              placeholder="Describe qué quieres en tu miniatura (tu vídeo, el tema, los elementos)..."
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

          {/* Campo 4 — Estilo (texto copiable / compartible) */}
          <Panel title="Estilo" subtitle="el look de la miniatura — esto es lo que se comparte y otros pueden copiar">
            <textarea
              value={styleText}
              maxLength={1500}
              onChange={(e) => setStyleText(e.target.value)}
              placeholder="Describe el estilo visual: colores, iluminación, composición, tipografía, ambiente..."
              rows={4}
              className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2.5 text-sm"
            />
            {styleSource.kind === "gallery" && styleText === styleSource.base && (
              <p className="mt-2 text-xs text-[var(--color-accent)]">Estilo cargado de la galería de la comunidad. Puedes editarlo.</p>
            )}
            <p className="mb-1.5 mt-3 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Aplicar un preset</p>
            <div className="flex flex-wrap gap-1.5">
              {STYLE_PRESETS.map((preset) => {
                const active = styleSource.kind === "preset" && styleSource.id === preset.id && styleText === styleSource.base;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.description}
                    onClick={() => applyPreset(preset)}
                    className={`rounded-md border px-2.5 py-1 text-xs ${active ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border-strong)]"}`}
                  >
                    {preset.name}
                  </button>
                );
              })}
            </div>
          </Panel>

          {/* Campo 5 — Opciones (solo PRO) */}
          <Panel title="Opciones">
            {isFreePlan ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                Plan FREE: 512 px y generación en cola automáticas. Hazte PRO para más opciones de calidad y resolución.
              </p>
            ) : (
              <div className="space-y-4">
                <label className="block">
                  <span className="flex items-center justify-between text-sm">
                    Ahorro
                    <input type="checkbox" checked={saver} onChange={(e) => setSaver(e.target.checked)} />
                  </span>
                  <span className="mt-1 block text-xs text-[var(--color-text-muted)]">Genera en cola cuando hay disponibilidad; puede tardar más. −25 créditos.</span>
                </label>
                <label className="block">
                  <span className="flex items-center justify-between text-sm">
                    Alta calidad
                    <input type="checkbox" checked={highQuality} onChange={(e) => setHighQuality(e.target.checked)} />
                  </span>
                  <span className="mt-1 block text-xs text-[var(--color-text-muted)]">Más detalle nativo, sobre todo para la letra pequeña. +25 créditos.</span>
                </label>
                <label className="block">
                  <span className="flex items-center justify-between text-sm">
                    Alta resolución
                    <input type="checkbox" checked={highRes} onChange={(e) => setHighRes(e.target.checked)} />
                  </span>
                  <span className="mt-1 block text-xs text-[var(--color-text-muted)]">Resultado final más grande (2K). +25 créditos.</span>
                </label>
              </div>
            )}
          </Panel>

          <button type="button" disabled={generating || !derivedParams.prompt.trim() || insufficientCredits} onClick={generate} className="w-full rounded-md bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {generating
              ? "Generando..."
              : insufficientCredits
                ? "Créditos insuficientes"
                : `Generar (${creditsCost} créditos${creditSnapshot ? ` · saldo D ${creditSnapshot.daily} M ${creditSnapshot.monthly}` : ""})`}
          </button>

          {generationError && <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 text-xs">{generationError}</div>}
        </section>

        <section className="space-y-6">
          <ResultPanel
            result={result}
            generating={generating}
            fetchMode={effSaver}
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
            <button type="button" disabled={busy} onClick={() => void publish()} className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-semibold text-white disabled:opacity-50">{busy ? "Publicando…" : "Publicar"}</button>
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
  fetchMode,
  isPro,
  authToken,
  publishMsg,
  onPublishMsg,
}: {
  result: GenerateResponse | null;
  generating: boolean;
  fetchMode: boolean;
  isPro: boolean;
  authToken: string | null;
  publishMsg: string | null;
  onPublishMsg: (m: string | null) => void;
}) {
  if (generating) {
    return (
      <Panel title="Resultado">
        <MascotLoader fetchMode={fetchMode} />
      </Panel>
    );
  }
  if (!result) {
    return (
      <Panel title="Resultado">
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <MascotEmpty />
          <p className="text-sm text-[var(--color-text-muted)]">Aún no hay nada. Genera una miniatura y aparecerá aquí.</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Resultado" subtitle={`${result.images.length} ${result.images.length === 1 ? "imagen" : "imágenes"}`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {result.images.map((img, i) => (
          <figure key={i} className="overflow-hidden rounded-md border border-[var(--color-border)] bg-black/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:${img.mimeType};base64,${img.data}`}
              alt={`Generated thumbnail ${i + 1}`}
              className="block w-full"
            />
            <figcaption className="flex items-center justify-end border-t border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2 text-xs">
              <a
                href={`data:${img.mimeType};base64,${img.data}`}
                download={`miniaitura-${result.requestId}-${i + 1}.png`}
                className="font-medium text-[var(--color-accent)] hover:underline"
              >
                Descargar
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
      {isPro && (
        <PublishControls result={result} authToken={authToken} publishMsg={publishMsg} onPublishMsg={onPublishMsg} />
      )}
    </Panel>
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
