import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { submitPublicForm } from "@/modules/enquiries/intake";
import { runDueJobs } from "@/worker/process";

/*
 * Public enquiry endpoint used by the hosted form and by customers' own website
 * forms. Never returns stored data. CORS is open because the form key, not the
 * origin, identifies the workspace; rate limits and spam checks apply.
 */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: Request, { params }: { params: Promise<{ formKey: string }> }) {
  const { formKey } = await params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const type = req.headers.get("content-type") ?? "";
  let body: Record<string, unknown>;
  try {
    if (type.includes("application/json")) body = await req.json();
    else body = Object.fromEntries((await req.formData()).entries());
  } catch {
    return Response.json({ ok: false, error: "Could not read the form." }, { status: 400, headers: CORS });
  }
  if (typeof body.marketingConsent === "string") body.marketingConsent = body.marketingConsent === "on" || body.marketingConsent === "true";
  if (typeof body.elapsedMs === "string") body.elapsedMs = Number(body.elapsedMs);
  try {
    await submitPublicForm(formKey, body, ip);
    await runDueJobs(10).catch(() => undefined); // send the acknowledgement promptly if auto-send is on
    return Response.json({ ok: true }, { headers: CORS });
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ ok: false, error: e.issues[0]?.message ?? "Please check the form." }, { status: 422, headers: CORS });
    if (e instanceof AppError) {
      const status = e.code === "not_found" ? 404 : e.code === "rate_limited" ? 429 : 400;
      return Response.json({ ok: false, error: e.message }, { status, headers: CORS });
    }
    console.error("[form] submission failed");
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500, headers: CORS });
  }
}
