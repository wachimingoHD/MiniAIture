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
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
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
import PublishConfirmModal from "@/components/ui/PublishConfirmModal";
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
const PREFILL_STORAGE_KEY = "miniaitura:prefill";

// Cache a nivel de módulo para que la precarga sobreviva al doble montaje de
// React StrictMode en desarrollo (que resetea el estado del componente). En el
// primer montaje leemos+borramos sessionStorage y lo guardamos aquí; el segundo
// montaje lo reaplica desde esta variable. Se limpia al consumirlo.
let pendingPrefill: { content?: string; style?: string; styleFromId?: string } | null = null;

interface PersistedReference {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  base64: string;
  instructions: string;
}

interface PersistedForm {
  params: NanoBananaParams;
  videoTitle: string;
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
  instructions: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function HomePage() {
  const t = useTranslations("generate");
  const tNav = useTranslations("nav");
  const tAuth = useTranslations("auth");
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
  const [saver, setSaver] = useState(true); // ahorro (cola baja prioridad) — marcado por defecto
  const [highQuality, setHighQuality] = useState(false); // genera nativo en 1K
  const [highRes, setHighRes] = useState(false); // resultado final 2K

  // Campos del formulario (doc §4)
  const [videoTitle, setVideoTitle] = useState(""); // campo 1
  const [styleText, setStyleText] = useState(""); // campo Estilo (texto copiable)
  const [styleSource, setStyleSource] = useState<StyleSource>(EMPTY_STYLE);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  // Sugeridor de estilo con IA (botón "Sugerir estilo con IA").
  const [suggestingStyle, setSuggestingStyle] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

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
        if (typeof s.styleText === "string") setStyleText(s.styleText);
        if (s.styleSource) setStyleSource(s.styleSource);
        if (typeof s.saver === "boolean") setSaver(s.saver);
        if (typeof s.highQuality === "boolean") setHighQuality(s.highQuality);
        if (typeof s.highRes === "boolean") setHighRes(s.highRes);
        if (Array.isArray(s.referenceImages)) {
          setReferenceImages(
            s.referenceImages.map((r) => ({
              ...r,
              instructions: typeof r.instructions === "string" ? r.instructions : "",
              previewUrl: `data:${r.mimeType};base64,${r.base64}`,
            })),
          );
        }
      }

      // Precarga desde la galería pública (botones "Usar contenido/estilo/ambos").
      // Sobrescribe el contenido/estilo del formulario restaurado.
      let pf = pendingPrefill;
      pendingPrefill = null;
      if (!pf) {
        const prefillRaw = sessionStorage.getItem(PREFILL_STORAGE_KEY);
        if (prefillRaw) {
          pf = JSON.parse(prefillRaw) as { content?: string; style?: string; styleFromId?: string };
          sessionStorage.removeItem(PREFILL_STORAGE_KEY);
          pendingPrefill = pf; // que el segundo montaje (StrictMode) lo reaplique
        }
      }
      if (pf) {
        if (typeof pf.content === "string") {
          const content = pf.content;
          setParams((prev) => ({ ...prev, prompt: content }));
        }
        if (typeof pf.style === "string") {
          const style = pf.style;
          setStyleText(style);
          setStyleSource(
            pf.styleFromId
              ? { kind: "gallery", id: pf.styleFromId, nicho: null, base: style }
              : { kind: "custom", id: null, nicho: null, base: style },
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
      instructions: r.instructions,
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
    styleText,
    styleSource,
    saver,
    highQuality,
    highRes,
    referenceImages,
  ]);

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  // Contador de drag para que el resalte no parpadee al pasar sobre hijos
  // (dragenter/dragleave disparan por cada elemento hijo).
  const dragCounter = useRef(0);

  // Actualiza las instrucciones de UNA imagen de referencia concreta.
  const setRefInstruction = useCallback((id: string, text: string) => {
    setReferenceImages((prev) => prev.map((r) => (r.id === id ? { ...r, instructions: text } : r)));
  }, []);

  // Inserta una etiqueta `[Image N]` en el campo Contenido, en la posición del
  // cursor (o al final si el campo no tiene foco). Así el usuario puede referirse
  // a una imagen concreta desde el texto del contenido.
  const insertRefToken = useCallback((label: string) => {
    const token = `[${label}]`;
    const el = contentRef.current;
    setParams((prev) => {
      const cur = prev.prompt;
      const start = el?.selectionStart ?? cur.length;
      const end = el?.selectionEnd ?? cur.length;
      const needsSpaceBefore = start > 0 && !/\s$/.test(cur.slice(0, start));
      const insert = (needsSpaceBefore ? " " : "") + token + " ";
      const nextPrompt = cur.slice(0, start) + insert + cur.slice(end);
      if (el) {
        const pos = start + insert.length;
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(pos, pos);
        });
      }
      return { ...prev, prompt: nextPrompt };
    });
  }, []);

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
        error = t("maxRefImages", { max: MAX_REFERENCE_IMAGES });
        break;
      }
      if (!file.type.startsWith("image/")) {
        error = t("onlyImages");
        continue;
      }
      if (totalBytes + file.size > MAX_REFERENCE_IMAGES_TOTAL_BYTES) {
        error = t("totalSizeLimit", { mb: MAX_REFERENCE_IMAGES_TOTAL_BYTES / 1024 / 1024 });
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
        instructions: "",
      });
      totalBytes += file.size;
    }
    setReferenceImages(next);
    setReferenceError(error);
  }, [referenceImages]);

  // Pide a la IA (Gemini 2.5 Flash) una dirección de estilo a partir del título
  // y el contenido. Cuesta 1 crédito (se reembolsa en el servidor si falla).
  const suggestStyle = async () => {
    const title = videoTitle.trim();
    const content = params.prompt.trim();
    if (!title && !content) {
      setSuggestError(t("writeTitleOrContent"));
      return;
    }
    const token = authToken ?? (await getCurrentIdToken());
    if (!token) {
      setSuggestError(t("signInToSuggest"));
      return;
    }
    setSuggestingStyle(true);
    setSuggestError(null);
    try {
      const res = await fetch("/api/suggest-style", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ videoTitle: title, content }),
      });
      const data = (await res.json()) as { style?: string; error?: string; creditsRemaining?: { daily: number; monthly: number } };
      if (data.creditsRemaining) setCreditSnapshot(data.creditsRemaining);
      if (!res.ok || !data.style) {
        setSuggestError(data.error ?? t("suggestFailed"));
        return;
      }
      setStyleText(data.style);
      setStyleSource({ kind: "custom", id: null, nicho: null, base: data.style });
    } catch (err) {
      setSuggestError((err as Error).message);
    } finally {
      setSuggestingStyle(false);
    }
  };

  const generate = async () => {
    if (!derivedParams.prompt.trim()) {
      setGenerationError(t("promptRequired"));
      return;
    }
    const token = authToken ?? (await getCurrentIdToken());
    if (!token) {
      setGenerationError(t("signInToGenerate"));
      return;
    }
    setGenerating(true);
    setGenerationError(null);
    setResult(null);

    const refs: ReferenceImageInput[] = referenceImages.map((r) => ({ data: r.base64, mimeType: r.mimeType, filename: r.filename, size: r.size }));

    // Combina las instrucciones por imagen, etiquetadas "Image N" en el mismo
    // orden en que se envían las imágenes, para que el LLM pueda relacionar cada
    // referencia con su `[Image N]` citada en el Contenido.
    const combinedReferenceInstructions = referenceImages
      .map((r, i) => (r.instructions.trim() ? `Image ${i + 1}: ${r.instructions.trim()}` : null))
      .filter(Boolean)
      .join("\n");

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
          referenceInstructions: combinedReferenceInstructions || null,
          styleType: styleSelection.styleType,
          styleId: styleSelection.styleId,
          stylePrompt: styleSelection.stylePrompt,
          nicho: styleSelection.nicho,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        setGenerationError(t("generationFailed", { detail: text || res.statusText }));
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
          <h1 className="font-display text-xl font-bold tracking-tight">Mini<span className="text-[var(--color-accent)]">AI</span>tura</h1>
          <p className="text-xs text-[var(--color-text-muted)]">{t("tagline")}</p>
        </div>
        <nav className="hidden items-center gap-4 text-sm text-[var(--color-text-secondary)] md:flex">
          <Link href="/pricing" className="hover:text-[var(--color-accent)]">{tNav("pricing")}</Link>
          <Link href="/gallery" className="hover:text-[var(--color-accent)]">{tNav("community")}</Link>
          {authEmail ? (
            <>
              <Link href="/dashboard/gallery" className="hover:text-[var(--color-accent)]">{tNav("myGallery")}</Link>
              <Link href="/dashboard/settings" className="hover:text-[var(--color-accent)]">{tNav("settings")}</Link>
              <div className="flex flex-col items-end gap-1.5">
                <p className="text-xs text-[var(--color-text-muted)]">{authEmail}</p>
                <div className="flex items-center gap-2.5">
                  <span className="rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent-strong)]">
                    {planLabel ? planLabel : t("planUnknown")}
                  </span>
                  {creditSnapshot && (
                    <div className="flex items-center gap-3 text-xs">
                      <span className="inline-flex items-center gap-1.5 text-[var(--color-success)]">
                        <span className="h-2 w-2 rounded-full bg-[var(--color-success)]" />
                        <span className="font-semibold tabular-nums">{creditSnapshot.daily}</span>
                        <span className="text-[var(--color-text-muted)]">{t("daily")}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
                        <span className="h-2 w-2 rounded-full bg-[var(--color-text-muted)]" />
                        <span className="font-semibold tabular-nums">{creditSnapshot.monthly}</span>
                        <span>{t("monthly")}</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => void signOutUser()} className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm">{tAuth("signOut")}</button>
            </>
          ) : (
            <button type="button" onClick={() => void signInWithGoogle()} className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm">{tAuth("signIn")}</button>
          )}
        </nav>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
        <section className="space-y-5">
          {/* Campo 1 — Título del vídeo (opcional) */}
          <Panel title={t("titleFieldTitle")} subtitle={t("titleFieldSubtitle")}>
            <input
              type="text"
              value={videoTitle}
              maxLength={200}
              onChange={(e) => setVideoTitle(e.target.value)}
              placeholder={t("titleFieldPlaceholder")}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2.5 text-sm"
            />
          </Panel>

          {/* Campo 2 — Contenido (obligatorio) */}
          <Panel title={t("contentTitle")} subtitle={t("contentSubtitle")}>
            <textarea
              ref={contentRef}
              value={params.prompt}
              maxLength={2000}
              onChange={(e) => setParams({ ...params, prompt: e.target.value })}
              placeholder={t("contentPlaceholder")}
              rows={5}
              className="min-h-[7rem] w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2.5 text-sm"
            />
            {referenceImages.length > 0 && (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                {t.rich("contentTip", {
                  b: (c) => <span className="font-medium text-[var(--color-text-secondary)]">{c}</span>,
                })}
              </p>
            )}
          </Panel>

          {/* Campo 3 — Estilo (texto copiable / compartible) */}
          <Panel title={t("styleTitle")} subtitle={t("styleSubtitle")}>
            <textarea
              value={styleText}
              maxLength={1500}
              onChange={(e) => setStyleText(e.target.value)}
              placeholder={t("stylePlaceholder")}
              rows={4}
              className="min-h-[6rem] w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2.5 text-sm"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void suggestStyle()}
                disabled={suggestingStyle || !(videoTitle.trim() || params.prompt.trim())}
                title={t("suggestTitle")}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--color-accent-strong)] transition hover:border-[var(--color-accent)] disabled:opacity-50"
              >
                {suggestingStyle ? t("suggestBusy") : t("suggestIdle")}
              </button>
              {!(videoTitle.trim() || params.prompt.trim()) && (
                <span className="text-xs text-[var(--color-text-muted)]">{t("fillFirst")}</span>
              )}
            </div>
            {suggestError && <p className="mt-1 text-xs text-[var(--color-danger)]">{suggestError}</p>}
            {styleSource.kind === "gallery" && styleText === styleSource.base && (
              <p className="mt-2 text-xs text-[var(--color-accent)]">{t("galleryStyleLoaded")}</p>
            )}
            <p className="mb-1.5 mt-3 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{t("applyPreset")}</p>
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

          {/* Campo 4 — Imagen de referencia (opcional). Toda la sección es zona de
              arrastre: el div externo captura el drop en cualquier punto del panel. */}
          <div
            onDragEnter={(e) => { e.preventDefault(); dragCounter.current += 1; setIsDragging(true); }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => { e.preventDefault(); dragCounter.current -= 1; if (dragCounter.current <= 0) setIsDragging(false); }}
            onDrop={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); dragCounter.current = 0; setIsDragging(false); void addReferenceFiles(e.dataTransfer.files); }}
            className={`rounded-lg transition ${isDragging ? "ring-2 ring-[var(--color-accent)]" : ""}`}
          >
          <Panel title={t("referenceTitle")} subtitle={t("referenceSubtitle", { count: referenceImages.length, max: MAX_REFERENCE_IMAGES, size: formatBytes(totalReferenceBytes) })}>
            <div className={`rounded-md border border-dashed px-4 py-6 text-center transition ${isDragging ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border-strong)]"}`}>
              <p className="mb-2 text-xs text-[var(--color-text-muted)]">{t("dropHere")}</p>
              <button type="button" className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm" onClick={() => fileInputRef.current?.click()}>{t("uploadImage")}</button>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.files?.length) void addReferenceFiles(e.target.files); e.target.value = ""; }} />
            </div>
            {referenceError && <p className="mt-2 text-xs text-[var(--color-danger)]">{referenceError}</p>}
            {referenceImages.length > 0 && (
              <div className="mt-3 space-y-3">
                {referenceImages.map((ref, i) => {
                  // "Image N" es un token de protocolo (se inserta como [Image N]
                  // y el enhancer lo normaliza). Debe ser idéntico en frontend,
                  // backend (route.ts) y el normalizador del enhancer.
                  const label = `Image ${i + 1}`;
                  return (
                    <div key={ref.id} className="flex gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] p-2.5">
                      <div className="relative shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={ref.previewUrl} alt={ref.filename} className="h-16 w-16 rounded-md border border-[var(--color-border)] object-cover" />
                        <button
                          type="button"
                          onClick={() => setReferenceImages((prev) => prev.filter((x) => x.id !== ref.id))}
                          className="absolute -right-1.5 -top-1.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-bg-panel)] px-1.5 text-xs"
                          aria-label={t("removeRef", { label })}
                        >
                          ×
                        </button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[var(--color-text-secondary)]">{label}</span>
                          <button
                            type="button"
                            onClick={() => insertRefToken(label)}
                            title={t("insertRefTitle")}
                            className="rounded-md border border-[var(--color-border-strong)] px-2 py-0.5 text-xs transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                          >
                            {t("insertInContent")}
                          </button>
                        </div>
                        <textarea
                          value={ref.instructions}
                          maxLength={500}
                          onChange={(e) => setRefInstruction(ref.id, e.target.value)}
                          placeholder={t("refInstructionsPlaceholder")}
                          rows={2}
                          className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
          </div>

          {/* Campo 5 — Opciones (solo PRO) */}
          <Panel title={t("optionsTitle")}>
            {isFreePlan ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                {t("freeOptionsNote")}
              </p>
            ) : (
              <div className="space-y-4">
                <label className="block">
                  <span className="flex items-center justify-between text-sm">
                    {t("saverLabel")}
                    <input type="checkbox" checked={saver} onChange={(e) => setSaver(e.target.checked)} />
                  </span>
                  <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{t.rich("saverDesc", { br: () => <br /> })}</span>
                </label>
                <label className="block">
                  <span className="flex items-center justify-between text-sm">
                    {t("highQualityLabel")}
                    <input type="checkbox" checked={highQuality} onChange={(e) => setHighQuality(e.target.checked)} />
                  </span>
                  <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{t.rich("highQualityDesc", { br: () => <br /> })}</span>
                </label>
                <label className="block">
                  <span className="flex items-center justify-between text-sm">
                    {t("highResLabel")}
                    <input type="checkbox" checked={highRes} onChange={(e) => setHighRes(e.target.checked)} />
                  </span>
                  <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{t.rich("highResDesc", { br: () => <br /> })}</span>
                </label>
              </div>
            )}
          </Panel>

          <button type="button" disabled={generating || !derivedParams.prompt.trim() || insufficientCredits} onClick={generate} className="w-full rounded-md bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {generating
              ? t("generating")
              : insufficientCredits
                ? t("insufficientCredits")
                : t("generateBtn", { cost: creditsCost })}
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
  return <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4"><header className="mb-3 flex items-baseline justify-between gap-3"><h2 className="shrink-0 text-sm font-semibold tracking-tight">{title}</h2>{subtitle && <span className="text-right text-xs leading-snug text-[var(--color-text-muted)]">{subtitle}</span>}</header>{children}</div>;
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
  const t = useTranslations("generate");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const generationIds = (result as GenerateResponse & { generationIds?: string[] }).generationIds ?? [];
  if (generationIds.length === 0) return null;

  const publish = async () => {
    if (!authToken) {
      onPublishMsg(t("signInToPublish"));
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
      onPublishMsg(ok ? t("publishedOk") : t("publishedPartial"));
      setConfirming(false);
    } catch (err) {
      onPublishMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-panel-2)] px-4 py-2.5 text-sm font-medium transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      >
        <span aria-hidden>🌐</span>
        {t("publishBtn")}
      </button>
      {confirming && (
        <PublishConfirmModal
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void publish()}
        />
      )}
      {publishMsg && <p className="mt-2 text-xs text-[var(--color-text-muted)]">{publishMsg}</p>}
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
  const t = useTranslations("generate");
  const [zoomed, setZoomed] = useState<number | null>(null);

  if (generating) {
    return (
      <Panel title={t("resultTitle")}>
        <MascotLoader fetchMode={fetchMode} />
      </Panel>
    );
  }
  if (!result) {
    return (
      <Panel title={t("resultTitle")}>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <MascotEmpty />
          <p className="text-sm text-[var(--color-text-muted)]">{t("emptyResult")}</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={t("resultTitle")} subtitle={t("imagesCount", { count: result.images.length })}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {result.images.map((img, i) => (
          <figure key={i} className="overflow-hidden rounded-md border border-[var(--color-border)] bg-black/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:${img.mimeType};base64,${img.data}`}
              alt={t("generatedAlt", { n: i + 1 })}
              onClick={() => setZoomed(i)}
              className="block w-full cursor-zoom-in transition hover:opacity-95"
            />
            <figcaption className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2 text-xs">
              <button
                type="button"
                onClick={() => setZoomed(i)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
              >
                {t("enlarge")}
              </button>
              <a
                href={`data:${img.mimeType};base64,${img.data}`}
                download={`miniaitura-${result.requestId}-${i + 1}.png`}
                className="font-medium text-[var(--color-accent)] hover:underline"
              >
                {t("download")}
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
      {isPro && (
        <PublishControls result={result} authToken={authToken} publishMsg={publishMsg} onPublishMsg={onPublishMsg} />
      )}
      {zoomed !== null && (
        <ResultLightbox
          images={result.images}
          index={zoomed}
          requestId={result.requestId}
          onClose={() => setZoomed(null)}
        />
      )}
    </Panel>
  );
}

// Visor a pantalla completa del resultado (mismo patrón que "Mi galería"):
// overlay oscuro + imagen grande (object-contain) + descarga. Portal a <body>
// para cubrir todo el viewport con independencia de ancestros con transform.
function ResultLightbox({
  images,
  index,
  requestId,
  onClose,
}: {
  images: GenerateResponse["images"];
  index: number;
  requestId: string;
  onClose: () => void;
}) {
  const t = useTranslations("generate");
  const [mounted, setMounted] = useState(false);
  const [current, setCurrent] = useState(index);
  const total = images.length;

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setCurrent((c) => (c + 1) % total);
      if (e.key === "ArrowLeft") setCurrent((c) => (c - 1 + total) % total);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, total]);

  if (!mounted) return null;

  const img = images[current];
  const src = `data:${img.mimeType};base64,${img.data}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="relative flex max-h-full w-full max-w-5xl flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between pb-3">
          <span className="text-sm font-medium text-white/80">
            {total > 1 ? t("imageXofY", { current: current + 1, total }) : t("resultTitle")}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-md border border-white/30 px-3 py-1 text-sm text-white transition hover:bg-white/10"
          >
            {t("close")}
          </button>
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={t("resultAlt", { n: current + 1 })}
          className="mx-auto max-h-[78vh] w-auto max-w-full rounded-lg border border-white/10 object-contain"
        />

        <div className="flex items-center justify-center gap-3 pt-4">
          {total > 1 && (
            <>
              <button
                type="button"
                onClick={() => setCurrent((c) => (c - 1 + total) % total)}
                className="rounded-md border border-white/30 px-3 py-1.5 text-sm text-white transition hover:bg-white/10"
              >
                {t("prev")}
              </button>
              <button
                type="button"
                onClick={() => setCurrent((c) => (c + 1) % total)}
                className="rounded-md border border-white/30 px-3 py-1.5 text-sm text-white transition hover:bg-white/10"
              >
                {t("next")}
              </button>
            </>
          )}
          <a
            href={src}
            download={`miniaitura-${requestId}-${current + 1}.png`}
            className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)]"
          >
            {t("download")}
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
