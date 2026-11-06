app/
  (marketing)/            # Landing, pricing — public
  (app)/                  # Dashboard, editor — auth required
  api/
    generate/             # AI generation — checks credits
    export/               # PDF/PNG export — deducts credits
    webhooks/stripe/      # Stripe events — idempotent
components/
  ui/                     # shadcn primitives — do not modify internals
  canvas/                 # Konva editor components
  marketing/              # Landing page sections
lib/
  supabase/               # Client, server, middleware helpers
  stripe/                 # Plans map, checkout, webhook verification
  ai/                     # Replicate wrapper, prompt sanitizer
  db/                     # Types + RPC wrappers (credits)
docs/                     # ARCHITECTURE.md
.claude/rules/            # Path-scoped specialized rules