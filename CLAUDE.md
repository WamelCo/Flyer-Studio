# CLAUDE.md — AI Flyer Generator

> This file is loaded on every turn. Keep it under 200 lines.
> Specialized rules live in `.claude/rules/*.md` and are loaded on demand.

---

## 1. Project Context

A production SaaS that generates flyers from a text prompt, lets users edit them on a canvas, and exports for print or social. Quality bar is Apple-level: clarity, deference, depth, consistency.

**Stack (mandatory, do not substitute):**
- Next.js 14+ (App Router), TypeScript strict mode
- Tailwind CSS + shadcn/ui
- Supabase (Auth, Postgres, Storage)
- Stripe (Subscriptions + Embedded Checkout + Webhooks)
- A text LLM as art director + a layout engine (`lib/design/`) — no image generation. Claude (`@anthropic-ai/sdk`) when `ANTHROPIC_API_KEY` is set; otherwise an open-weight model (Qwen / GLM / DeepSeek) over an OpenAI-compatible API (`lib/design/open-model.ts`)
- Unsplash (stock photography for photo frames)
- Konva (`react-konva`) for the canvas editor
- Framer Motion for ALL UI animation

---

## 2. Commands

```bash
pnpm dev                         # Start dev server
pnpm build                       # Production build — must pass before any phase is "done"
pnpm lint                        # ESLint — must pass before any phase is "done"
pnpm typecheck                   # tsc --noEmit
pnpm supabase gen types typescript --local > lib/db/types.ts
pnpm stripe listen --forward-to localhost:3000/api/webhooks/stripe
pnpm stripe:setup                # Test mode: create products/prices/portal config, write IDs to .env.local
pnpm stripe:webhooks [--replay]  # Forward test events to the dev server without the Stripe CLI
pnpm test:stripe                 # Billing end to end in test mode (needs pnpm dev running)
pnpm test:director               # Art director against a mock OpenAI-compatible provider
pnpm director:try "<prompt>"     # Try the configured art director on a real prompt
pnpm audit:contrast              # WCAG contrast across every layout × palette × pairing × format