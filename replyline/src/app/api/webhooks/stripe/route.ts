import { handleStripeWebhook } from "@/modules/billing/service";

/** Stripe webhook. Signature-verified and idempotent (see modules/billing/service.ts). */
export async function POST(req: Request) {
  const payload = await req.text();
  const r = await handleStripeWebhook(payload, req.headers.get("stripe-signature"));
  return new Response(r.body, { status: r.status });
}
