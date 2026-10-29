import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { receiveInboundEmail } from "@/modules/enquiries/intake";

/*
 * Inbound email webhook. An email provider's inbound-parse feature posts here
 * (shape documented in docs/INTEGRATIONS.md). Requires the shared secret in
 * the Authorization header: "Bearer <INBOUND_EMAIL_SECRET>".
 */
function authorised(header: string | null) {
  const secret = env().INBOUND_EMAIL_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request, { params }: { params: Promise<{ formKey: string }> }) {
  if (!authorised(req.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  const { formKey } = await params;
  try {
    const r = await receiveInboundEmail(formKey, await req.json());
    return Response.json(r);
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ error: "Invalid payload" }, { status: 422 });
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.code === "not_found" ? 404 : 429 });
    console.error("[inbound] failed");
    return new Response("Error", { status: 500 });
  }
}
