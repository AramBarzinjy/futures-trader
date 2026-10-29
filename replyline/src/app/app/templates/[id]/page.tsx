import Link from "next/link";
import { notFound } from "next/navigation";
import { requireApp } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { getTemplate } from "@/modules/templates/service";
import { recentEnquiriesForTest } from "@/modules/automation/workflows";
import { can } from "@/modules/auth/permissions";
import { TEMPLATE_VARIABLES } from "@/config/industries";
import { TemplateEditor } from "./editor";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireApp();
  let t = null;
  if (id !== "new") {
    try {
      t = await getTemplate(actor, id);
    } catch (e) {
      if (e instanceof AppError && e.code === "not_found") notFound();
      throw e;
    }
  }
  const enquiries = await recentEnquiriesForTest(actor);
  return (
    <>
      <Link href="/app/templates" className="text-sm text-ink-500 hover:text-ink-800">← Templates</Link>
      <h1 className="mb-6 mt-2 text-2xl font-semibold tracking-tight">{t?.name ?? "New template"}</h1>
      <TemplateEditor
        template={t ? { id: t.id, name: t.name, purpose: t.purpose, kind: t.kind, subject: t.subject, body: t.body, builtIn: !t.key.startsWith("custom_") } : null}
        variables={[...TEMPLATE_VARIABLES]}
        enquiries={enquiries}
        canEdit={can(actor.role, "template.write")}
      />
    </>
  );
}
