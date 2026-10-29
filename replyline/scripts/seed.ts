import { eq, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { closeDb, schema, systemDb } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { createOrganization } from "@/modules/orgs/service";
import { createEnquiry, updateEnquiry } from "@/modules/enquiries/service";
import { createAppointment } from "@/modules/appointments/service";
import { composeMessage, logCustomerReply } from "@/modules/email/messages";
import { generateWeeklyReport } from "@/modules/reports/service";
import { runDueJobs } from "@/worker/process";
import type { Actor } from "@/modules/auth/permissions";

/*
 * Fictional demo data: one plumbing business with a realistic week of
 * enquiries. Every name, email and phone number is invented; email addresses
 * use the reserved .test domain and phone numbers the Ofcom drama range.
 *
 *   npm run db:seed        (safe to re-run: it replaces the demo workspace)
 */

const DEMO_EMAIL = "demo@replyline.test";
const DEMO_PASSWORD = "demo-password-123";

const PEOPLE = [
  ["Priya Shah", "Leaking radiator valve in back bedroom", "Website form", "Repair", "The valve on the radiator in our back bedroom is dripping onto the carpet. Could someone come and look this week?"],
  ["Tom Hughes", "Bathroom refit quote", "Checkatrade", "Quote request", "Looking for a quote to replace bath with walk-in shower. Room is about 2m x 2.5m. Flexible on dates."],
  ["Ellie Ward", "Annual boiler service", "Phone", "Maintenance", "Worcester combi, last serviced Nov last year."],
  ["Marcus Lee", "Outside tap installation", "Website form", "Installation", "Want an outside tap on the back wall near the kitchen."],
  ["Hannah Okafor", "No hot water", "Phone", "Emergency call-out", "Boiler showing F28 fault, no hot water since this morning."],
  ["David Chen", "Kitchen sink blocked", "Facebook", "Repair", "Sink draining really slowly, tried plunger already."],
  ["Sophie Turner", "Radiator replacement x3", "Referral", "Installation", "Recommended by my neighbour at no. 14. Three old radiators to replace with modern ones."],
  ["James Wilson", "Low water pressure upstairs", "Website form", "Repair", "Pressure in the upstairs shower has dropped a lot over the last month."],
  ["Aisha Begum", "New boiler quote", "Checkatrade", "Quote request", "Our boiler is 18 years old. Would like options for a replacement."],
  ["Oliver Grant", "Toilet keeps running", "Website form", "Repair", "Cistern keeps refilling every few minutes."],
  ["Chloe Martin", "Power flush", "Email", "Maintenance", "Radiators cold at the bottom, been told we need a power flush."],
  ["Ryan Patel", "Leak under bath", "Phone", "Emergency call-out", "Water coming through kitchen ceiling below bathroom."],
] as const;

async function main() {
  const db = systemDb();
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, DEMO_EMAIL) });
  if (existing) {
    const orgs = await db.select({ id: schema.memberships.orgId }).from(schema.memberships).where(eq(schema.memberships.userId, existing.id));
    for (const o of orgs) await db.delete(schema.organizations).where(eq(schema.organizations.id, o.id));
    await db.delete(schema.users).where(eq(schema.users.id, existing.id));
  }
  await db.delete(schema.users).where(sql`${schema.users.email} like '%@hughesplumbing.test'`);

  const [owner] = await db.insert(schema.users).values({ name: "Gareth Hughes", email: DEMO_EMAIL, passwordHash: await hashPassword(DEMO_PASSWORD) }).returning();
  const [colleague] = await db.insert(schema.users).values({ name: "Megan Price", email: "megan@hughesplumbing.test", passwordHash: await hashPassword(`unused-${Date.now()}`) }).returning();

  const orgId = await createOrganization(owner.id, { name: "Hughes Plumbing & Heating", industry: "trades", timezone: "Europe/London" });
  await db
    .update(schema.organizations)
    .set({
      phone: "01632 960 418",
      email: "office@hughesplumbing.test",
      website: "https://hughesplumbing.test",
      bookingLink: "https://hughesplumbing.test/book",
      emailSignature: "Best wishes,\nGareth Hughes\nHughes Plumbing & Heating\n01632 960 418",
      onboardingCompletedAt: new Date(),
      createdAt: DateTime.now().minus({ weeks: 6 }).toJSDate(),
    })
    .where(eq(schema.organizations.id, orgId));
  await db.insert(schema.memberships).values({ orgId, userId: colleague.id, role: "member" });
  // Demo convenience: acknowledgements and reminders send automatically (simulated provider).
  await db.update(schema.workflows).set({ requireApproval: false }).where(sql`${schema.workflows.orgId} = ${orgId} and ${schema.workflows.templateKey} in ('new_enquiry_ack','appointment_reminder')`);

  const actor: Actor = { orgId, userId: owner.id, role: "owner" };
  const ids: string[] = [];
  for (const [i, [name, subject, source, category, message]] of PEOPLE.entries()) {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, ".");
    const r = await createEnquiry(actor, {
      contact: { name, email: `${slug}@example.test`, phone: `07700 900${String(100 + i).padStart(3, "0")}` },
      subject,
      message,
      source,
      category,
      priority: category === "Emergency call-out" ? "urgent" : "normal",
      assignedUserId: i % 3 === 2 ? colleague.id : owner.id,
      marketingConsent: i % 4 === 0,
    });
    ids.push(r.id);
    // Spread creation over the last few weeks so charts and reports have shape.
    const daysAgo = [0, 1, 1, 2, 3, 4, 6, 9, 12, 16, 20, 27][i];
    const at = DateTime.now().minus({ days: daysAgo, hours: i }).toJSDate();
    await db.update(schema.enquiries).set({ createdAt: at, updatedAt: at }).where(eq(schema.enquiries.id, r.id));
    await db.update(schema.workflowRuns).set({ startedAt: at }).where(eq(schema.workflowRuns.enquiryId, r.id));
  }
  await runDueJobs(200);

  // A realistic mix of states.
  await composeMessage(actor, ids[1], { subject: "Re: Bathroom refit quote", body: "Hi Tom,\n\nThanks for the details. We'd like to pop round to measure up — would Thursday afternoon suit?\n\nBest wishes,\nGareth", action: "send" });
  await logCustomerReply(actor, ids[1], { body: "Thursday after 2pm is perfect, thanks." });
  await createAppointment(actor, { contactId: (await contactOf(ids[1]))!, enquiryId: ids[1], title: "Measure up for bathroom refit", date: DateTime.now().setZone("Europe/London").plus({ days: 2 }).toISODate()!, time: "14:30", timezone: "Europe/London", durationMinutes: 45, location: "14 Example Close, Cardiff", reminderOffsetsMinutes: [1440] });
  await createAppointment(actor, { contactId: (await contactOf(ids[2]))!, enquiryId: ids[2], title: "Annual boiler service", date: DateTime.now().setZone("Europe/London").plus({ days: 4 }).toISODate()!, time: "09:00", timezone: "Europe/London", durationMinutes: 60, location: "3 Sample Street, Cardiff", reminderOffsetsMinutes: [1440] });
  await updateEnquiry(actor, ids[3], { statusKey: "won" });
  await updateEnquiry(actor, ids[9], { statusKey: "lost" });
  await composeMessage(actor, ids[7], { subject: "Re: Low water pressure upstairs", body: "Hi James,\n\nCould you check whether the pressure is low on the cold tap upstairs too, or only the shower?\n\nThanks,\nGareth", action: "send" });
  await db.update(schema.enquiries).set({ lastOutboundAt: DateTime.now().minus({ days: 9 }).toJSDate() }).where(eq(schema.enquiries.id, ids[7]));
  await db.update(schema.enquiries).set({ nextFollowUpAt: DateTime.now().minus({ days: 1 }).toJSDate() }).where(eq(schema.enquiries.id, ids[8]));
  await runDueJobs(200);
  await generateWeeklyReport(orgId, new Date());

  console.log(`Seeded demo workspace "Hughes Plumbing & Heating".\nSign in: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  await closeDb();
}

async function contactOf(enquiryId: string) {
  const e = await systemDb().query.enquiries.findFirst({ where: eq(schema.enquiries.id, enquiryId), columns: { contactId: true } });
  return e?.contactId;
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
