import { notFound } from "next/navigation";
import { Notice } from "@/components/ui";
import { BRAND } from "@/config/brand";

export function generateStaticParams() {
  return [{ doc: "privacy" }, { doc: "terms" }];
}

/*
 * PLACEHOLDERS. These pages outline what the real documents must cover.
 * They are not legal advice and must be replaced by documents reviewed by a
 * UK solicitor before launch. See docs/COMPLIANCE.md.
 */
export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (doc !== "privacy" && doc !== "terms") notFound();
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight text-ink-950">{doc === "privacy" ? "Privacy policy" : "Terms of service"}</h1>
      <div className="mt-6">
        <Notice tone="warn" title="Draft placeholder — requires legal review before launch">
          This page lists the topics the final document needs to cover. It is not a legal document and must not be relied on.
        </Notice>
      </div>
      <div className="prose-legal mt-8">
        {doc === "privacy" ? (
          <>
            <h2>Who we are</h2>
            <p>{BRAND.name} [legal entity name, company number, registered address, ICO registration number]. Contact: {BRAND.supportEmail}.</p>
            <h2>Our two roles</h2>
            <p>We are the <strong>controller</strong> for data about our own customers (the businesses that subscribe). We are a <strong>processor</strong> for the enquiry and contact data those businesses store in {BRAND.name}; each business is the controller of that data. [Link to Data Processing Agreement.]</p>
            <h2>What we collect, why, and the lawful basis</h2>
            <ul>
              <li>Account data (name, email, password hash) — contract.</li>
              <li>Billing data via our payment processor — contract / legal obligation.</li>
              <li>Usage and security logs — legitimate interests.</li>
            </ul>
            <h2>Sub-processors</h2>
            <p>[Hosting provider, database provider, email delivery provider, AI provider (only if a business enables AI drafting), payment processor.] Include locations and transfer safeguards (UK IDTA / Addendum) for any processing outside the UK.</p>
            <h2>Retention</h2>
            <p>[Account data retention; how long logs are kept; what happens after cancellation.]</p>
            <h2>Your rights</h2>
            <p>Access, rectification, erasure, restriction, portability, objection, and the right to complain to the ICO (ico.org.uk).</p>
            <h2>Cookies</h2>
            <p>We use one strictly necessary session cookie to keep you signed in. [List any analytics added later and obtain consent where PECR requires it.]</p>
          </>
        ) : (
          <>
            <h2>The service</h2>
            <p>[Description, plans, fair-use limits, changes to the service.]</p>
            <h2>Accounts and acceptable use</h2>
            <p>[No unsolicited bulk email; customers responsible for having a lawful basis to contact their own customers; no unlawful content; suspension rights.]</p>
            <h2>Fees, trials, renewal and cancellation</h2>
            <p>[Billing in advance, VAT, automatic renewal, cancellation at period end, refunds policy, price changes with notice.]</p>
            <h2>Customer data</h2>
            <p>[Customer owns its data; Data Processing Agreement incorporated by reference; export on termination; deletion timeline.]</p>
            <h2>AI features</h2>
            <p>[AI output may be inaccurate; customer reviews before sending; which provider processes data; no training on customer data.]</p>
            <h2>Liability</h2>
            <p>[Limitations and exclusions compliant with UK law, including the Consumer Rights Act where any customer is a consumer.]</p>
            <h2>Governing law</h2>
            <p>[England and Wales.]</p>
          </>
        )}
      </div>
    </section>
  );
}
