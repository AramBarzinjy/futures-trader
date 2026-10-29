import { notFound } from "next/navigation";
import { resolveFormKey } from "@/modules/enquiries/intake";
import { BRAND } from "@/config/brand";
import { PublicForm } from "./public-form";

export const metadata = { title: "Send an enquiry", robots: { index: false } };

/** Hosted enquiry form. Embeddable in an iframe (see next.config.ts headers). */
export default async function FormPage({ params }: { params: Promise<{ formKey: string }> }) {
  const { formKey } = await params;
  const org = await resolveFormKey(formKey);
  if (!org) notFound();
  return (
    <div className="min-h-screen bg-white px-4 py-8">
      <div className="mx-auto max-w-lg">
        <h1 className="text-xl font-semibold text-ink-950">Contact {org.name}</h1>
        <p className="mt-1 text-sm text-ink-500">Tell us what you need and we&apos;ll get back to you.</p>
        <PublicForm formKey={formKey} orgName={org.name} />
        <p className="mt-8 text-center text-xs text-ink-400">Enquiry handled by {BRAND.name} on behalf of {org.name}. Your details are used to respond to this enquiry.</p>
      </div>
    </div>
  );
}
