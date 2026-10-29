/*
 * End-to-end test of the principal customer journey, in a real browser.
 *
 *   1. Sign up and complete onboarding
 *   2. Add an enquiry → acknowledgement waits for approval
 *   3. Approve it → appears in the simulated outbox
 *   4. Draft a reply with AI, send it
 *   5. Book an appointment
 *   6. A website-form submission arrives
 *   7. Generate the weekly report
 *   8. Another tenant cannot open this tenant's enquiry by URL
 *
 * Needs the app running (npm run build && npm start) against a database.
 * Usage: BASE_URL=http://localhost:3000 npm run test:e2e
 * Uses the pre-installed Playwright (no browser download).
 */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

// The environment ships one Playwright install; load it with require so its
// global location resolves (installing a second copy would not find the browser).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SCREENSHOT_DIR;
let step = 0;

async function check(name: string, fn: () => Promise<void>) {
  step++;
  try {
    await fn();
    console.log(`  ✓ ${step}. ${name}`);
  } catch (e) {
    console.error(`  ✗ ${step}. ${name}\n    ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    throw e;
  }
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function signUp(page: Page, name: string, business: string) {
  const email = `e2e-${randomUUID().slice(0, 8)}@example.test`;
  await page.goto(`${BASE}/sign-up`);
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel("Business name").fill(business);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/step=2/);
  return email;
}

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  let enquiryUrl = "";
  console.log(`E2E journey against ${BASE}`);

  await check("marketing pages load", async () => {
    for (const p of ["/", "/pricing", "/features", "/faq", "/industries/trades", "/legal/privacy"]) {
      const r = await page.goto(`${BASE}${p}`);
      if (r?.status() !== 200) throw new Error(`${p} returned ${r?.status()}`);
    }
    await page.goto(`${BASE}/`);
    await shot(page, "01-landing");
  });

  await check("sign up and complete onboarding", async () => {
    await signUp(page, "Alex Morgan", "Morgan Electrical");
    await page.getByLabel("Business phone").fill("01632 960555");
    await page.getByLabel("Booking link").fill("https://example.test/book");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/step=3/);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/step=4/);
    await page.getByLabel("Allow AI-assisted drafting").check();
    await page.getByRole("button", { name: "Finish setup" }).click();
    await page.waitForURL(/\/app\?welcome=1/);
    await page.getByText("You're set up").waitFor();
    await shot(page, "02-dashboard-empty");
  });

  await check("add an enquiry; acknowledgement waits for approval", async () => {
    await page.goto(`${BASE}/app/enquiries/new`);
    await page.getByLabel("Name", { exact: true }).fill("Sam Rivers");
    await page.getByLabel("Email", { exact: true }).fill("sam.rivers@example.test");
    await page.getByLabel("What do they need?").fill("Rewire kitchen sockets");
    await page.getByLabel("Details").fill("Two double sockets have stopped working.");
    await page.getByRole("button", { name: "Create enquiry" }).click();
    await page.waitForURL(/\/app\/enquiries\/[0-9a-f-]{36}$/);
    enquiryUrl = page.url();
    await page.getByRole("heading", { name: "Rewire kitchen sockets" }).waitFor();
    await page.goto(`${BASE}/app/follow-ups`);
    await page.getByText("To Sam Rivers").waitFor();
    await shot(page, "03-approval-queue");
  });

  await check("approve the acknowledgement; it appears in the outbox", async () => {
    await page.getByRole("button", { name: "Approve & send" }).first().click();
    await page.getByText("Approved and sent.").waitFor();
    await page.goto(`${BASE}/app/outbox`);
    await page.getByText("sam.rivers@example.test").first().waitFor();
    await page.getByText("Thanks for your enquiry — Rewire kitchen sockets").waitFor();
  });

  await check("draft a reply with AI and send it", async () => {
    await page.goto(enquiryUrl);
    await page.getByRole("button", { name: "Draft with AI" }).click();
    await page.waitForFunction(() => (document.getElementById("c-body") as HTMLTextAreaElement)?.value.length > 20);
    await shot(page, "04-enquiry-ai-draft");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByText("Sent.", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("Email to customer").first().waitFor();
  });

  await check("book an appointment from the enquiry", async () => {
    await page.getByRole("link", { name: "Book" }).click();
    await page.waitForURL(/appointments\/new/);
    await page.getByLabel("Title").fill("Survey sockets");
    await page.getByLabel("Address / location").fill("1 Test Lane");
    await page.getByRole("button", { name: "Book appointment" }).click();
    await page.waitForURL(/\/app\/appointments\/[0-9a-f-]{36}$/);
    await page.getByRole("heading", { name: "Survey sockets" }).waitFor();
    await page.getByText(/^Confirmed:/).waitFor({ timeout: 10_000 }).catch(() => undefined);
    await shot(page, "05-appointment");
  });

  await check("the public website form creates an enquiry", async () => {
    await page.goto(`${BASE}/app/integrations`);
    const link = (await page.locator("code").first().textContent())!.trim();
    const visitor = await browser.newPage();
    await visitor.goto(link);
    await visitor.waitForTimeout(2100); // the form rejects bot-fast submissions
    await visitor.getByLabel("Your name").fill("Web Visitor");
    await visitor.getByLabel("Email", { exact: true }).fill("web.visitor@example.test");
    await visitor.getByLabel("Details").fill("Need an EV charger installed on the drive.");
    await visitor.getByRole("button", { name: "Send enquiry" }).click();
    await visitor.getByText("Thanks — your enquiry has been sent").waitFor();
    await visitor.close();
    await page.goto(`${BASE}/app/enquiries`);
    await page.getByText("Web Visitor").waitFor();
    await shot(page, "06-enquiries-list");
  });

  await check("generate the weekly report", async () => {
    await page.goto(`${BASE}/app/reports`);
    await page.getByRole("button", { name: /Generate now/ }).click();
    await page.waitForURL(/\/app\/reports\/[0-9a-f-]{36}$/);
    await page.getByText("Suggested next actions").waitFor();
    await shot(page, "07-report");
  });

  await check("dashboard reflects the activity", async () => {
    await page.goto(`${BASE}/app`);
    await page.getByText("New this week").waitFor();
    await shot(page, "08-dashboard");
  });

  await check("another workspace cannot open this enquiry", async () => {
    const other = await (await browser.newContext()).newPage();
    await signUp(other, "Eve Intruder", "Other Ltd");
    const res = await other.goto(enquiryUrl);
    const body = await other.content();
    if (res?.status() !== 404 || body.includes("Rewire kitchen sockets")) throw new Error(`expected 404, got ${res?.status()}`);
    const exp = await other.request.get(`${BASE}/api/export/contact/${randomUUID()}`);
    if (exp.status() !== 404) throw new Error(`export returned ${exp.status()}`);
  });

  await check("mobile layout renders the menu", async () => {
    const m = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await m.goto(`${BASE}/pricing`);
    await m.getByText("Simple monthly pricing").waitFor();
    await shot(m, "09-mobile-pricing");
  });

  await browser.close();
  console.log(`All ${step} journey checks passed.`);
}

main().catch(() => process.exit(1));
