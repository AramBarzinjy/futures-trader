import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, schema, systemDb } from "@/lib/db";
import { createEnquiry, getEnquiry, importEnquiries, previewImport, updateEnquiry } from "@/modules/enquiries/service";
import { approveMessage, composeMessage, deliverMessage, logCustomerReply } from "@/modules/email/messages";
import { EmailProviderError, SimulatedEmailProvider } from "@/modules/email/provider";
import { claimDueJobs, enqueue, retryJob } from "@/modules/automation/queue";
import { createAppointment, rescheduleAppointment, setAppointmentStatus } from "@/modules/appointments/service";
import { testWorkflow } from "@/modules/automation/workflows";
import { withTenant } from "@/lib/db";
import { fastForward, makeWorkspace, messagesFor, runNow, setWorkflow } from "../helpers";
import { runDueJobs } from "@/worker/process";

afterAll(closeDb);
beforeEach(() => SimulatedEmailProvider.reset());

const customer = (n: string) => ({ name: `Casey ${n}`, email: `casey-${n}@example.test`, phone: "07700 900123" });

describe("enquiries", () => {
  it("creates an enquiry with a contact and a timeline entry", async () => {
    const w = await makeWorkspace();
    const e = await createEnquiry(w.actor, { contact: customer("a"), subject: "Boiler service", message: "Annual service please" }, { runAutomation: false });
    const full = await getEnquiry(w.actor, e.id);
    expect(full.enquiry.statusKey).toBe("new");
    expect(full.contact.email).toBe("casey-a@example.test");
    expect(full.activities.map((a) => a.type)).toContain("enquiry.created");
  });

  it("matches an existing contact, flags a possible duplicate and never overwrites stored details", async () => {
    const w = await makeWorkspace();
    const first = await createEnquiry(w.actor, { contact: { name: "Jo Bloggs", email: "JO@example.test" }, subject: "Gutter" }, { runAutomation: false });
    const second = await createEnquiry(w.actor, { contact: { name: "Joanne Different", email: "jo@example.test ", phone: "07700 900999" }, subject: "Gutter again" }, { runAutomation: false });
    expect(second.contactId).toBe(first.contactId);
    expect(second.possibleDuplicateOfId).toBe(first.id);
    expect(second.conflicts.map((c) => c.field)).toEqual(["name"]);
    const c = await systemDb().query.contacts.findFirst({ where: eq(schema.contacts.id, first.contactId) });
    expect(c!.name).toBe("Jo Bloggs"); // kept
    expect(c!.phone).toBe("07700 900999"); // empty field filled
  });

  it("imports CSV without running automation, and reports bad rows", async () => {
    const w = await makeWorkspace();
    const csv = "Name,Email,Subject\nAnn,ann@example.test,Fence\nBob,,No contact\nCat,cat@example.test,Decking\n";
    const preview = previewImport(csv);
    expect(preview.valid).toBe(2);
    expect(preview.errors[0].row).toBe(3);
    const r = await importEnquiries(w.actor, csv, preview.mapping);
    expect(r.created).toBe(2);
    expect(await messagesFor(w.orgId)).toHaveLength(0); // nobody emailed
  });
});

describe("follow-up engine", () => {
  it("acknowledges a new enquiry into the approval queue by default", async () => {
    const w = await makeWorkspace();
    await createEnquiry(w.actor, { contact: customer("b"), subject: "Leak" });
    await runNow();
    const msgs = await messagesFor(w.orgId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ templateKey: "acknowledge", status: "pending_approval" });
    expect(SimulatedEmailProvider.sent).toHaveLength(0);
    await approveMessage(w.actor, msgs[0].id);
    await runNow();
    expect(SimulatedEmailProvider.sent).toHaveLength(1);
    expect(SimulatedEmailProvider.sent[0].subject).toContain("Leak");
  });

  it("runs the sequence and stops the moment the customer replies", async () => {
    const w = await makeWorkspace();
    await setWorkflow(w.orgId, "new_enquiry_ack", { enabled: false });
    await setWorkflow(w.orgId, "no_response_escalation", { enabled: false });
    await setWorkflow(w.orgId, "follow_up_sequence", { requireApproval: false });
    const e = await createEnquiry(w.actor, { contact: customer("c"), subject: "Roof tiles" });
    expect((await getEnquiry(w.actor, e.id)).enquiry.nextFollowUpAt).not.toBeNull();
    await fastForward(1); // step 1 due → follow-up sent automatically
    expect(SimulatedEmailProvider.sent.map((m) => m.subject)).toEqual(["Following up — Roof tiles"]);
    expect(SimulatedEmailProvider.sent[0].text).toMatch(/Prefer we don't follow up\? http/);
    await logCustomerReply(w.actor, e.id, { body: "Yes please, still interested" });
    await fastForward();
    expect(SimulatedEmailProvider.sent).toHaveLength(1); // final follow-up never sent
    const after = await getEnquiry(w.actor, e.id);
    expect(after.runs[0]).toMatchObject({ status: "stopped", stopReason: "Customer replied" });
    expect(after.enquiry.statusKey).toBe("needs_response");
  });

  it("stops when the enquiry is closed or an appointment is booked", async () => {
    const w = await makeWorkspace();
    await setWorkflow(w.orgId, "follow_up_sequence", { requireApproval: false });
    const e1 = await createEnquiry(w.actor, { contact: customer("d"), subject: "Close me" });
    await updateEnquiry(w.actor, e1.id, { statusKey: "lost" });
    const e2 = await createEnquiry(w.actor, { contact: customer("e"), subject: "Book me" });
    await createAppointment(w.actor, { contactId: e2.contactId, enquiryId: e2.id, title: "Visit", date: "2031-06-02", time: "10:00", timezone: "Europe/London", durationMinutes: 60, notifyCustomer: false });
    await fastForward();
    const followUps = (await messagesFor(w.orgId)).filter((m) => m.templateKey?.startsWith("follow_up"));
    expect(followUps).toHaveLength(0);
  });

  it("never sends twice, even if the same job runs twice or a worker restarts", async () => {
    const w = await makeWorkspace();
    const e = await createEnquiry(w.actor, { contact: customer("f"), subject: "Dup test" }, { runAutomation: false });
    const msg = await composeMessage(w.actor, e.id, { subject: "Hello", body: "Hello there", action: "send" });
    // Simulate a duplicate delivery of the same send job.
    await withTenant(w.actor, (tx) => enqueue(tx, { orgId: w.orgId, type: "email.send", payload: { messageId: msg.id }, dedupeKey: `dup:${msg.id}` }));
    await runNow();
    await deliverMessage(w.orgId, msg.id, { finalAttempt: false });
    expect(SimulatedEmailProvider.sent.filter((s) => s.idempotencyKey === msg.id)).toHaveLength(1);
  });

  it("marks a send interrupted mid-flight as uncertain instead of resending", async () => {
    const w = await makeWorkspace();
    const e = await createEnquiry(w.actor, { contact: customer("g"), subject: "Crash test" }, { runAutomation: false });
    const msg = await composeMessage(w.actor, e.id, { subject: "Hi", body: "Hi", action: "send" });
    await systemDb().update(schema.messages).set({ status: "sending" }).where(eq(schema.messages.id, msg.id));
    await runNow();
    const [m] = (await messagesFor(w.orgId)).filter((x) => x.id === msg.id);
    expect(m.status).toBe("uncertain");
    expect(SimulatedEmailProvider.sent).toHaveLength(0);
  });

  it("retries transient failures with backoff, then dead-letters, and can be retried safely", async () => {
    const w = await makeWorkspace();
    const e = await createEnquiry(w.actor, { contact: customer("h"), subject: "Flaky" }, { runAutomation: false });
    const msg = await composeMessage(w.actor, e.id, { subject: "Hi", body: "Hi", action: "send" });
    SimulatedEmailProvider.failNext(new EmailProviderError("503", true), 10);
    await runNow();
    let [job] = await systemDb().select().from(schema.jobs).where(and(eq(schema.jobs.orgId, w.orgId), eq(schema.jobs.type, "email.send")));
    expect(job).toMatchObject({ status: "queued", attempts: 1 });
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000); // backed off
    await fastForward(10);
    [job] = await systemDb().select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(job.status).toBe("dead");
    expect((await messagesFor(w.orgId)).find((m) => m.id === msg.id)!.status).toBe("failed");
    // Retrying the dead job re-arms the failed message and sends it exactly once.
    SimulatedEmailProvider.reset();
    await retryJob(w.actor, job.id);
    await runNow();
    await runNow();
    expect(SimulatedEmailProvider.sent).toHaveLength(1);
  });

  it("doesn't let two workers claim the same job", async () => {
    const w = await makeWorkspace();
    await withTenant(w.actor, (tx) => enqueue(tx, { orgId: w.orgId, type: "retention.purge", payload: {}, dedupeKey: `claim-${w.orgId}` }));
    const [a, b] = await Promise.all([claimDueJobs(50, "w1"), claimDueJobs(50, "w2")]);
    const mine = [...a, ...b].filter((j) => j.orgId === w.orgId);
    expect(mine).toHaveLength(1);
    await runDueJobs();
  });

  it("blocks sending to an address that opted out", async () => {
    const w = await makeWorkspace();
    const e = await createEnquiry(w.actor, { contact: customer("i"), subject: "Opt out" }, { runAutomation: false });
    await logCustomerReply(w.actor, e.id, { body: "STOP emailing me" });
    await expect(composeMessage(w.actor, e.id, { subject: "Hi", body: "Hi", action: "send" })).rejects.toThrow(/opted out/);
  });

  it("dry-runs a workflow without creating anything", async () => {
    const w = await makeWorkspace();
    const e = await createEnquiry(w.actor, { contact: customer("j"), subject: "Dry run" }, { runAutomation: false });
    const wf = await systemDb().query.workflows.findFirst({ where: and(eq(schema.workflows.orgId, w.orgId), eq(schema.workflows.templateKey, "follow_up_sequence")) });
    const r = await testWorkflow(w.actor, wf!.id, e.id);
    expect(r.steps).toHaveLength(2);
    expect(r.steps[0].subject).toBe("Following up — Dry run");
    expect(r.steps[0].outcome).toBe("Would wait in the approval queue");
    expect(await messagesFor(w.orgId)).toHaveLength(0);
  });
});

describe("appointments", () => {
  async function setup() {
    const w = await makeWorkspace();
    await setWorkflow(w.orgId, "appointment_reminder", { requireApproval: false });
    const e = await createEnquiry(w.actor, { contact: customer("k"), subject: "Survey" }, { runAutomation: false });
    return { w, e };
  }

  it("confirms, then reminds at the scheduled offset", async () => {
    const { w, e } = await setup();
    await createAppointment(w.actor, { contactId: e.contactId, enquiryId: e.id, title: "Survey visit", date: "2031-06-02", time: "10:00", timezone: "Europe/London", durationMinutes: 60, reminderOffsetsMinutes: [1440] });
    await runNow();
    expect(SimulatedEmailProvider.sent.map((s) => s.subject)).toEqual(["Confirmed: Monday 2 June 2031 at 10:00"]);
    await fastForward();
    expect(SimulatedEmailProvider.sent.map((s) => s.subject)).toContain("Reminder: Monday 2 June 2031 at 10:00");
  });

  it("never sends a reminder with outdated details after a reschedule", async () => {
    const { w, e } = await setup();
    const a = await createAppointment(w.actor, { contactId: e.contactId, enquiryId: e.id, title: "Survey visit", date: "2031-06-02", time: "10:00", timezone: "Europe/London", durationMinutes: 60, notifyCustomer: false });
    await rescheduleAppointment(w.actor, a.id, { date: "2031-06-05", time: "14:30", notifyCustomer: false });
    await fastForward();
    const subjects = SimulatedEmailProvider.sent.map((s) => s.subject);
    expect(subjects).toEqual(["Reminder: Thursday 5 June 2031 at 14:30"]);
  });

  it("sends nothing for a cancelled appointment except the cancellation", async () => {
    const { w, e } = await setup();
    const a = await createAppointment(w.actor, { contactId: e.contactId, enquiryId: e.id, title: "Survey visit", date: "2031-06-02", time: "10:00", timezone: "Europe/London", durationMinutes: 60, notifyCustomer: false });
    await setAppointmentStatus(w.actor, a.id, "cancelled", true);
    await fastForward();
    expect(SimulatedEmailProvider.sent.map((s) => s.subject)).toEqual(["Cancelled: your appointment on Monday 2 June 2031"]);
  });

  it("holds a message for approval when a template variable is missing, even with auto-send on", async () => {
    const { w, e } = await setup();
    await systemDb().update(schema.organizations).set({ bookingLink: null }).where(eq(schema.organizations.id, w.orgId));
    const a = await createAppointment(w.actor, { contactId: e.contactId, enquiryId: e.id, title: "Survey visit", date: "2031-06-02", time: "10:00", timezone: "Europe/London", durationMinutes: 60, notifyCustomer: false });
    await setAppointmentStatus(w.actor, a.id, "cancelled", true);
    await fastForward();
    expect(SimulatedEmailProvider.sent).toHaveLength(0);
    const held = (await messagesFor(w.orgId)).find((m) => m.templateKey === "appointment_cancelled")!;
    expect(held).toMatchObject({ status: "pending_approval", reviewFlags: ["missing:booking_link"] });
  });

  it("limits reminder count by plan", async () => {
    const { w, e } = await setup();
    await systemDb().update(schema.organizations).set({ planKey: "starter", subscriptionStatus: "active" }).where(eq(schema.organizations.id, w.orgId));
    await expect(
      createAppointment(w.actor, { contactId: e.contactId, title: "x", date: "2031-06-02", time: "10:00", timezone: "Europe/London", durationMinutes: 60, reminderOffsetsMinutes: [1440, 120] }),
    ).rejects.toThrow(/allows 1 reminder/);
  });
});
