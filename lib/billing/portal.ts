import { apiFetch } from "@/lib/api/client";

/** Customer Portal is Stripe-hosted by design (management, not checkout). */
export async function openBillingPortal() {
  const { url } = await apiFetch<{ url: string }>("/api/billing/portal", { method: "POST" });
  window.location.assign(url);
}
