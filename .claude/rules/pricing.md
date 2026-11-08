# Pricing & Billing Rules (Stripe)

## Tiers
- **Free:** 0 credits included. Watermarked exports. 1 month data retention. No credit card required.
- **Pro ($19.99/mo):** 2,000 credits/mo. HD 2K/4K export. No watermarks. Commercial use.
- **Max ($79.99/mo):** 20,000 credits/mo. Higher priority generation. HD 2K/4K export.

## Stripe Integration Rules
- Use Stripe Checkout for upgrades. Use Customer Portal for management.
- Webhooks MUST handle: `checkout.session.completed` (provision credits), `invoice.paid` (renew credits), `customer.subscription.deleted` (downgrade to Free).
- **Credit Ledger:** Never mutate user credits directly in the UI. Always use a Postgres RPC (`deduct_credits`, `add_credits`) to prevent race conditions.
- Price IDs must be mapped in `packages/core/src/stripe/plans.ts`. Do not hardcode price IDs in components.