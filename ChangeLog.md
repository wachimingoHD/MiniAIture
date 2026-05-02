# ChangeLog - MiniAItures

This file is the running log of work done on the project. Every meaningful change to MiniAItureDOC.md, the codebase, or the operational state of the project should be reflected here so that the changelog acts as a faithful timeline of what has been built and what has changed.

**Convention:** when MiniAItureDOC.md is modified, the corresponding row here MUST be updated (or appended). The doc and the changelog are kept in sync by hand — if a change touches the doc, it touches this file too.

Format: `YYYY-MM-DD` headers (newest on top). Each entry is a bullet list. When a row contradicts something stated earlier, leave the older entry in place but mark the newer one with `(supersedes YYYY-MM-DD entry "title")` so the history stays intact.

---

## 2026-05-03 - Phase 1 scaffolding (full MVP frontend + AI APIs)

Initial bootstrap of the Next.js project from scratch based on `MiniAItureDOC.md` (sections 1–11 fully implemented, sections 12+ scaffolded with TODOs).

### Tech foundation
- Initialized Next.js 16.2.4 + React 19.2.4 + TypeScript 5 + Tailwind 4.
- Created `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `next-env.d.ts`, `.gitignore`, `.env.example`.
- Dark-mode visual theme with custom CSS variables in `src/app/globals.css` (yellow accent on near-black surfaces — placeholder design, intentionally subdued; ready to be re-skinned).

### Shared domain (Phase 1)
- `src/lib/nanoBanana.ts`: full type system (`NanoBananaParams`, `GeneratedImage`, `CostSummary`, `FailureDetail`, etc.), enums (`AspectRatio`, `Resolution`, `UpscaleResolution`), default params, reference-image limits, request validator (`validateGenerationRequest`), capacity-failure detection (`isGoogleCapacityFailure`), fallback eligibility (`shouldFallbackToFal`).
- `src/lib/cost.ts`: token-based Google cost (`computeTokenCostSummary`), fal rate-based cost (`computeFalCostSummary`), upscale cost (`computeUpscaleCost`), merge logic (`mergeCostWithUpscale`), live fal pricing fetch with 5-minute in-process cache.

### Provider integrations (Phase 1)
- `src/lib/google.ts`: REST integration with `gemini-3.1-flash-image-preview`. Per-image request loop, `service_tier` ("flex"/"standard"), `safetySettings: OFF` for all categories, optional `google_search` tool, configurable timeouts (2 min standard, 10 min flex), full HTTP error classification, `formatGoogleNoImageError` for content/safety/finish-reason failures, modality-aware token usage accumulator, `estimateGoogleTokens` with `countTokens` API + local fallback.
- `src/lib/fal.ts`: REST integration. Generation via `fal-ai/nano-banana-2` (no refs) or `fal-ai/nano-banana-2/edit` (with refs). Param mapping: `512` → `0.5K`, `enable_google_search` → `enable_web_search`, fixed `safety_tolerance: "6"`, `limit_generations: true`, `output_format: "png"`. Upscale via `fal-ai/seedvr/upscale/image` with target mapping (`1K`→`1080p`, `2K`→`1440p`, `4K`→`2160p`). 10-minute timeout for both gen and upscale. Image fetch helper to inline base64.

### API routes (Phase 1)
- `src/app/api/generate/route.ts`: full resilience flow per doc section 8/14:
  1. Parse + validate (400 on bad input).
  2. Google primary attempt (Flex if `flex_mode`, else Standard).
  3. Flex → Standard automatic retry on capacity failure (503/429), exposed as `googleTierFallback`.
  4. fallback to fal.ai when eligible AND `AUTO_FALLBACK_TO_FAL=true` AND `FAL_API_KEY` present.
  5. Optional upscale post-process (only if target > base).
  6. Returns full `GenerateResponse` (provider used, fallback metadata, cost, images, originalImages if upscale ran, primary failure if any, timestamps).
- `src/app/api/estimate-cost/route.ts`: doubles-cost precalculation. Live fal pricing API + countTokens with fallbacks. Returns `{ upscale, google, fal }` blocks where Google and fal totals already include the upscale portion.

### Frontend (Phase 1)
- `src/app/page.tsx`: complete UI in English, dark theme.
  - Two-column layout (controls left, results right). Responsive collapse on `<lg`.
  - All `NanoBananaParams` exposed individually with per-parameter "Default" reset link.
  - Reference uploader: drag & drop + file picker, multi-file, individual remove + clear all, live previews via `URL.createObjectURL`, validated against the 10-file / 5 MB limits.
  - Auto-running cost estimator (debounced 600ms) showing three cards: upscale, Google, fal — highlighting the cheaper provider.
  - Flex banner shown when `flex_mode = true`.
  - Generation result panel with image grid, per-image download, "View originals" disclosure when upscale ran, JSON metadata disclosure for debugging.
  - Local history list with thumbnails, individual delete, clear-all, time/duration/provider/cost badges.
  - Header with brand mark + nav placeholders (Pricing / For creators / Affiliates / Sign in).
  - Footer with one-line summary of the credit/plan model.
- `src/app/layout.tsx`: root layout, metadata (title, description, keywords), `lang="en"`.
- `src/app/globals.css`: Tailwind v4 `@theme` block with custom CSS variables, dark scrollbar, shimmer + soft pulse keyframes for the loading state.

### Local persistence (Phase 1)
- `src/lib/history.ts`: IndexedDB-backed history (`nano-banana-2-db`, store `history`), keyed by id, indexed by `createdAt` (descending listing). One-time migration from legacy `localStorage` key, FIFO trim at 40 entries, full CRUD + clear.

### Phase 2 stubs (created but not active — require external service setup)
- `src/lib/auth/firebase-client.ts`: config getter from `NEXT_PUBLIC_FIREBASE_*` env, exported stubs (`signInWithGoogle`, `signOutUser`, `getCurrentIdToken`) that throw or return null until Firebase SDK is installed and the implementation is uncommented. Step-by-step activation comments at the top of the file.
- `src/lib/auth/firebase-admin.ts`: server-side admin stubs (`verifyIdToken`, `adminFirestore`).
- `src/lib/firestore/schema.ts`: full type model from doc section 17 (`UserDocument`, `UserCredits`, `UserAffiliate`, `UserStats`, `ImageEntry`), constants (`CREDITS_PER_IMAGE = 100`, `FREE_DAILY_CREDITS = 100`, `MAX_PRO_GALLERY_ENTRIES = 200`), placeholder `PRO_DAILY_CREDITS_DEFAULT = 500` and `PRO_MONTHLY_POOL_DEFAULT = 3000` flagged as PENDING in code comments, `buildInitialUserDocument` factory.
- `src/lib/firestore/credits.ts`: pure framework-free credit logic (`applyDailyResetIfDue`, `tryDeductCredits` with daily-then-monthly draw, `refundCredits`) ready to drop into a Firestore transaction.
- `src/lib/r2/client.ts`: config getter + `uploadGalleryImage` stub.
- `src/lib/stripe/client.ts`: config getter + `createProCheckoutSession` and `verifyWebhookSignature` stubs.
- `src/app/api/user/credits/route.ts`: GET handler that verifies Bearer token and returns 501 until Phase 2 is active.
- `src/app/api/webhooks/stripe/route.ts`: POST handler that requires `stripe-signature` header and returns 501 until Phase 2 is active.

### Documentation
- Created this `ChangeLog.md`.

### What is NOT in Phase 1
- Firebase Auth, Firestore writes, App Check (stubs only).
- Cloudflare R2 image storage (stub only).
- Stripe subscriptions, webhooks, affiliate commissions (stubs only).
- Rate limiting per IP for Free users (depends on auth + a request store).
- Server-side gallery, watermarking, plan-based feature gating.
- Analytics aggregation document for Flex failures.
- Tests (none defined yet; doc doesn't request a test framework).

### Pending decisions still surfaced from MiniAItureDOC.md section 25
1. Pro plan base price (€/month).
2. Pro daily credit model: Option A (24h reset since first use) vs Option B (recharge every 5h).
3. Pro daily credit volume: 400 vs 500.
4. Pro monthly pool: 2000 vs 3000.
5. Affiliate program duration policy (permanent vs conditional).
6. R2 image retention policy on Pro cancellation.

These remain open. The codebase carries placeholders (`PRO_DAILY_CREDITS_DEFAULT`, `PRO_MONTHLY_POOL_DEFAULT`) that should be revisited once decisions land. No business logic in Phase 1 depends on these values.
