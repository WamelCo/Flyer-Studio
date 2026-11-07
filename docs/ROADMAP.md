# Flyer Studio — Roadmap to world-class and enterprise-ready

_Written November 7, 2026, from market, research and codebase review. Update as phases land._

## Where we stand

**What already sets us apart**

| Strength | Why it matters (what competitors get wrong) |
| --- | --- |
| Output is always editable layers | The #1 complaint about AI design tools is flat images with garbled, uneditable text. |
| Ideogram lead + Layerize → editable, re-typed text | Ideogram-quality artwork with exact, correct copy — no tool we found combines both. |
| Fact guard (`lib/design/facts.ts`) | AI tools routinely invent dates, prices and deadlines; ours can't reach the page. |
| WCAG contrast audit on 12,960 designs | Legibility is guaranteed by test, not hoped for. |
| Art director with a requirements checklist | Directly answers "the AI doesn't do what it's told". |
| Free open model (Qwen on Groq) | Near-zero marginal cost per brief. |

**Gaps found in the audit**

- Generation runs synchronously in one request (up to 120 s); no retries per step, no real progress.
- No rate limiting, no security headers (CSP), no moderation before paid AI calls.
- No error monitoring, analytics or CI; tests are scripts run by hand.
- Design quality is never *checked* after composing — no render-and-critique loop.
- 5 layout archetypes and 9 type pairings; competitors offer thousands of templates.
- Editor lacks magic resize, brand kits, QR codes, background removal, version history, comments.
- Export is screen-grade: no bleed, crop marks, CMYK or PDF/X.
- Single-user accounts only: no workspaces, roles, approvals, SSO, SCIM or audit logs.
- English only.

## Principles

1. **Quality is measured, not assumed.** Every quality change must move an eval metric.
2. **Never a flat image. Never an invented fact. Never illegible text.** (Already enforced; keep it so.)
3. **Build B2B foundations early** (workspace IDs, roles, audit events) — retrofitting is far costlier.
4. **Each phase ships behind passing CI** (lint, typecheck, all test suites, contrast audit, build).

---

## Phase 0 — Production foundation (1–2 weeks) — ✅ built Nov 7, 2026

**Status:**
- **Background jobs:** built with Next.js `after()` + the `generation_jobs` row (polling, real stages), not Inngest — no extra service to run; swappable later.
- **Rate limits and spend caps:** built in Postgres (`rate_limit_hit`) rather than Upstash, for the same reason.
- **Moderation:** a safety verdict inside the art director's brief, not Llama Guard (it isn't served on our Groq account, and the free `gpt-oss-safeguard` tier allows only 2,000 tokens per minute).
- **Security headers, Sentry and PostHog hooks (optional keys), structured logs, CI with Playwright smoke tests:** built.
- **Transactional email and staging:** documented in `docs/DEPLOYMENT.md` (owner configures Supabase SMTP and a staging project).
- **Verified live (Nov 7):** migration applied; background jobs, real stages over HTTP, rate limits, row-level security on jobs, and the pg_cron sweeper (failed and refunded a dead job in 28 s).

**Original plan:**

| Deliverable | Approach |
| --- | --- |
| Generation as a background job | Inngest functions on our own Next.js routes: steps for direct → photos → Ideogram → compose → critique, each retried independently. The client gets a `jobId` at once and follows progress through Supabase Realtime on `generation_jobs` (`status`, `stage`). Removes the 120 s request and makes progress messages real. |
| Rate limits & spend caps | Upstash Ratelimit per user and per IP on generate, photos, export and sign-in codes. Daily Ideogram spend cap (env) with an alert. |
| Moderation before paid calls | Llama Guard 4 screens prompts (free endpoints exist) before any Ideogram spend; uploads screened later. |
| Security headers | CSP (Stripe, Supabase, Unsplash, Ideogram), HSTS, frame-ancestors, Referrer-Policy, Permissions-Policy. |
| Observability | Sentry (errors, traces, source maps), structured logs with request IDs, PostHog (funnels, feature flags). |
| CI | GitHub Actions: lint, typecheck, `test:director`, `test:ideogram`, `test:db`, `audit:contrast`, build; Playwright smoke tests. |
| Email | Resend + React Email as Supabase's SMTP (deliverable sign-in codes) and for low-credit / export-ready mail. |
| Environments | Staging Supabase project + Stripe test mode; migrations applied by CI. |

**Done when:** p95 time to first design ≤ 20 s (engine) / ≤ 60 s (Ideogram); a week of beta with zero unhandled Sentry errors; every check runs in CI.

## Phase 1 — World-class design quality (2–4 weeks) — 🟡 milestone A built Nov 7, 2026

**Status — milestone A (measure and self-correct):**
- **Server rendering:** FlyerDoc → SVG → PNG with resvg and 40 OFL font files in `assets/fonts` (`lib/render/`), matching the canvas. A three-up sheet renders in ~65 ms.
- **Design lint** (`lib/design/lint.ts`): cut-off or colliding type (line by line), tiny text, edge crowding, empty frames, weak hierarchy. Lint errors trigger a layout swap.
- **Benchmark:** 100 prompts × every format = 1,200 designs in under a second; 0 lint errors, score 100/100. In CI (`pnpm benchmark`); `--render` writes contact sheets, `--live` uses the real art director.
- **Critic + refine:** one wide contact sheet per review (~785 image tokens vs ~1,800 for one portrait). Fixes are applied, then each revision is **compared side by side with its original** — absolute re-scores drifted by up to 2.4 points on unchanged designs, more than a revision gains. Live result: a revision kept at 6.6 → 8.6, another rejected (original preferred 8 to 5).
- **Found:** Groq's free tier allows Qwen only **1,000 output tokens per minute**; a brief uses ~650–700, so the art director and critic can't both run in one minute, and the whole site manages ~1 generation per minute. The critic skips gracefully. Fix: a separate critic provider (`CRITIC_*`), or Groq's paid Dev Tier for production — see decision 5.
- **Found:** with no photos and a one-line message only 2 of 5 layouts are usable, so two directions share a layout — the layout milestone below fixes it (`pnpm test:design` pins the gap).

**Next:** 5 → 15+ layouts, then typography, imagery, learning from use.

| Deliverable | Approach |
| --- | --- |
| Render → critique → refine | The pattern behind VASCAR and "Seeing is Improving" (CVPR 2026). Render each design server-side (FlyerDoc → SVG → PNG with resvg, our font files, photos embedded). A vision model (Qwen 3.8 27B on Groq lists vision support; Llama 4 Scout as fallback) scores it against a rubric — hierarchy, alignment, balance, whitespace, legibility, brief requirements, palette fit — and returns fixes the engine can apply (swap palette or layout, enlarge headline, trim copy, move decoration). One refine round; keep the best. It also checks the Ideogram lead and falls back if the text layers don't match the art. |
| Quality benchmark | 100 prompts across 16 categories and several languages. Automatic metrics: overlap/overflow = 0, contrast pass, alignment and whitespace scores, critic score, requirement coverage (LLM judge). Runs in CI and fails on regressions. |
| 5 → 15+ layouts | Declarative layout trees (PosterO-style), so new layouts are data, not code: magazine cover, minimal centre, diagonal split, collage, menu/price list, agenda/timeline, product hero, quote, listing sheet, coupon/ticket, big-number infographic, invitation/certificate. |
| Typography | 9 → 30 Google Fonts pairings (OFL); kerning and ligatures; smart quotes; Noto for Arabic (RTL), Devanagari and CJK. |
| Imagery | Ideogram "artwork only" fills engine photo frames when no stock fits; background removal for cut-out subjects; duotone/halftone treatments; focal-point cropping. |
| Learn from use | Log which direction is opened, edits before export and regenerations; rank layout × palette per category with a bandit. |

**Done when:** median critic score ≥ 8/10 on the benchmark; ≥ 60% of generations exported without regenerating; zero overflow or contrast failures.

## Phase 2 — Editor parity with Canva and Kittl (3–5 weeks)

- **Magic resize:** one design into every format (poster, square, story, landscape, A5, US Letter, banner), keeping user edits.
- **Selection & layout:** multi-select, group, align and distribute, smart spacing guides, rulers, nudging, shortcut sheet, copy style.
- **Text:** per-word styling, auto-fit boxes, outline/shadow/curved text, Google Fonts picker, uploaded brand fonts.
- **Elements:** QR codes, larger icon library, lines and arrows, frames and masks, gradients, photo adjustments, background remover.
- **AI in the editor:** "rewrite this" (fact-guarded), "make it bolder", "suggest colours", generate artwork for a frame.
- **History:** 100-step undo (done), named version snapshots, autosave conflict detection.

**Done when:** in a 5-user test, resize-to-story takes under 10 s and replacing a logo under 15 s.

## Phase 3 — Print and publish (2–3 weeks)

- **Print-grade PDF:** per-product bleed (3 mm / 0.125″), optional crop marks, 300 dpi images, subset-embedded fonts, CMYK via Ghostscript + ICC (FOGRA39 / GRACoL) → PDF/X-4, plus a preflight report (low-res images, text in the bleed).
- **Order prints in-app:** Gelato API (flyers and posters, local production in 32 countries) — quote, order, track. Print margin becomes a revenue line.
- **Share:** public view links and download kits; social scheduling later.

## Phase 4 — Teams and brand (3–4 weeks)

- Workspaces with invitations and roles (owner, admin, editor, viewer) enforced by RLS on `workspace_id`; shared projects and folders; pooled credits.
- Brand kits (logos, colours, fonts, voice) applied to every generation; brand controls that restrict designs to brand colours and fonts; lockable template elements.
- Approvals: request review, approve or reject with comments, approval history CSV export (Canva Enterprise's headline feature).
- Comments and mentions; real-time co-editing later (Liveblocks or Yjs).
- Seat-based Team plan via Stripe quantities.

## Phase 5 — Enterprise (4–8 weeks, plus audit time)

- **Identity:** SAML/OIDC SSO, SCIM provisioning and an admin portal via WorkOS, bridged to Supabase sessions (Supabase has SAML but no SCIM). Domain verification, enforced SSO, just-in-time provisioning.
- **Audit logs:** append-only (sign-ins, role changes, exports, AI generations, billing), retained ≥ 1 year, CSV/API export, SIEM streaming.
- **Admin console:** members, roles, SSO, usage, spend caps, retention settings, and model-provider policy (e.g. US/EU-hosted models only for data-residency-sensitive customers).
- **Compliance:** SOC 2 Type I, then Type II (3–6 month window — start early, via Vanta or Drata); GDPR DPA and subprocessor list; Nigeria's NDPA 2023 if the entity is Nigerian; data export and deletion APIs; EU-region option.
- **Reliability:** 99.9% SLA, status page, point-in-time recovery, DR runbook, annual pen test.
- **Platform:** public REST API + webhooks, Zapier, Slack, Drive/Dropbox export, Shopify and Eventbrite connectors.

## Phase 6 — Growth

- UI and flyers in French, Spanish, Portuguese, Arabic and more (Noto fonts, RTL).
- Programmatic SEO: server-rendered template pages (`/templates/birthday-flyer`, …) built by the engine.
- Referrals, nonprofit and education pricing, PWA with native share.

---

## Decisions needed from the owner

1. **Payments entity.** If the business is registered in Nigeria, Stripe can't open a standard merchant account; Paystack (a Stripe company) is the local route, with Stripe via a UK/US entity for international cards.
2. **Credit economics.** Price an Ideogram lead with `pnpm ideogram:quote`, then set generation credits so Pro and Max stay profitable.
3. **First customer.** Self-serve small businesses first (recommended), then teams and agencies, then enterprise when deals ask for SSO.
4. **Model hosting policy.** Groq (US) is fine for most buyers; Z.AI and DeepSeek host in China — enterprise tenants may need them disabled.
5. **Model capacity for launch.** Groq's free tier caps Qwen at 1,000 output tokens per minute — about one generation per minute for the whole site, with no room for the critic. Options: Groq Dev Tier (pay per token; a generation is ~6k input + ~1k output tokens, a fraction of a cent), a second free provider for the critic (`CRITIC_*`, e.g. Z.AI's free GLM vision model), or both.

## Rule changes

| Rule | Change | Status |
| --- | --- | --- |
| `.claude/rules/canvas-editor.md` | Undo history 20 → 100 steps | Applied |
| `CLAUDE.md` | Points to this roadmap; lists approved additions (Inngest, Upstash, Sentry, PostHog, Resend, WorkOS, Gelato, resvg) to adopt with their phase | Applied |
| `.claude/rules/pricing.md` | Add Team (per seat) and Enterprise tiers | Waiting on decision 2–3 |
| `.claude/rules/ai-generation.md` | Add the critique loop and benchmark gate | Applied (Phase 1 milestone A) |

## Research sources

Market: [Lovart — AI poster tools 2026](https://www.lovart.ai/blog/7-best-ai-poster-design-tools-2026) · [Kittl vs Canva AI vs Adobe Express](https://tasarim.ai/en/compare/kittl-vs-canva-ai-vs-adobe-express) · [HubSpot — testing AI design tools](https://blog.hubspot.com/marketing/ai-for-graphic-design) · [Reddit designers' picks](https://www.aitooldiscovery.com/guides/best-ai-tools-for-graphic-designer-reddit) · [Recraft](https://en.wikipedia.org/wiki/Recraft) · [Canva brand controls](https://www.canva.com/en_au/help/brand-control/) · [Canva design approval](https://www.canva.com/en_au/help/design-approval-for-enterprise/)

Design research: [VASCAR (visual self-correction)](https://arxiv.org/pdf/2412.04237) · [Seeing is Improving (CVPR 2026)](https://openaccess.thecvf.com/content/CVPR2026/papers/Guo_Seeing_is_Improving_Visual_Feedback_for_Iterative_Text_Layout_Refinement_CVPR_2026_paper.pdf) · [PosterGen](https://arxiv.org/html/2508.17188v1) · [PosterO layout trees](https://awesomepapers.io/generative-models/papers/2505.07843) · [PosterCopilot](https://awesomepapers.io/generative-models/papers/2512.04082) · [LLMs as layout designers](https://arxiv.org/html/2509.16891v3) · [Awesome layout generation](https://github.com/wd1511/Awesome-Layout-Generation)

Enterprise: [Enterprise-ready SaaS 2026](https://www.ajayk.sh/blog/enterprise-ready-saas-sso-scim-audit-logs-2026/) · [SSO, SCIM, audit logs order](https://hashorn.com/blog/enterprise-ready-saas-sso-scim-audit-logs) · [Supabase SAML SSO](https://supabase.com/docs/guides/auth/sso/auth-sso-saml.md) · [Auth platforms with SSO + SCIM](https://clerk.com/articles/auth-platforms-with-sso-and-scim-in-the-base-tier-2)

Infrastructure, print, payments, safety: [Background jobs compared (Upstash)](https://upstash.com/blog/serverless-background-jobs-and-message-queues-every-major-option-in-2026) · [Trigger.dev vs Inngest](https://automationatlas.io/guides/trigger-dev-vs-inngest-2026-comparison/) · [Gelato printing](https://gelato.com/in/printing-service) · [Print-ready files](https://wttb.co.uk/support-guides/print-ready-pdf-guide) · [Flyer bleed requirements](https://www.4over4.com/faqs/flyers/what-file-format-should-i-use-for-flyer-printing) · [Stripe vs Paystack in Nigeria](https://kolonell.com/en/blog/stripe-vs-paystack-nigeria-comparison-2026) · [Llama Guard 4](https://build.nvidia.com/meta/llama-guard-4-12b/modelcard)
