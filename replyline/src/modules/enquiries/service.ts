import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { sequential } from "@/lib/db/sequential";
import { schema, withTenant, type TenantTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { parseCsv, toCsv } from "@/lib/csv";
import { assertCan, type Actor } from "@/modules/auth/permissions";
import { assertFeature, hasFeature } from "@/modules/billing/entitlements";
import { audit } from "@/modules/audit/service";
import { contactInputSchema, escapeLike, findOrCreateContact } from "@/modules/contacts/service";
import { startEnquiryWorkflows, stopRunsForEnquiry } from "@/modules/automation/engine";

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const DUPLICATE_WINDOW_DAYS = 14;

export const enquiryInputSchema = z.object({
  contact: contactInputSchema,
  subject: z.string().trim().min(1, "Subject is required").max(200),
  message: z.string().trim().max(20_000).default(""),
  source: z.string().trim().min(1).max(60).default("manual"),
  category: z.string().trim().max(60).optional().or(z.literal("")),
  priority: z.enum(PRIORITIES).default("normal"),
  assignedUserId: z.string().uuid().optional().or(z.literal("")),
  customFields: z.record(z.string(), z.string().max(1000)).default({}),
  marketingConsent: z.boolean().optional(),
});
export type EnquiryInput = z.input<typeof enquiryInputSchema>;

export interface CreateOptions {
  /** Start enabled workflows (acknowledgement, follow-ups). Off for imports of historic leads. */
  runAutomation?: boolean;
  /** Where consent came from, recorded with it. */
  consentSource?: string;
}

type CreatedEnquiry = {
  id: string;
  contactId: string;
  possibleDuplicateOfId: string | null;
  contactMatched: boolean;
  conflicts: { field: string; existing: string; incoming: string }[];
};

/**
 * The one way enquiries enter the system — manual entry, CSV, website form and
 * inbound email all call this, so normalisation and duplicate rules are shared.
 */
export async function createEnquiryTx(tx: TenantTx, orgId: string, actorUserId: string | null, input: EnquiryInput, opts: CreateOptions = {}): Promise<CreatedEnquiry> {
  const data = enquiryInputSchema.parse(input);
  if (!data.contact.email && !data.contact.phone) throw new AppError("Add an email address or phone number so you can reply.");
  if (data.assignedUserId) {
    // Filter by org explicitly: RLS also lets a user see their own memberships in other workspaces.
    const m = await tx.query.memberships.findFirst({ where: and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, data.assignedUserId)), columns: { id: true } });
    if (!m) throw new AppError("Assigned user is not in this workspace.");
  }
  const match = await findOrCreateContact(tx, orgId, data.contact);
  if (data.marketingConsent && match.contact.marketingConsent !== "withdrawn") {
    await tx
      .update(schema.contacts)
      .set({ marketingConsent: "granted", consentSource: opts.consentSource ?? data.source, consentAt: new Date() })
      .where(eq(schema.contacts.id, match.contact.id));
  }

  // Possible duplicate: same contact has another open enquiry in the last 14 days. Flag only — never merge automatically.
  const since = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 86_400_000);
  const dup = match.matched
    ? await tx.query.enquiries.findFirst({
        where: and(eq(schema.enquiries.contactId, match.contact.id), isNull(schema.enquiries.closedAt), gte(schema.enquiries.createdAt, since)),
        orderBy: [desc(schema.enquiries.createdAt)],
        columns: { id: true },
      })
    : undefined;

  const firstStatus = await tx.query.pipelineStatuses.findFirst({
    where: eq(schema.pipelineStatuses.isClosed, false),
    orderBy: [asc(schema.pipelineStatuses.position)],
  });
  const [enquiry] = await tx
    .insert(schema.enquiries)
    .values({
      orgId,
      contactId: match.contact.id,
      subject: data.subject,
      message: data.message,
      source: data.source,
      category: data.category || null,
      priority: data.priority,
      statusKey: firstStatus?.key ?? "new",
      assignedUserId: data.assignedUserId || null,
      customFields: data.customFields,
      possibleDuplicateOfId: dup?.id ?? null,
    })
    .returning({ id: schema.enquiries.id });

  await tx.insert(schema.activities).values({
    orgId,
    enquiryId: enquiry.id,
    contactId: match.contact.id,
    actorUserId,
    type: "enquiry.created",
    summary: `Enquiry received via ${data.source}`,
  });
  if (match.conflicts.length) {
    await tx.insert(schema.activities).values({
      orgId,
      enquiryId: enquiry.id,
      contactId: match.contact.id,
      type: "contact.conflict",
      summary: `New details differ from the saved contact (${match.conflicts.map((c) => c.field).join(", ")}). Saved details were kept.`,
      data: { conflicts: match.conflicts },
    });
  }
  if (dup) {
    await tx.insert(schema.activities).values({ orgId, enquiryId: enquiry.id, type: "enquiry.possible_duplicate", summary: "Possible duplicate of a recent open enquiry", data: { otherId: dup.id } });
  }
  if (opts.runAutomation !== false) await startEnquiryWorkflows(tx, orgId, enquiry.id);
  return { id: enquiry.id, contactId: match.contact.id, possibleDuplicateOfId: dup?.id ?? null, contactMatched: match.matched, conflicts: match.conflicts };
}

export async function createEnquiry(actor: Actor, input: EnquiryInput, opts: CreateOptions = {}) {
  assertCan(actor, "enquiry.write");
  return withTenant(actor, (tx) => createEnquiryTx(tx, actor.orgId, actor.userId, { ...input, source: input.source ?? "manual" }, opts));
}

// ------------------------------------------------------------ listing

export const listFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.string().max(40).optional(),
  source: z.string().max(60).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigned: z.string().max(60).optional(), // user id | "me" | "unassigned"
  view: z.enum(["all", "open", "overdue", "due_today", "duplicates"]).default("open"),
  sort: z.enum(["newest", "oldest", "follow_up", "priority", "updated"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
export type ListFilters = z.input<typeof listFiltersSchema>;

export async function listEnquiries(actor: Actor, filters: ListFilters) {
  assertCan(actor, "enquiry.read");
  const f = listFiltersSchema.parse(filters);
  return withTenant(actor, async (tx) => {
    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const where: SQL[] = [];
    if (f.q) {
      const like = `%${escapeLike(f.q)}%`;
      where.push(or(ilike(schema.enquiries.subject, like), ilike(schema.enquiries.message, like), ilike(schema.contacts.name, like), ilike(schema.contacts.email, like), ilike(schema.contacts.company, like))!);
    }
    if (f.status) where.push(eq(schema.enquiries.statusKey, f.status));
    if (f.source) where.push(eq(schema.enquiries.source, f.source));
    if (f.priority) where.push(eq(schema.enquiries.priority, f.priority));
    if (f.assigned === "me" && actor.userId) where.push(eq(schema.enquiries.assignedUserId, actor.userId));
    else if (f.assigned === "unassigned") where.push(isNull(schema.enquiries.assignedUserId));
    else if (f.assigned && /^[0-9a-f-]{36}$/.test(f.assigned)) where.push(eq(schema.enquiries.assignedUserId, f.assigned));
    if (f.view === "open") where.push(isNull(schema.enquiries.closedAt));
    if (f.view === "overdue") where.push(isNull(schema.enquiries.closedAt), lt(schema.enquiries.nextFollowUpAt, now));
    if (f.view === "due_today") where.push(isNull(schema.enquiries.closedAt), lt(schema.enquiries.nextFollowUpAt, endOfDay));
    if (f.view === "duplicates") where.push(isNotNull(schema.enquiries.possibleDuplicateOfId), isNull(schema.enquiries.closedAt));

    const order = {
      newest: [desc(schema.enquiries.createdAt)],
      oldest: [asc(schema.enquiries.createdAt)],
      updated: [desc(schema.enquiries.updatedAt)],
      follow_up: [sql`${schema.enquiries.nextFollowUpAt} asc nulls last`],
      priority: [sql`array_position(array['urgent','high','normal','low'], ${schema.enquiries.priority})`, desc(schema.enquiries.createdAt)],
    }[f.sort];

    const cond = where.length ? and(...where) : undefined;
    const rows = await tx
      .select({
        id: schema.enquiries.id,
        subject: schema.enquiries.subject,
        source: schema.enquiries.source,
        category: schema.enquiries.category,
        priority: schema.enquiries.priority,
        statusKey: schema.enquiries.statusKey,
        nextFollowUpAt: schema.enquiries.nextFollowUpAt,
        createdAt: schema.enquiries.createdAt,
        updatedAt: schema.enquiries.updatedAt,
        closedAt: schema.enquiries.closedAt,
        possibleDuplicateOfId: schema.enquiries.possibleDuplicateOfId,
        lastInboundAt: schema.enquiries.lastInboundAt,
        lastOutboundAt: schema.enquiries.lastOutboundAt,
        contactId: schema.contacts.id,
        contactName: schema.contacts.name,
        contactEmail: schema.contacts.email,
        contactCompany: schema.contacts.company,
        assignedUserId: schema.enquiries.assignedUserId,
      })
      .from(schema.enquiries)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.enquiries.contactId))
      .where(cond)
      .orderBy(...order)
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize);
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.enquiries)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.enquiries.contactId))
      .where(cond);
    return { rows, total, page: f.page, pageSize: f.pageSize, filters: f };
  });
}

export async function getEnquiry(actor: Actor, id: string) {
  assertCan(actor, "enquiry.read");
  return withTenant(actor, async (tx) => {
    const enquiry = await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, id) });
    if (!enquiry) throw new AppError("Enquiry not found", "not_found");
    const [contact, notes, messages, activities, appointments, runs] = await sequential([
      () => tx.query.contacts.findFirst({ where: eq(schema.contacts.id, enquiry.contactId) }),
      () => tx
        .select({ id: schema.notes.id, body: schema.notes.body, createdAt: schema.notes.createdAt, authorName: schema.users.name })
        .from(schema.notes)
        .leftJoin(schema.users, eq(schema.users.id, schema.notes.authorId))
        .where(eq(schema.notes.enquiryId, id))
        .orderBy(desc(schema.notes.createdAt)),
      () => tx.query.messages.findMany({ where: eq(schema.messages.enquiryId, id), orderBy: [desc(schema.messages.createdAt)] }),
      () => tx.query.activities.findMany({ where: eq(schema.activities.enquiryId, id), orderBy: [desc(schema.activities.createdAt)], limit: 100 }),
      () => tx.query.appointments.findMany({ where: eq(schema.appointments.enquiryId, id), orderBy: [desc(schema.appointments.startsAt)] }),
      () => tx
        .select({ id: schema.workflowRuns.id, status: schema.workflowRuns.status, stopReason: schema.workflowRuns.stopReason, name: schema.workflows.name, startedAt: schema.workflowRuns.startedAt })
        .from(schema.workflowRuns)
        .innerJoin(schema.workflows, eq(schema.workflows.id, schema.workflowRuns.workflowId))
        .where(eq(schema.workflowRuns.enquiryId, id)),
    ] as const);
    return { enquiry, contact: contact!, notes, messages, activities, appointments, runs };
  });
}

// ------------------------------------------------------------ updates

export const enquiryPatchSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    statusKey: z.string().max(40),
    priority: z.enum(PRIORITIES),
    category: z.string().trim().max(60).nullable(),
    assignedUserId: z.string().uuid().nullable(),
    nextFollowUpAt: z.coerce.date().nullable(),
    customFields: z.record(z.string(), z.string().max(1000)),
  })
  .partial();

async function applyPatch(tx: TenantTx, actor: Actor, id: string, patch: z.infer<typeof enquiryPatchSchema>) {
  const current = await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, id) });
  if (!current) throw new AppError("Enquiry not found", "not_found");
  const values: Partial<typeof schema.enquiries.$inferInsert> = { ...patch, updatedAt: new Date() };
  const changes: string[] = [];

  if (patch.statusKey && patch.statusKey !== current.statusKey) {
    const status = await tx.query.pipelineStatuses.findFirst({ where: eq(schema.pipelineStatuses.key, patch.statusKey) });
    if (!status) throw new AppError("Unknown status");
    values.closedAt = status.isClosed ? new Date() : null;
    changes.push(`status → ${status.label}`);
    if (status.isClosed || status.stopsFollowUps) await stopRunsForEnquiry(tx, actor.orgId, id, `Status changed to ${status.label}`);
  }
  if (patch.assignedUserId !== undefined && patch.assignedUserId !== current.assignedUserId) {
    if (patch.assignedUserId) {
      if (!(await hasFeature(tx, actor.orgId, "teamAssignment"))) {
        // Single-user plans can still "assign" to themselves; anything else needs the feature.
        if (patch.assignedUserId !== actor.userId) await assertFeature(tx, actor.orgId, "teamAssignment", "Team assignment");
      }
      const m = await tx.query.memberships.findFirst({ where: and(eq(schema.memberships.orgId, actor.orgId), eq(schema.memberships.userId, patch.assignedUserId)), columns: { id: true } });
      if (!m) throw new AppError("That person isn't in this workspace.");
    }
    changes.push(patch.assignedUserId ? "reassigned" : "unassigned");
  }
  if (patch.priority && patch.priority !== current.priority) changes.push(`priority → ${patch.priority}`);
  if (patch.nextFollowUpAt !== undefined) changes.push(patch.nextFollowUpAt ? "follow-up date set" : "follow-up date cleared");
  if (patch.customFields) {
    if (!(await hasFeature(tx, actor.orgId, "customFields"))) await assertFeature(tx, actor.orgId, "customFields", "Custom fields");
    values.customFields = { ...current.customFields, ...patch.customFields };
  }
  await tx.update(schema.enquiries).set(values).where(eq(schema.enquiries.id, id));
  if (changes.length) {
    await tx.insert(schema.activities).values({ orgId: actor.orgId, enquiryId: id, contactId: current.contactId, actorUserId: actor.userId, type: "enquiry.updated", summary: changes.join(", ") });
  }
}

export async function updateEnquiry(actor: Actor, id: string, patch: z.input<typeof enquiryPatchSchema>) {
  assertCan(actor, "enquiry.write");
  const data = enquiryPatchSchema.parse(patch);
  await withTenant(actor, (tx) => applyPatch(tx, actor, id, data));
}

export async function addNote(actor: Actor, enquiryId: string, body: string) {
  assertCan(actor, "enquiry.write");
  const text = z.string().trim().min(1, "Note is empty").max(10_000).parse(body);
  await withTenant(actor, async (tx) => {
    const e = await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, enquiryId), columns: { id: true } });
    if (!e) throw new AppError("Enquiry not found", "not_found");
    await tx.insert(schema.notes).values({ orgId: actor.orgId, enquiryId, authorId: actor.userId, body: text });
    await tx.insert(schema.activities).values({ orgId: actor.orgId, enquiryId, actorUserId: actor.userId, type: "note.added", summary: "Internal note added" });
  });
}

/** Resolve a duplicate flag. Never merges data: either clear the flag, or close this one as a duplicate. */
export async function resolveDuplicate(actor: Actor, id: string, resolution: "not_duplicate" | "close_as_duplicate") {
  assertCan(actor, "enquiry.write");
  await withTenant(actor, async (tx) => {
    const e = await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, id) });
    if (!e?.possibleDuplicateOfId) throw new AppError("This enquiry isn't flagged as a duplicate.", "conflict");
    if (resolution === "not_duplicate") {
      await tx.update(schema.enquiries).set({ possibleDuplicateOfId: null, updatedAt: new Date() }).where(eq(schema.enquiries.id, id));
    } else {
      const lost = await tx.query.pipelineStatuses.findFirst({ where: and(eq(schema.pipelineStatuses.isClosed, true), eq(schema.pipelineStatuses.outcome, "lost")) });
      await applyPatch(tx, actor, id, { statusKey: lost?.key ?? e.statusKey });
      await tx.update(schema.enquiries).set({ closedAt: new Date() }).where(eq(schema.enquiries.id, id));
    }
    await tx.insert(schema.activities).values({
      orgId: actor.orgId,
      enquiryId: id,
      actorUserId: actor.userId,
      type: "enquiry.duplicate_resolved",
      summary: resolution === "not_duplicate" ? "Marked as not a duplicate" : "Closed as a duplicate",
      data: { otherId: e.possibleDuplicateOfId },
    });
  });
}

// ------------------------------------------------------------ bulk

export const BULK_LIMIT = 200;
export const bulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), ids: z.array(z.string().uuid()).min(1).max(BULK_LIMIT), statusKey: z.string() }),
  z.object({ action: z.literal("assign"), ids: z.array(z.string().uuid()).min(1).max(BULK_LIMIT), assignedUserId: z.string().uuid().nullable() }),
  z.object({ action: z.literal("priority"), ids: z.array(z.string().uuid()).min(1).max(BULK_LIMIT), priority: z.enum(PRIORITIES) }),
  // Deleting requires typing the count back, so a stray click can't wipe a pipeline.
  z.object({ action: z.literal("delete"), ids: z.array(z.string().uuid()).min(1).max(BULK_LIMIT), confirmCount: z.number() }),
]);

export async function bulkUpdate(actor: Actor, input: z.input<typeof bulkSchema>) {
  assertCan(actor, "enquiry.bulk");
  const data = bulkSchema.parse(input);
  return withTenant(actor, async (tx) => {
    const found = await tx.select({ id: schema.enquiries.id }).from(schema.enquiries).where(inArray(schema.enquiries.id, data.ids));
    const ids = found.map((r) => r.id);
    if (data.action === "delete") {
      if (data.confirmCount !== ids.length) throw new AppError(`Type ${ids.length} to confirm deleting ${ids.length} enquiries.`);
      await tx.delete(schema.enquiries).where(inArray(schema.enquiries.id, ids));
      await audit(tx, actor, "enquiry.bulk_deleted", undefined, { count: ids.length });
      return { affected: ids.length };
    }
    for (const id of ids) {
      if (data.action === "status") await applyPatch(tx, actor, id, { statusKey: data.statusKey });
      if (data.action === "assign") await applyPatch(tx, actor, id, { assignedUserId: data.assignedUserId });
      if (data.action === "priority") await applyPatch(tx, actor, id, { priority: data.priority });
    }
    await audit(tx, actor, `enquiry.bulk_${data.action}`, undefined, { count: ids.length });
    return { affected: ids.length };
  });
}

// ------------------------------------------------------------ CSV

export const IMPORT_FIELDS = ["name", "email", "phone", "company", "subject", "message", "source", "category", "priority", "created_at"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const IMPORT_MAX_ROWS = 2000;

const HEADER_GUESSES: Record<ImportField, RegExp> = {
  name: /^(full ?name|name|customer|contact)$/i,
  email: /^(e-?mail|email address)$/i,
  phone: /^(phone|mobile|tel|telephone|phone number)$/i,
  company: /^(company|organisation|organization|business)$/i,
  subject: /^(subject|title|enquiry|job|service)$/i,
  message: /^(message|details|description|notes|comments)$/i,
  source: /^(source|channel|lead source)$/i,
  category: /^(category|type)$/i,
  priority: /^priority$/i,
  created_at: /^(date|created|created at|received)$/i,
};

export function guessMapping(headers: string[]): Partial<Record<ImportField, number>> {
  const map: Partial<Record<ImportField, number>> = {};
  headers.forEach((h, i) => {
    for (const f of IMPORT_FIELDS) if (map[f] === undefined && HEADER_GUESSES[f].test(h.trim())) map[f] = i;
  });
  return map;
}

export interface ImportPreview {
  headers: string[];
  mapping: Partial<Record<ImportField, number>>;
  valid: number;
  errors: { row: number; message: string }[];
  sample: Record<string, string>[];
}

function rowToInput(row: string[], mapping: Partial<Record<ImportField, number>>): EnquiryInput {
  const get = (f: ImportField) => (mapping[f] !== undefined ? (row[mapping[f]!] ?? "").trim() : "");
  const priority = get("priority").toLowerCase();
  return {
    contact: { name: get("name") || get("email") || "Unknown", email: get("email"), phone: get("phone"), company: get("company") },
    subject: get("subject") || "Imported enquiry",
    message: get("message"),
    source: get("source") || "csv_import",
    category: get("category"),
    priority: (PRIORITIES as readonly string[]).includes(priority) ? (priority as (typeof PRIORITIES)[number]) : "normal",
  };
}

export function previewImport(csvText: string, mapping?: Partial<Record<ImportField, number>>): ImportPreview {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new AppError("The file needs a header row and at least one data row.");
  if (rows.length - 1 > IMPORT_MAX_ROWS) throw new AppError(`Import up to ${IMPORT_MAX_ROWS} rows at a time.`);
  const headers = rows[0];
  const map = mapping ?? guessMapping(headers);
  if (map.email === undefined && map.phone === undefined) throw new AppError("Map at least an email or phone column.");
  const errors: ImportPreview["errors"] = [];
  let valid = 0;
  rows.slice(1).forEach((r, i) => {
    const parsed = enquiryInputSchema.safeParse(rowToInput(r, map));
    if (!parsed.success) errors.push({ row: i + 2, message: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
    else if (!parsed.data.contact.email && !parsed.data.contact.phone) errors.push({ row: i + 2, message: "No email or phone" });
    else valid++;
  });
  const sample = rows.slice(1, 6).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  return { headers, mapping: map, valid, errors: errors.slice(0, 50), sample };
}

/**
 * Import enquiries. Automation is OFF by default: emailing a list of old leads
 * the moment they're uploaded is exactly the kind of mistake to prevent.
 * Existing contacts are matched, never overwritten.
 */
export async function importEnquiries(actor: Actor, csvText: string, mapping: Partial<Record<ImportField, number>>, opts: { runAutomation?: boolean } = {}) {
  assertCan(actor, "enquiry.import");
  const rows = parseCsv(csvText).slice(1);
  if (rows.length > IMPORT_MAX_ROWS) throw new AppError(`Import up to ${IMPORT_MAX_ROWS} rows at a time.`);
  return withTenant(actor, async (tx) => {
    await assertFeature(tx, actor.orgId, "csvImport", "CSV import");
    let created = 0;
    let matchedContacts = 0;
    let conflicts = 0;
    const errors: { row: number; message: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const input = rowToInput(rows[i], mapping);
      const ok = enquiryInputSchema.safeParse(input);
      if (!ok.success || (!ok.data.contact.email && !ok.data.contact.phone)) {
        errors.push({ row: i + 2, message: ok.success ? "No email or phone" : ok.error.issues[0].message });
        continue;
      }
      const r = await createEnquiryTx(tx, actor.orgId, actor.userId, input, { runAutomation: opts.runAutomation === true });
      created++;
      if (r.contactMatched) matchedContacts++;
      if (r.conflicts.length) conflicts++;
    }
    await audit(tx, actor, "enquiry.imported", undefined, { created, skipped: errors.length, automation: opts.runAutomation === true });
    return { created, matchedContacts, conflicts, errors: errors.slice(0, 50) };
  });
}

export async function exportEnquiriesCsv(actor: Actor): Promise<string> {
  assertCan(actor, "enquiry.export");
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({
        id: schema.enquiries.id,
        createdAt: schema.enquiries.createdAt,
        name: schema.contacts.name,
        email: schema.contacts.email,
        phone: schema.contacts.phone,
        company: schema.contacts.company,
        subject: schema.enquiries.subject,
        message: schema.enquiries.message,
        source: schema.enquiries.source,
        category: schema.enquiries.category,
        priority: schema.enquiries.priority,
        status: schema.enquiries.statusKey,
        nextFollowUpAt: schema.enquiries.nextFollowUpAt,
        closedAt: schema.enquiries.closedAt,
      })
      .from(schema.enquiries)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.enquiries.contactId))
      .orderBy(desc(schema.enquiries.createdAt));
    await audit(tx, actor, "enquiry.exported", undefined, { count: rows.length });
    const header = ["id", "created_at", "name", "email", "phone", "company", "subject", "message", "source", "category", "priority", "status", "next_follow_up_at", "closed_at"];
    return toCsv([
      header,
      ...rows.map((r) => [r.id, r.createdAt.toISOString(), r.name, r.email, r.phone, r.company, r.subject, r.message, r.source, r.category, r.priority, r.status, r.nextFollowUpAt?.toISOString(), r.closedAt?.toISOString()]),
    ]);
  });
}
