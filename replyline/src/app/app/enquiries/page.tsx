import Link from "next/link";
import { AlertTriangle, Copy, Download, Inbox, Upload } from "lucide-react";
import { requireApp } from "@/lib/auth/session";
import { listEnquiries, type ListFilters } from "@/modules/enquiries/service";
import { getStatuses, getOrganization } from "@/modules/orgs/service";
import { listMembers } from "@/modules/team/service";
import { can } from "@/modules/auth/permissions";
import { Badge, ButtonLink, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th, cx } from "@/components/ui";
import { PriorityBadge, StatusBadge } from "@/components/status";
import { formatInZone } from "@/lib/time";
import { setStatusAction } from "../actions";
import { BulkBar } from "./bulk-bar";

export const metadata = { title: "Enquiries" };

const VIEWS = [
  ["open", "Open"],
  ["overdue", "Overdue"],
  ["due_today", "Due today"],
  ["duplicates", "Possible duplicates"],
  ["all", "All"],
] as const;

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { actor } = await requireApp();
  const filters: ListFilters = {
    q: sp.q || undefined,
    status: sp.status || undefined,
    source: sp.source || undefined,
    priority: (sp.priority || undefined) as ListFilters["priority"],
    assigned: sp.assigned || undefined,
    view: (sp.view as ListFilters["view"]) || "open",
    sort: (sp.sort as ListFilters["sort"]) || "newest",
    page: Number(sp.page) || 1,
    pageSize: sp.layout === "board" ? 100 : 25,
  };
  const [list, statuses, org, team] = [await listEnquiries(actor, filters), await getStatuses(actor), await getOrganization(actor), await listMembers(actor)];
  const tz = org.timezone;
  const board = sp.layout === "board";
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/app/enquiries?${p}`;
  };
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const nameOf = (id: string | null) => team.members.find((m) => m.userId === id)?.name;

  return (
    <>
      <PageHeader
        title="Enquiries"
        description={`${list.total} ${filters.view === "all" ? "in total" : "matching"}.`}
        actions={
          <>
            {can(actor.role, "enquiry.import") && <ButtonLink href="/app/enquiries/import" variant="secondary"><Upload size={16} aria-hidden /> Import CSV</ButtonLink>}
            {can(actor.role, "enquiry.export") && <ButtonLink href="/api/export/enquiries" variant="secondary" prefetch={false}><Download size={16} aria-hidden /> Export</ButtonLink>}
            <ButtonLink href="/app/enquiries/new">New enquiry</ButtonLink>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Views">
        {VIEWS.map(([k, label]) => (
          <Link key={k} href={qs({ view: k, page: undefined })} role="tab" aria-selected={filters.view === k} className={cx("rounded-full px-3 py-1.5 text-sm", filters.view === k ? "bg-ink-900 text-white" : "bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50")}>
            {label}
          </Link>
        ))}
        <div className="ml-auto flex rounded-lg bg-white p-0.5 ring-1 ring-ink-200">
          <Link href={qs({ layout: undefined })} className={cx("rounded-md px-3 py-1 text-sm", !board ? "bg-ink-100 font-medium" : "text-ink-500")}>List</Link>
          <Link href={qs({ layout: "board", page: undefined })} className={cx("rounded-md px-3 py-1 text-sm", board ? "bg-ink-100 font-medium" : "text-ink-500")}>Pipeline</Link>
        </div>
      </div>

      <form className="mb-4 grid gap-2 sm:grid-cols-6" role="search">
        <input type="hidden" name="view" value={filters.view} />
        {board && <input type="hidden" name="layout" value="board" />}
        <label className="sr-only" htmlFor="q">Search</label>
        <Input id="q" name="q" placeholder="Search name, email, subject…" defaultValue={sp.q} className="sm:col-span-2" />
        <label className="sr-only" htmlFor="f-status">Status</label>
        <Select id="f-status" name="status" defaultValue={sp.status ?? ""}>
          <option value="">Any status</option>
          {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
        <label className="sr-only" htmlFor="f-source">Source</label>
        <Select id="f-source" name="source" defaultValue={sp.source ?? ""}>
          <option value="">Any source</option>
          {[...new Set([...org.settings.enquirySources, "Website form", "Email", "manual", "csv_import"])].map((s) => <option key={s}>{s}</option>)}
        </Select>
        <label className="sr-only" htmlFor="f-assigned">Assigned</label>
        <Select id="f-assigned" name="assigned" defaultValue={sp.assigned ?? ""}>
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {team.members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
        </Select>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="f-sort">Sort</label>
          <Select id="f-sort" name="sort" defaultValue={filters.sort}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="follow_up">Follow-up date</option>
            <option value="priority">Priority</option>
            <option value="updated">Recently updated</option>
          </Select>
          <button className="rounded-lg bg-ink-900 px-3 text-sm font-medium text-white">Apply</button>
        </div>
      </form>

      {list.rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox size={20} />}
            title={filters.view === "open" && !sp.q ? "No open enquiries" : "Nothing matches"}
            description={filters.view === "open" && !sp.q ? "Add one by hand, import a spreadsheet, or put the enquiry form on your website." : "Try a different view or clear the filters."}
            action={<ButtonLink href="/app/enquiries/new" size="sm">New enquiry</ButtonLink>}
          />
        </Card>
      ) : board ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {statuses.map((s) => {
            const col = list.rows.filter((r) => r.statusKey === s.key);
            return (
              <section key={s.key} className="w-72 shrink-0" aria-label={s.label}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <StatusBadge statusKey={s.key} statuses={statuses} />
                  <span className="text-xs text-ink-400">{col.length}</span>
                </div>
                <div className="space-y-2">
                  {col.map((r) => (
                    <Card key={r.id} className="p-3">
                      <Link href={`/app/enquiries/${r.id}`} className="block">
                        <div className="text-sm font-medium text-ink-900">{r.contactName}</div>
                        <div className="text-sm text-ink-600">{r.subject}</div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <PriorityBadge priority={r.priority} />
                          {r.overdue && <Badge tone="red">Overdue</Badge>}
                        </div>
                      </Link>
                      <form action={setStatusAction} className="mt-2 flex gap-1">
                        <input type="hidden" name="id" value={r.id} />
                        <label className="sr-only" htmlFor={`mv-${r.id}`}>Move to</label>
                        <select id={`mv-${r.id}`} name="statusKey" defaultValue={r.statusKey} className="h-7 flex-1 rounded border-ink-200 text-xs">
                          {statuses.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                        </select>
                        <button className="rounded bg-ink-100 px-2 text-xs">Move</button>
                      </form>
                    </Card>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <Card>
          {can(actor.role, "enquiry.bulk") && <BulkBar statuses={statuses.map((s) => ({ key: s.key, label: s.label }))} members={team.members.map((m) => ({ id: m.userId, name: m.name }))} />}
          <Table>
            <thead className="bg-ink-50">
              <tr>
                {can(actor.role, "enquiry.bulk") && <Th className="w-8"><span className="sr-only">Select</span></Th>}
                <Th>Customer</Th>
                <Th>Enquiry</Th>
                <Th>Status</Th>
                <Th>Source</Th>
                <Th>Next follow-up</Th>
                <Th>Received</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 bg-white">
              {list.rows.map((r) => {
                const overdue = r.overdue;
                return (
                  <tr key={r.id} className="hover:bg-ink-50/60">
                    {can(actor.role, "enquiry.bulk") && (
                      <Td><input type="checkbox" name="ids" value={r.id} form="bulk-form" aria-label={`Select ${r.subject}`} className="rounded border-ink-300" /></Td>
                    )}
                    <Td>
                      <Link href={`/app/enquiries/${r.id}`} className="font-medium text-ink-900 hover:text-brand-700">{r.contactName}</Link>
                      <div className="text-xs text-ink-500">{r.contactCompany ?? r.contactEmail}</div>
                    </Td>
                    <Td>
                      <Link href={`/app/enquiries/${r.id}`} className="text-ink-800 hover:text-brand-700">{r.subject}</Link>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <PriorityBadge priority={r.priority} />
                        {r.possibleDuplicateOfId && <Badge tone="violet"><Copy size={12} aria-hidden /> Possible duplicate</Badge>}
                        {r.assignedUserId && <Badge>{nameOf(r.assignedUserId)}</Badge>}
                      </div>
                    </Td>
                    <Td><StatusBadge statusKey={r.statusKey} statuses={statuses} /></Td>
                    <Td className="text-ink-500">{r.source}</Td>
                    <Td>
                      {r.nextFollowUpAt ? (
                        <span className={overdue ? "inline-flex items-center gap-1 font-medium text-red-600" : "text-ink-700"}>
                          {overdue && <AlertTriangle size={14} aria-label="Overdue" />}
                          {formatInZone(r.nextFollowUpAt, tz, "short")}
                        </span>
                      ) : <span className="text-ink-300">—</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-500">{formatInZone(r.createdAt, tz, "short")}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {pages > 1 && (
            <nav aria-label="Pagination" className="flex items-center justify-between border-t border-ink-100 px-4 py-3 text-sm">
              <span className="text-ink-500">Page {list.page} of {pages}</span>
              <div className="flex gap-2">
                {list.page > 1 && <ButtonLink size="sm" variant="secondary" href={qs({ page: String(list.page - 1) })}>Previous</ButtonLink>}
                {list.page < pages && <ButtonLink size="sm" variant="secondary" href={qs({ page: String(list.page + 1) })}>Next</ButtonLink>}
              </div>
            </nav>
          )}
        </Card>
      )}
    </>
  );
}
