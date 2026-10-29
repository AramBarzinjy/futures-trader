import Link from "next/link";
import { Users } from "lucide-react";
import { requireApp } from "@/lib/auth/session";
import { listContacts } from "@/modules/contacts/service";
import { Badge, ButtonLink, Card, EmptyState, Input, PageHeader, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { actor } = await requireApp();
  const page = Number(sp.page) || 1;
  const list = await listContacts(actor, { q: sp.q, page });
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  return (
    <>
      <PageHeader title="Contacts" description="Everyone who has enquired. Contacts are created automatically from enquiries." />
      <form className="mb-4 flex max-w-md gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search contacts</label>
        <Input id="q" name="q" defaultValue={sp.q} placeholder="Search name, email, phone, company" />
        <button className="rounded-lg bg-ink-900 px-4 text-sm font-medium text-white">Search</button>
      </form>
      <Card>
        {list.rows.length === 0 ? (
          <EmptyState icon={<Users size={20} />} title={sp.q ? "No matches" : "No contacts yet"} description="Contacts appear here when you add or import enquiries." action={<ButtonLink size="sm" href="/app/enquiries/new">New enquiry</ButtonLink>} />
        ) : (
          <Table>
            <thead className="bg-ink-50"><tr><Th>Name</Th><Th>Email</Th><Th>Phone</Th><Th>Enquiries</Th><Th>Marketing</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {list.rows.map((c) => (
                <tr key={c.id} className="hover:bg-ink-50/60">
                  <Td><Link href={`/app/contacts/${c.id}`} className="font-medium text-ink-900 hover:text-brand-700">{c.name}</Link>{c.company && <div className="text-xs text-ink-500">{c.company}</div>}</Td>
                  <Td>{c.email ?? "—"}</Td>
                  <Td>{c.phone ?? "—"}</Td>
                  <Td className="tabular-nums">{c.enquiryCount}</Td>
                  <Td><Badge tone={c.marketingConsent === "granted" ? "green" : c.marketingConsent === "withdrawn" ? "red" : "slate"}>{c.marketingConsent}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {pages > 1 && (
          <nav aria-label="Pagination" className="flex justify-between border-t border-ink-100 px-4 py-3 text-sm">
            <span className="text-ink-500">Page {page} of {pages}</span>
            <div className="flex gap-2">
              {page > 1 && <ButtonLink size="sm" variant="secondary" href={`?q=${sp.q ?? ""}&page=${page - 1}`}>Previous</ButtonLink>}
              {page < pages && <ButtonLink size="sm" variant="secondary" href={`?q=${sp.q ?? ""}&page=${page + 1}`}>Next</ButtonLink>}
            </div>
          </nav>
        )}
      </Card>
    </>
  );
}
