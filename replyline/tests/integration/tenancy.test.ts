import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, db, schema, systemDb, withTenant } from "@/lib/db";
import { TENANT_TABLES } from "@/lib/db/schema";
import { signIn, resolveSession, listUserOrgs, setActiveOrg } from "@/modules/auth/service";
import { createEnquiry, getEnquiry, listEnquiries, updateEnquiry, bulkUpdate } from "@/modules/enquiries/service";
import { getContact } from "@/modules/contacts/service";
import { approveMessage, composeMessage } from "@/modules/email/messages";
import { retryJob } from "@/modules/automation/queue";
import { AppError } from "@/lib/errors";
import { makeWorkspace, runNow } from "../helpers";

afterAll(closeDb);

describe("authentication", () => {
  it("signs in with the right password only, with a generic error", async () => {
    const a = await makeWorkspace();
    const ok = await signIn(a.email, "correct horse battery", "ip-auth-1");
    expect((await resolveSession(ok.token))?.user.id).toBe(a.userId);
    await expect(signIn(a.email, "wrong password!!", "ip-auth-1")).rejects.toThrow("Email or password is incorrect.");
    await expect(signIn("nobody@example.test", "whatever123", "ip-auth-1")).rejects.toThrow("Email or password is incorrect.");
  });

  it("rate-limits repeated failed sign-ins for one address", async () => {
    const a = await makeWorkspace();
    for (let i = 0; i < 10; i++) await signIn(a.email, "nope-nope-nope", `ip-rl-${i}`).catch(() => {});
    await expect(signIn(a.email, "correct horse battery", "ip-rl-x")).rejects.toThrow(/Too many attempts/);
  });

  it("stores only a hash of the session token", async () => {
    const a = await makeWorkspace();
    const { token } = await signIn(a.email, "correct horse battery", "ip-auth-2");
    const rows = await systemDb().select().from(schema.sessions).where(eq(schema.sessions.userId, a.userId));
    expect(rows.every((r) => r.tokenHash !== token)).toBe(true);
    expect(await resolveSession("forged-token")).toBeNull();
  });

  it("won't switch a session into a workspace the user doesn't belong to", async () => {
    const a = await makeWorkspace();
    const b = await makeWorkspace();
    const { token } = await signIn(a.email, "correct horse battery", "ip-auth-3");
    const s = (await resolveSession(token))!;
    await expect(setActiveOrg(s.tokenHash, a.userId, b.orgId)).rejects.toThrow(/not a member/);
    expect((await listUserOrgs(a.userId)).map((o) => o.orgId)).toEqual([a.orgId]);
  });
});

describe("tenant isolation", () => {
  it("has row-level security enabled on every tenant table", async () => {
    const res = await systemDb().execute<{ relname: string; relrowsecurity: boolean }>(
      sql`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    );
    const rls = Object.fromEntries(res.rows.map((r) => [r.relname, r.relrowsecurity]));
    for (const t of TENANT_TABLES) expect(rls[t], t).toBe(true);
    // Every table with an org_id column must be in the list.
    const cols = await systemDb().execute<{ table_name: string }>(sql`select table_name from information_schema.columns where table_schema='public' and column_name='org_id'`);
    for (const c of cols.rows) if (c.table_name !== "billing_events") expect(TENANT_TABLES as readonly string[], c.table_name).toContain(c.table_name);
  });

  it("the database itself hides other tenants' rows from the app role", async () => {
    const a = await makeWorkspace();
    const b = await makeWorkspace();
    await createEnquiry(b.actor, { contact: { name: "Bea", email: "bea@example.test" }, subject: "B's secret job" }, { runAutomation: false });
    // A raw query with no WHERE clause, scoped to tenant A, must see none of B's rows.
    const rows = await withTenant(a.actor, (tx) => tx.select().from(schema.enquiries));
    expect(rows.some((r) => r.orgId === b.orgId)).toBe(false);
    // Outside any tenant scope the app role sees nothing at all.
    expect(await db().select().from(schema.enquiries)).toEqual([]);
    // Inserting a row for another tenant is refused by the policy.
    await expect(
      withTenant(a.actor, (tx) => tx.insert(schema.notes).values({ orgId: b.orgId, enquiryId: rows[0]?.id ?? b.orgId, body: "x" })),
    ).rejects.toThrow();
  });

  it("the app role cannot read password hashes or sessions", async () => {
    const a = await makeWorkspace();
    const cause = (p: Promise<unknown>) => p.then(() => "allowed", (e) => String(e.cause?.message ?? e.message));
    expect(await cause(withTenant(a.actor, (tx) => tx.execute(sql`select password_hash from users`)))).toMatch(/permission denied/);
    expect(await cause(withTenant(a.actor, (tx) => tx.execute(sql`select * from sessions`)))).toMatch(/permission denied/);
  });

  it("services refuse cross-tenant ids even when called directly", async () => {
    const a = await makeWorkspace();
    const b = await makeWorkspace();
    const e = await createEnquiry(b.actor, { contact: { name: "Bea", email: "bea2@example.test" }, subject: "Private" }, { runAutomation: false });
    await expect(getEnquiry(a.actor, e.id)).rejects.toThrow("Enquiry not found");
    await expect(getContact(a.actor, e.contactId)).rejects.toThrow("Contact not found");
    await expect(updateEnquiry(a.actor, e.id, { statusKey: "won" })).rejects.toThrow("Enquiry not found");
    await expect(composeMessage(a.actor, e.id, { subject: "hi", body: "hi", action: "send" })).rejects.toThrow("Enquiry not found");
    const res = await bulkUpdate(a.actor, { action: "priority", ids: [e.id], priority: "urgent" });
    expect(res.affected).toBe(0);
    expect((await listEnquiries(a.actor, { view: "all" })).rows).toHaveLength(0);
    const still = await getEnquiry(b.actor, e.id);
    expect(still.enquiry.priority).toBe("normal");
  });

  it("can't approve another tenant's message or retry their jobs", async () => {
    const a = await makeWorkspace();
    const b = await makeWorkspace();
    await createEnquiry(b.actor, { contact: { name: "Bea", email: "bea3@example.test" }, subject: "Hello" });
    await runNow();
    const [msg] = await systemDb().select().from(schema.messages).where(eq(schema.messages.orgId, b.orgId));
    expect(msg).toBeTruthy();
    await expect(approveMessage(a.actor, msg.id)).rejects.toBeInstanceOf(AppError);
    const [job] = await systemDb().select().from(schema.jobs).where(eq(schema.jobs.orgId, b.orgId)).limit(1);
    await systemDb().update(schema.jobs).set({ status: "dead" }).where(eq(schema.jobs.id, job.id));
    await expect(retryJob(a.actor, job.id)).rejects.toThrow(/isn't in the failed list/);
  });

  it("members can't do owner-only things", async () => {
    const a = await makeWorkspace();
    const member = { ...a.actor, role: "member" as const };
    await expect(bulkUpdate(member, { action: "delete", ids: [a.orgId], confirmCount: 1 })).rejects.toThrow(/permission/);
  });
});
