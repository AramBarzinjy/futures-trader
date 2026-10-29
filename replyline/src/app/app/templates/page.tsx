import Link from "next/link";
import { requireApp } from "@/lib/auth/session";
import { listTemplates } from "@/modules/templates/service";
import { can } from "@/modules/auth/permissions";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Email templates" };

export default async function TemplatesPage() {
  const { actor } = await requireApp();
  const templates = await listTemplates(actor);
  return (
    <>
      <PageHeader
        title="Email templates"
        description="Used by workflows and the reply composer. Variables like {{customer_first_name}} are filled in for each customer; anything missing is flagged before sending."
        actions={can(actor.role, "template.write") && <ButtonLink href="/app/templates/new">New template</ButtonLink>}
      />
      <Card>
        <ul className="divide-y divide-ink-100">
          {templates.map((t) => (
            <li key={t.id}>
              <Link href={`/app/templates/${t.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-ink-50">
                <div>
                  <div className="font-medium text-ink-900">{t.name}</div>
                  <div className="text-sm text-ink-500">{t.purpose}</div>
                </div>
                <div className="flex gap-2">
                  {t.kind === "marketing" && <Badge tone="violet">Marketing</Badge>}
                  {t.key.startsWith("custom_") ? <Badge>Custom</Badge> : <Badge tone="teal">Built-in</Badge>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
