# Pricing & Billing Rules (Paynow)

## Tiers
- **Free:** 0 credits included. Watermarked exports. 1 month data retention. No card or wallet needed.
- **Pro ($19.99 a month / $199.90 a year):** 2,000 credits a month. HD 2K/4K export. Photoshop (PSD) & Illustrator (SVG) files. No watermarks. Commercial use.
- **Max ($79.99 a month / $799.90 a year):** 20,000 credits a month. Higher priority generation. HD 2K/4K export. Photoshop & Illustrator files.
- Editable designer files (PSD, SVG) stay paid-only: a watermark in an editable file is a layer anyone can delete. Credit costs live in `CREDIT_COSTS` (`packages/billing/src/plans.ts`).

## Paynow Integration Rules
- Payments go through **Paynow Zimbabwe** (`packages/billing/src/paynow.ts`), in USD. Paynow has no automatic
  recurring charges, so Pro and Max are **prepaid passes** of 1 or 12 months: a pass's credits land
  once when the payment is confirmed (a yearly pass grants the whole year), and the pass lapses to Free
  at `profiles.current_period_end` unless renewed. Never describe passes as subscriptions or say they renew.
- Flow: POST /api/checkout creates a `payments` row (its id is the Paynow reference) and returns Paynow's
  payment page; Paynow returns the customer to /billing?payment=<id>, which polls GET /api/checkout/<id>;
  Paynow also posts to the result URL /api/webhooks/paynow. Every Paynow message is **hash-verified**
  (values in order + integration key, SHA512, upper-case) before it is trusted, and a paid status is
  confirmed by polling Paynow before anything is granted. Only Paynow hosts are ever polled.
- Fulfilment is one database function, `fulfil_payment` (`packages/db/drizzle`, called only from `packages/billing`): payment → paid, credits via
  `add_credits` with key `paynow:<payment id>` (exactly once), pass extended (same plan, still active) or
  started now (new, lapsed or different plan). A paid amount below the price never buys a pass.
- `effectivePlan()` reads an ended pass as Free immediately; the hourly `expire_lapsed_passes` task
  stores it. Credits already granted stay when a pass ends.
- **Credit Ledger:** Never mutate user credits directly in the UI. Always go through the Postgres functions (`deduct_credits`, `add_credits`, `fulfil_payment`, wrapped in `packages/db/src/credits.ts`) to prevent race conditions.
- Prices are read from `packages/billing/src/plans.ts` on the server — never from the client. Change a price there
  (and the copy that quotes it) and nowhere else.
- Test with `pnpm test:paynow` (hash against Paynow's documented examples, a mock Paynow) and `pnpm test:db`
  (passes, exactly-once credits, lapsing). In Paynow test mode set `PAYNOW_TEST_AUTH_EMAIL` to the merchant
  account's email. Paynow can't reach localhost: in development the return-page polling completes payments.
- Card tokenisation (true auto-renewal) needs Paynow's approval; it is not in use.

## WhatsApp-first accounts (owner decision, Nov 9)
- The phone number IS the account. The first message from a number ("Hi" or a flyer) creates it on the spot
  (`phoneAccount()`, `packages/auth/src/accounts.ts`) — no sign-up, no other details. A first message that
  describes a flyer starts it straight away.
- Every number gets **3 free flyers, once ever** (`grant_welcome_flyers`, recorded in `free_flyer_grants`, which
  outlives accounts). Free flyers are watermarked and never use a paid Ideogram image; usable on WhatsApp and the web.
  Free plan spends free flyers first; Pro/Max spend credits first (`chargeForFlyer`). A failed job gives back what it used.
- The web joins the same account: a WhatsApp-code sign-in finds it by number; an email account that proves the number
  (`/api/whatsapp/link`) absorbs it with `merge_accounts` (projects, credits, free flyers, pass, number).
- WhatsApp makes **one design per request** (`variations: 1`: the Ideogram lead when it runs, else the engine's best) —
  pricing matters. After a flyer the bot asks for fixes: a reply within 2 hours re-designs that flyer with the change
  (and costs one flyer, like any generation); a message starting with "new" is a different flyer; "resend" re-sends the
  last flyer free. No editor links in the chat.
- **Watermark only on free flyers.** Anything paid for with credits is clean, whatever the plan.
- Out of free flyers and never paid (no `pass:` or `grant:` credits): the bot replies **twice**, then stays silent —
  except to "buy" and the pass commands (`whatsapp_chats.out_of_credit_replies`).
- "buy" sells the same passes through `startPayment` (Paynow link in the chat); the bot polls and confirms in the chat.
- Comps / owner passes: `pnpm admin:grant-pass <phone|email> <pro|max> [month|year]` (`grant_pass`, credits keyed once).
