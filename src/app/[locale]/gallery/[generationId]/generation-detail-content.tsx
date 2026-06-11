"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { generateAltText } from "@/lib/seo";
import type { GenerationWithId } from "@/lib/firestore/generations";
import UseInGenerator from "./use-in-generator";
import ReportButton from "@/components/ui/ReportButton";

type Orientation = "horizontal" | "vertical";

export default function GenerationDetailContent({
  generation,
  authorName,
}: {
  generation: GenerationWithId;
  authorName: string;
}) {
  const t = useTranslations("galleryDetail");
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const isVertical = orientation === "vertical";

  const actionContent = (
    <div className="space-y-3">
      <UseInGenerator
        generationId={generation.id}
        content={generation.userPrompt}
        style={generation.stylePrompt || null}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
        {generation.nicho && <span>{t("niche", { nicho: generation.nicho })}</span>}
        <span>{t("styleUsedTimes", { count: generation.timesStyleCopied })}</span>
        <span className="ml-auto">
          <ReportButton generationId={generation.id} />
        </span>
      </div>
    </div>
  );

  return (
    <article
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.9fr)_minmax(340px,1fr)]"
    >
      <figure className="m-0 self-start overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel-2)]">
        <div className="flex justify-center bg-black/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={generation.imageUrl}
            alt={generateAltText(generation)}
            onLoad={(e) => {
              const img = e.currentTarget;
              setOrientation(img.naturalHeight > img.naturalWidth ? "vertical" : "horizontal");
            }}
            className={
              isVertical
                ? "max-h-[78vh] w-auto max-w-full object-contain"
                : "max-h-[76vh] w-full object-contain"
            }
          />
        </div>
      </figure>

      <aside className="space-y-4 text-sm">
        <p className="text-[var(--color-text-muted)]">{t("byAuthor", { author: authorName })}</p>

        {generation.userPrompt && (
          <div>
            <p className="mb-1 font-medium text-[var(--color-text-primary)]">{t("content")}</p>
            <p className="whitespace-pre-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] p-2 text-[var(--color-text-secondary)]">
              {generation.userPrompt}
            </p>
          </div>
        )}

        {generation.stylePrompt && (
          <div>
            <p className="mb-1 font-medium text-[var(--color-text-primary)]">{t("style")}</p>
            <p className="whitespace-pre-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] p-2 text-[var(--color-text-secondary)]">
              {generation.stylePrompt}
            </p>
          </div>
        )}

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] p-3">
          {actionContent}
        </div>
      </aside>
    </article>
  );
}
