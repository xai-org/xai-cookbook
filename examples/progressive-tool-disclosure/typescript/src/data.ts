// Larkspur is a made-up company that sells booking software to fitness and wellness studios. Its
// workspace is connected to eight services, and this is what's in them. It's Tuesday, October 6,
// 2026, late in the morning: yesterday's release broke checkout for anyone using a percent-off
// coupon, and the team has spent the morning on it.

export const NOW = "2026-10-06T11:45:00-07:00";

// A time on a day relative to October 6, like at(-1, "17:40") for October 5 at 5:40 PM, Pacific Time.
function at(day: number, time: string): string {
  const date = new Date(Date.UTC(2026, 9, 6 + day));
  return `${date.toISOString().slice(0, 10)}T${time}:00-07:00`;
}

const github = {
  repos: [
    { repo: "larkspur/web", description: "Booking site and checkout for studios and their clients", language: "TypeScript", default_branch: "main", open_issues: 3, open_pull_requests: 2, updated_at: at(0, "10:52") },
    { repo: "larkspur/api", description: "API, billing, and Stripe webhooks", language: "TypeScript", default_branch: "main", open_issues: 1, open_pull_requests: 0, updated_at: at(-1, "15:20") },
    { repo: "larkspur/infra", description: "Terraform and deploy pipelines", language: "HCL", default_branch: "main", open_issues: 0, open_pull_requests: 1, updated_at: at(0, "09:12") },
  ],
  branches: [
    { repo: "larkspur/web", name: "main", last_commit: "a1c9e3f", protected: true },
    { repo: "larkspur/web", name: "fix/percent-coupons", last_commit: "7d41b2c", protected: false },
    { repo: "larkspur/web", name: "chore/node-22", last_commit: "c0f3e17", protected: false },
    { repo: "larkspur/api", name: "main", last_commit: "9b2e4d0", protected: true },
    { repo: "larkspur/infra", name: "checkout-error-alert", last_commit: "41aa9d2", protected: false },
  ],
  commits: [
    { repo: "larkspur/web", branch: "fix/percent-coupons", sha: "7d41b2c", author: "priya-patel", date: at(0, "10:03"), message: "Handle percent-off coupons in applyCoupon" },
    { repo: "larkspur/web", branch: "main", sha: "a1c9e3f", author: "jonas-weber", date: at(-1, "17:35"), message: "Release web@2.31.0" },
    { repo: "larkspur/web", branch: "main", sha: "5e88a01", author: "leo-martins", date: at(-1, "14:12"), message: "Add waitlist emails (#317)" },
    { repo: "larkspur/web", branch: "main", sha: "e3b7c19", author: "leo-martins", date: at(-2, "16:47"), message: "Show coupon savings at checkout (#314)" },
    { repo: "larkspur/web", branch: "chore/node-22", sha: "c0f3e17", author: "daniel-kim", date: at(-2, "09:28"), message: "Upgrade to Node 22" },
    { repo: "larkspur/api", branch: "main", sha: "9b2e4d0", author: "priya-patel", date: at(-1, "15:20"), message: "Log slow Stripe webhooks" },
  ],
  files: [
    {
      repo: "larkspur/web",
      path: "src/checkout/applyCoupon.ts",
      content: "import type { Coupon, Price } from './types';\n\n// The price after a coupon, in cents.\nexport function applyCoupon(price: Price, coupon: Coupon): number {\n  return price.amount - coupon.amount_off.amount;\n}\n",
    },
    {
      repo: "larkspur/web",
      path: "src/checkout/CheckoutForm.tsx",
      content: "export function CheckoutForm({ plan, coupon }: Props) {\n  const total = coupon ? applyCoupon(plan.price, coupon) : plan.price.amount;\n  // Shows the savings next to the total since #314.\n  return <Form total={total} savings={plan.price.amount - total} onSubmit={pay} />;\n}\n",
    },
    { repo: "larkspur/api", path: "src/webhooks/stripe.ts", content: "export async function handleStripeWebhook(event: Stripe.Event) {\n  const started = Date.now();\n  await process(event);\n  if (Date.now() - started > 10_000) log.warn('Stripe webhook took longer than 10s');\n}\n" },
  ],
  issues: [
    {
      repo: "larkspur/web",
      number: 412,
      title: "Checkout page goes blank after entering a coupon",
      state: "open",
      author: "harbor-yoga",
      labels: ["bug"],
      assignee: null,
      created_at: at(0, "09:41"),
      body: "We entered FALL25 when upgrading and the page went blank. Tried twice.",
      comments: [{ author: "sam-okafor", created_at: at(0, "10:20"), body: "Thanks for reporting! It's a known problem, and a fix is on the way." }],
    },
    { repo: "larkspur/web", number: 409, title: "Calendar export misses recurring classes", state: "open", author: "pineandco", labels: ["bug", "calendar"], assignee: "leo-martins", created_at: at(-8, "13:05"), body: "Recurring classes don't show up in the iCal export.", comments: [] },
    { repo: "larkspur/web", number: 401, title: "Dark mode for the booking widget", state: "open", author: "acmefitness", labels: ["enhancement"], assignee: null, created_at: at(-21, "10:40"), body: "Our site is dark, and the widget is very white.", comments: [] },
    { repo: "larkspur/api", number: 88, title: "Webhook retries can create duplicate bookings", state: "open", author: "daniel-kim", labels: ["bug"], assignee: "priya-patel", created_at: at(-5, "11:15"), body: "If a booking webhook times out, the retry books the class again.", comments: [] },
  ],
  pulls: [
    {
      repo: "larkspur/web",
      number: 318,
      title: "Fix checkout crash for percent-off coupons",
      state: "open",
      draft: false,
      author: "priya-patel",
      head: "fix/percent-coupons",
      base: "main",
      created_at: at(0, "10:05"),
      updated_at: at(0, "10:52"),
      labels: ["bug", "checkout"],
      body: "Fixes ENG-142 and Sentry LARKSPUR-WEB-3F2. Percent-off coupons like FALL25 have no amount_off, so applyCoupon read amount_off.amount from undefined. Now it handles both kinds of coupon, with tests for each.",
      requested_reviewers: ["leo-martins"],
      mergeable: true,
      additions: 42,
      deletions: 7,
      files: [
        { filename: "src/checkout/applyCoupon.ts", additions: 18, deletions: 7 },
        { filename: "src/checkout/applyCoupon.test.ts", additions: 23, deletions: 0 },
        { filename: "CHANGELOG.md", additions: 1, deletions: 0 },
      ],
      checks: {
        state: "success",
        runs: [
          { name: "CI / test", conclusion: "success", completed_at: at(0, "10:14") },
          { name: "CI / lint", conclusion: "success", completed_at: at(0, "10:11") },
          { name: "Preview deploy", conclusion: "success", completed_at: at(0, "10:16") },
        ],
      },
      reviews: [{ user: "leo-martins", state: "COMMENTED", submitted_at: at(0, "10:48"), body: "Looks right. Can we add a test for a 100% off coupon before merging?" }],
      comments: [{ user: "priya-patel", created_at: at(0, "10:52"), body: "Good call, adding it now." }],
      diff: "--- a/src/checkout/applyCoupon.ts\n+++ b/src/checkout/applyCoupon.ts\n-  return price.amount - coupon.amount_off.amount;\n+  if (coupon.percent_off) return Math.round(price.amount * (1 - coupon.percent_off / 100));\n+  return price.amount - (coupon.amount_off?.amount ?? 0);\n",
    },
    { repo: "larkspur/web", number: 317, title: "Add waitlist emails", state: "merged", draft: false, author: "leo-martins", head: "waitlist-emails", base: "main", created_at: at(-3, "11:00"), updated_at: at(-1, "14:12"), labels: ["feature"], body: "Emails clients when a spot opens up in a full class.", requested_reviewers: [], mergeable: false, additions: 310, deletions: 12, files: [], checks: { state: "success", runs: [] }, reviews: [{ user: "priya-patel", state: "APPROVED", submitted_at: at(-1, "13:50"), body: "" }], comments: [], diff: "" },
    { repo: "larkspur/web", number: 316, title: "Upgrade to Node 22", state: "open", draft: true, author: "daniel-kim", head: "chore/node-22", base: "main", created_at: at(-2, "09:30"), updated_at: at(-2, "09:30"), labels: ["chore"], body: "Three date-format tests fail on Node 22.", requested_reviewers: [], mergeable: true, additions: 24, deletions: 19, files: [], checks: { state: "failure", runs: [{ name: "CI / test", conclusion: "failure", completed_at: at(-2, "09:39") }] }, reviews: [], comments: [], diff: "" },
    { repo: "larkspur/web", number: 314, title: "Show coupon savings at checkout", state: "merged", draft: false, author: "leo-martins", head: "coupon-savings", base: "main", created_at: at(-4, "10:20"), updated_at: at(-2, "16:47"), labels: ["feature", "checkout"], body: "Shows how much a coupon saves next to the total, before payment. Part of Checkout v2.", requested_reviewers: [], mergeable: false, additions: 96, deletions: 14, files: [], checks: { state: "success", runs: [] }, reviews: [{ user: "jonas-weber", state: "APPROVED", submitted_at: at(-2, "16:30"), body: "Tested with WELCOME10, works great." }], comments: [], diff: "" },
    { repo: "larkspur/infra", number: 57, title: "Alert when checkout errors pass 1%", state: "open", draft: false, author: "daniel-kim", head: "checkout-error-alert", base: "main", created_at: at(0, "09:12"), updated_at: at(0, "09:12"), labels: ["monitoring"], body: "Pages on-call when more than 1% of checkouts fail in 10 minutes.", requested_reviewers: ["maya-chen"], mergeable: true, additions: 38, deletions: 0, files: [], checks: { state: "success", runs: [] }, reviews: [], comments: [], diff: "" },
  ],
  workflows: [
    { repo: "larkspur/web", name: "CI", file: ".github/workflows/ci.yml" },
    { repo: "larkspur/web", name: "Deploy", file: ".github/workflows/deploy.yml" },
    { repo: "larkspur/api", name: "CI", file: ".github/workflows/ci.yml" },
  ],
  runs: [
    { repo: "larkspur/web", run_id: 2291, workflow: "CI", branch: "fix/percent-coupons", event: "pull_request", status: "completed", conclusion: "success", created_at: at(0, "10:06"), duration: "8m 12s", logs: "214 tests passed. Lint passed." },
    { repo: "larkspur/web", run_id: 2288, workflow: "Deploy", branch: "main", event: "push", status: "completed", conclusion: "success", created_at: at(-1, "17:36"), duration: "4m 03s", logs: "Deployed web@2.31.0 to production at 17:40." },
    { repo: "larkspur/web", run_id: 2285, workflow: "CI", branch: "chore/node-22", event: "pull_request", status: "completed", conclusion: "failure", created_at: at(-2, "09:31"), duration: "7m 48s", logs: "3 tests failed: Intl.DateTimeFormat output changed in Node 22." },
  ],
  releases: [
    { repo: "larkspur/web", tag: "web@2.31.0", name: "web 2.31.0", author: "jonas-weber", published_at: at(-1, "17:40"), body: "Coupon savings at checkout (#314). Waitlist emails (#317)." },
    { repo: "larkspur/web", tag: "web@2.30.2", name: "web 2.30.2", author: "jonas-weber", published_at: at(-7, "16:05"), body: "Fixes calendar time zones." },
    { repo: "larkspur/api", tag: "api@1.48.1", name: "api 1.48.1", author: "priya-patel", published_at: at(-1, "15:30"), body: "Logs slow Stripe webhooks." },
  ],
  notifications: [
    { repo: "larkspur/infra", reason: "review_requested", type: "PullRequest", subject: "Alert when checkout errors pass 1% (#57)", unread: true, updated_at: at(0, "09:12") },
    { repo: "larkspur/web", reason: "subscribed", type: "PullRequest", subject: "Fix checkout crash for percent-off coupons (#318)", unread: true, updated_at: at(0, "10:52") },
  ],
  dependabot: [{ repo: "larkspur/api", package: "undici", severity: "moderate", state: "open", summary: "Unbounded memory use when decompressing responses", created_at: at(-4, "02:00") }],
  code_scanning: [],
  secret_scanning: [],
};

const slack = {
  channels: [
    { channel: "incidents", topic: "Production incidents. One thread per incident.", member_count: 6, members: ["Maya Chen", "Priya Patel", "Daniel Kim", "Jonas Weber", "Sam Okafor", "Leo Martins"] },
    { channel: "eng", topic: "Engineering", member_count: 5, members: ["Maya Chen", "Priya Patel", "Leo Martins", "Daniel Kim", "Jonas Weber"] },
    { channel: "support", topic: "Customer questions and escalations", member_count: 4, members: ["Sam Okafor", "Maya Chen", "Jonas Weber", "Priya Patel"] },
    { channel: "releases", topic: "Release notes from the deploy bot", member_count: 7, members: ["Maya Chen", "Priya Patel", "Leo Martins", "Daniel Kim", "Jonas Weber", "Sam Okafor", "Ava Rossi"] },
    { channel: "general", topic: "Everyone at Larkspur", member_count: 7, members: ["Maya Chen", "Priya Patel", "Leo Martins", "Daniel Kim", "Jonas Weber", "Sam Okafor", "Ava Rossi"] },
  ],
  users: [
    { name: "Maya Chen", title: "Engineering Manager", email: "maya@larkspur.example", time_zone: "Pacific Time", status: "" },
    { name: "Priya Patel", title: "Backend Engineer", email: "priya@larkspur.example", time_zone: "Pacific Time", status: "Fixing checkout" },
    { name: "Leo Martins", title: "Frontend Engineer", email: "leo@larkspur.example", time_zone: "Eastern Time", status: "" },
    { name: "Daniel Kim", title: "Site Reliability Engineer", email: "daniel@larkspur.example", time_zone: "Pacific Time", status: "On call" },
    { name: "Jonas Weber", title: "CTO", email: "jonas@larkspur.example", time_zone: "Pacific Time", status: "" },
    { name: "Sam Okafor", title: "Support Lead", email: "sam@larkspur.example", time_zone: "Central Time", status: "" },
    { name: "Ava Rossi", title: "Product Designer", email: "ava@larkspur.example", time_zone: "Pacific Time", status: "Out Friday" },
  ],
  messages: [
    { message_id: "m01", channel: "releases", user: "Deploy bot", time: at(-1, "17:41"), text: "web@2.31.0 is live: coupon savings at checkout (#314), waitlist emails (#317)." },
    { message_id: "m02", channel: "incidents", user: "Daniel Kim", time: at(0, "08:20"), text: "Checkout errors jumped after yesterday's release. Sentry LARKSPUR-WEB-3F2, about 30 errors in 10 minutes. Looks like coupons.", reply_count: 6, reactions: [{ emoji: "eyes", people: ["Priya Patel", "Maya Chen"] }], pinned: true },
    { message_id: "m03", channel: "incidents", thread_id: "m02", user: "Priya Patel", time: at(0, "08:34"), text: "On it. It's percent-off coupons like FALL25: they have no amount_off, and applyCoupon assumes every coupon does. Came in with #314." },
    { message_id: "m04", channel: "incidents", thread_id: "m02", user: "Maya Chen", time: at(0, "08:41"), text: "Should we roll back to 2.30.2?" },
    { message_id: "m05", channel: "incidents", thread_id: "m02", user: "Jonas Weber", time: at(0, "08:47"), text: "A rollback also drops the waitlist emails studios already use. Let's turn off the FALL25 code instead and ship Priya's fix today." },
    { message_id: "m06", channel: "incidents", thread_id: "m02", user: "Sam Okafor", time: at(0, "09:52"), text: "Bluebird Bakery and Harbor Yoga both hit it. Bluebird says they were charged twice." },
    { message_id: "m07", channel: "incidents", thread_id: "m02", user: "Priya Patel", time: at(0, "10:06"), text: "Fix is up: larkspur/web#318. CI is green, waiting on Leo's review.", unread: true },
    { message_id: "m08", channel: "incidents", thread_id: "m02", user: "Maya Chen", time: at(0, "11:32"), text: "From the incident sync: no rollback, FALL25 stays off until #318 ships, and Sam refunds duplicate charges today. Postmortem tomorrow at 10:30." },
    { message_id: "m09", channel: "support", user: "Sam Okafor", time: at(0, "09:40"), text: "Bluebird Bakery says they were charged twice when they upgraded this morning. Checking Stripe.", reply_count: 1 },
    { message_id: "m10", channel: "support", thread_id: "m09", user: "Sam Okafor", time: at(0, "10:09"), text: "Confirmed in Stripe: two $79 charges, at 9:02 and 9:04. I'll refund the second one today." },
    { message_id: "m11", channel: "eng", user: "Leo Martins", time: at(0, "10:50"), text: "Reviewed #318, one small ask. Otherwise good to go.", unread: true },
    { message_id: "m12", channel: "eng", user: "Daniel Kim", time: at(-1, "16:10"), text: "The Node 22 upgrade is blocked on three date-format tests. I'll pick it up Thursday." },
    { message_id: "m13", channel: "general", user: "Ava Rossi", time: at(0, "09:05"), text: "New checkout designs are in Figma for anyone curious. Feedback welcome!" },
    { message_id: "m14", channel: "general", user: "Jonas Weber", time: at(-1, "18:02"), text: "The Q4 planning draft is in Notion. Please comment by Friday." },
  ],
  canvases: [{ title: "Incident checklist", channel: "incidents", content: "1. Start a thread in #incidents. 2. Page on-call. 3. Post an update every 30 minutes. 4. Hold a postmortem within two days." }],
  reminders: [{ text: "Send the board update to Jonas", time: at(2, "09:00") }],
};

const linear = {
  teams: [
    { team: "ENG", name: "Engineering", members: ["Maya Chen", "Priya Patel", "Leo Martins", "Daniel Kim", "Jonas Weber"], statuses: ["Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled"] },
    { team: "SUP", name: "Support", members: ["Sam Okafor", "Maya Chen"], statuses: ["Todo", "In Progress", "Done"] },
    { team: "DES", name: "Design", members: ["Ava Rossi"], statuses: ["Backlog", "In Progress", "In Review", "Done"] },
  ],
  users: [
    { name: "Maya Chen", email: "maya@larkspur.example", teams: ["ENG", "SUP"] },
    { name: "Priya Patel", email: "priya@larkspur.example", teams: ["ENG"] },
    { name: "Leo Martins", email: "leo@larkspur.example", teams: ["ENG"] },
    { name: "Daniel Kim", email: "daniel@larkspur.example", teams: ["ENG"] },
    { name: "Jonas Weber", email: "jonas@larkspur.example", teams: ["ENG"] },
    { name: "Sam Okafor", email: "sam@larkspur.example", teams: ["SUP"] },
    { name: "Ava Rossi", email: "ava@larkspur.example", teams: ["DES"] },
  ],
  issues: [
    {
      id: "ENG-142",
      title: "Checkout crashes when a percent-off coupon is applied",
      team: "ENG",
      status: "In Review",
      priority: "Urgent",
      assignee: "Priya Patel",
      creator: "Daniel Kim",
      labels: ["bug", "checkout", "incident"],
      project: "Checkout v2",
      cycle: "Cycle 31",
      created_at: at(0, "08:31"),
      updated_at: at(0, "10:06"),
      description: "Sentry LARKSPUR-WEB-3F2: TypeError in applyCoupon since web@2.31.0. Every percent-off coupon, like FALL25, crashes checkout.",
      attachments: [
        { title: "larkspur/web#318: Fix checkout crash for percent-off coupons", url: "https://github.com/larkspur/web/pull/318" },
        { title: "Sentry LARKSPUR-WEB-3F2", url: "https://larkspur.sentry.io/issues/LARKSPUR-WEB-3F2" },
      ],
      comments: [
        { author: "Priya Patel", created_at: at(0, "08:44"), body: "Root cause: #314 assumed every coupon has amount_off. Fixing now." },
        { author: "Priya Patel", created_at: at(0, "10:06"), body: "PR is up: larkspur/web#318." },
      ],
    },
    { id: "ENG-143", title: "Turn off the FALL25 promotion code until the checkout fix ships", team: "ENG", status: "Done", priority: "High", assignee: "Jonas Weber", creator: "Jonas Weber", labels: ["incident"], project: null, cycle: "Cycle 31", created_at: at(0, "08:50"), updated_at: at(0, "09:05"), description: "Turned off in Stripe at 9:05.", attachments: [], comments: [] },
    { id: "SUP-88", title: "Refund customers charged twice during the checkout incident", team: "SUP", status: "Todo", priority: "High", assignee: "Sam Okafor", creator: "Sam Okafor", labels: ["billing", "incident"], project: null, cycle: null, created_at: at(0, "10:15"), updated_at: at(0, "10:15"), description: "Bluebird Bakery: two $79 charges, at 9:02 and 9:04. Check Stripe for anyone else.", attachments: [], comments: [] },
    { id: "ENG-144", title: "Alert when checkout errors pass 1%", team: "ENG", status: "In Review", priority: "High", assignee: "Daniel Kim", creator: "Daniel Kim", labels: ["monitoring"], project: null, cycle: "Cycle 31", created_at: at(0, "09:10"), updated_at: at(0, "09:12"), description: "larkspur/infra#57, waiting on Maya's review.", attachments: [], comments: [] },
    { id: "ENG-139", title: "Upgrade to Node 22", team: "ENG", status: "In Progress", priority: "Medium", assignee: "Daniel Kim", creator: "Daniel Kim", labels: ["chore"], project: "Node 22 upgrade", cycle: "Cycle 31", created_at: at(-9, "10:00"), updated_at: at(-1, "16:10"), description: "Blocked on three date-format tests.", attachments: [], comments: [] },
    { id: "ENG-140", title: "Show tax before payment", team: "ENG", status: "Todo", priority: "Medium", assignee: "Leo Martins", creator: "Maya Chen", labels: ["checkout"], project: "Checkout v2", cycle: "Cycle 31", created_at: at(-12, "14:00"), updated_at: at(-3, "15:00"), description: "Show tax next to the total before the client pays.", attachments: [], comments: [] },
    { id: "ENG-131", title: "Write the Q4 hiring plan", team: "ENG", status: "In Progress", priority: "Medium", assignee: "Maya Chen", creator: "Jonas Weber", labels: [], project: null, cycle: "Cycle 31", created_at: at(-14, "09:00"), updated_at: at(-2, "17:00"), description: "One senior frontend engineer this quarter.", attachments: [], comments: [] },
    { id: "DES-21", title: "Redesign checkout", team: "DES", status: "In Review", priority: "Medium", assignee: "Ava Rossi", creator: "Leo Martins", labels: ["checkout"], project: "Checkout v2", cycle: null, created_at: at(-20, "11:00"), updated_at: at(0, "09:05"), description: "Designs are in Figma.", attachments: [], comments: [] },
  ],
  projects: [
    {
      project: "Checkout v2",
      status: "In Progress",
      lead: "Leo Martins",
      target_date: "2026-11-13",
      progress: "55%",
      description: "Faster checkout, with tax shown up front and coupons that just work.",
      updates: [
        { author: "Maya Chen", created_at: at(0, "11:40"), health: "At risk", body: "Coupon savings caused today's checkout crash. The fix is in review, and we're adding coupon tests to the plan." },
        { author: "Leo Martins", created_at: at(-3, "15:00"), health: "On track", body: "Coupon savings are done. Tax is next." },
      ],
    },
    { project: "Waitlists", status: "Completed", lead: "Leo Martins", target_date: "2026-10-05", progress: "100%", description: "Email clients when a spot opens up in a full class.", updates: [] },
    { project: "Node 22 upgrade", status: "In Progress", lead: "Daniel Kim", target_date: "2026-10-16", progress: "40%", description: "Move every service to Node 22.", updates: [] },
  ],
  cycles: [
    { team: "ENG", cycle: "Cycle 31", starts_at: "2026-09-30", ends_at: "2026-10-13", progress: "48%", scope: 21, completed: 10 },
    { team: "ENG", cycle: "Cycle 30", starts_at: "2026-09-16", ends_at: "2026-09-29", progress: "100%", scope: 18, completed: 17 },
  ],
  labels: ["bug", "checkout", "incident", "billing", "monitoring", "chore", "calendar"].map((name) => ({ name })),
  documents: [{ title: "Checkout v2 plan", project: "Checkout v2", updated_at: at(-6, "10:30"), content: "Milestones: coupon savings (done), tax before payment, one-page checkout." }],
  initiatives: [{ name: "Grow to 2,000 paying studios by the end of the year", status: "Active", projects: ["Checkout v2", "Waitlists"] }],
};

const notion = {
  pages: [
    {
      id: "postmortem-checkout",
      title: "Postmortem: checkout crash on percent-off coupons",
      parent: "Engineering / Postmortems",
      created_by: "Maya Chen",
      created_at: at(0, "11:20"),
      last_edited_by: "Maya Chen",
      last_edited_at: at(0, "11:36"),
      properties: { Status: "Draft", Owner: "Maya Chen", Review: "October 7, 10:30" },
      content:
        "Summary: Yesterday's web@2.31.0 release broke checkout for anyone using a percent-off coupon.\n\nTimeline:\n- Oct 5, 17:40: web@2.31.0 released\n- Oct 6, 08:12: Sentry alert for LARKSPUR-WEB-3F2\n- 08:20: Daniel starts a thread in #incidents\n- 08:47: Jonas decides to turn off FALL25 instead of rolling back\n- 09:05: FALL25 turned off\n- 10:05: Fix up for review (larkspur/web#318)\n\nCustomer impact: TODO\nRoot cause: TODO\nAction items: TODO",
      comments: [{ author: "Jonas Weber", created_at: at(0, "11:41"), body: "Can we add how many customers were charged twice?" }],
      history: [{ editor: "Maya Chen", edited_at: at(0, "11:36") }, { editor: "Maya Chen", edited_at: at(0, "11:20") }],
    },
    { id: "refund-policy", title: "Refund policy", parent: "Support", created_by: "Sam Okafor", created_at: "2026-03-02T10:00:00-08:00", last_edited_by: "Sam Okafor", last_edited_at: "2026-08-27T15:10:00-07:00", content: "Support can refund a duplicate or mistaken charge right away. Refunds over $200, or for more than one month, need Maya's or Jonas's approval. Always reply to the customer once the refund is done." },
    { id: "oncall-runbook", title: "On-call runbook", parent: "Engineering", created_by: "Daniel Kim", created_at: "2026-01-12T09:00:00-08:00", last_edited_by: "Daniel Kim", last_edited_at: at(-30, "12:00"), content: "Page on-call when checkout or booking errors pass 1%. Roll back a release that breaks payments unless a fix can ship the same day. Post an update in #incidents every 30 minutes." },
    { id: "release-checklist", title: "Release checklist", parent: "Engineering", created_by: "Jonas Weber", created_at: "2025-11-04T09:00:00-08:00", last_edited_by: "Jonas Weber", last_edited_at: at(-60, "16:00"), content: "Before every release: run the test suite, check checkout on staging with the WELCOME10 coupon, and post the release notes in #releases." },
    { id: "q4-roadmap", title: "Q4 roadmap (draft)", parent: "Company", created_by: "Jonas Weber", created_at: at(-2, "10:00"), last_edited_by: "Jonas Weber", last_edited_at: at(-1, "18:00"), content: "Ship Checkout v2 by November 13. Hire a senior frontend engineer. Grow from 1,640 paying studios to 2,000." },
    { id: "checkout-v2-spec", title: "Checkout v2 spec", parent: "Engineering / Specs", created_by: "Leo Martins", created_at: at(-40, "10:00"), last_edited_by: "Leo Martins", last_edited_at: at(-6, "10:30"), content: "Show the savings from a coupon next to the total. Show tax before payment. Keep checkout to one page." },
    { id: "interview-plan", title: "Interview plan: senior frontend engineer", parent: "Hiring", created_by: "Maya Chen", created_at: at(-10, "14:00"), last_edited_by: "Leo Martins", last_edited_at: at(-1, "11:30"), content: "Onsite: system design with Maya, pairing with Leo, values with Jonas." },
    { id: "postmortem-calendar", title: "Postmortem: calendar sync outage", parent: "Engineering / Postmortems", created_by: "Daniel Kim", created_at: "2026-08-20T10:00:00-07:00", last_edited_by: "Maya Chen", last_edited_at: "2026-08-24T16:00:00-07:00", properties: { Status: "Done", Owner: "Daniel Kim" }, content: "Google Calendar sync stopped for 3 hours after a token expired. We now alert on sync lag." },
  ],
  databases: [
    {
      id: "incidents",
      title: "Incidents",
      description: "Every production incident and its postmortem",
      columns: ["Name", "Status", "Severity", "Started", "Owner", "Postmortem"],
      rows: [
        { Name: "Checkout crash on percent-off coupons", Status: "Mitigated", Severity: "SEV-2", Started: at(0, "08:12"), Owner: "Maya Chen", Postmortem: "Draft" },
        { Name: "Calendar sync outage", Status: "Resolved", Severity: "SEV-2", Started: "2026-08-19T14:05:00-07:00", Owner: "Daniel Kim", Postmortem: "Done" },
        { Name: "Slow booking page", Status: "Resolved", Severity: "SEV-3", Started: "2026-07-02T09:40:00-07:00", Owner: "Priya Patel", Postmortem: "Done" },
      ],
    },
    {
      id: "hiring",
      title: "Hiring pipeline",
      description: "Candidates for open roles",
      columns: ["Candidate", "Role", "Stage", "Next step"],
      rows: [
        { Candidate: "Alex Moreno", Role: "Senior frontend engineer", Stage: "Onsite", "Next step": "Onsite on October 7 at 15:00" },
        { Candidate: "Jordan Lee", Role: "Senior frontend engineer", Stage: "Debrief", "Next step": "Debrief on October 6 at 16:30" },
      ],
    },
  ],
  users: slack.users.map(({ name, email }) => ({ name, email })),
  teams: [{ name: "Engineering" }, { name: "Support" }, { name: "Company" }, { name: "Hiring" }],
};

const calendar = {
  calendars: [
    { calendar: "maya@larkspur.example", name: "Maya Chen", primary: true, time_zone: "America/Los_Angeles" },
    { calendar: "eng-oncall", name: "Engineering on-call", primary: false, time_zone: "America/Los_Angeles" },
    { calendar: "company", name: "Larkspur", primary: false, time_zone: "America/Los_Angeles" },
  ],
  events: [
    { event_id: "ev-standup-0", calendar: "maya@larkspur.example", title: "Standup", start: at(0, "09:00"), end: at(0, "09:15"), organizer: "Maya Chen", attendees: ["Engineering"], location: "Zoom" },
    { event_id: "ev-incident-sync", calendar: "maya@larkspur.example", title: "Incident sync: checkout", start: at(0, "11:00"), end: at(0, "11:30"), organizer: "Daniel Kim", attendees: ["Maya Chen", "Priya Patel", "Daniel Kim", "Jonas Weber", "Sam Okafor"], location: "Zoom" },
    { event_id: "ev-1on1-priya", calendar: "maya@larkspur.example", title: "1:1 Maya and Priya", start: at(0, "14:00"), end: at(0, "14:30"), organizer: "Maya Chen", attendees: ["Maya Chen", "Priya Patel"], location: "Zoom" },
    { event_id: "ev-debrief", calendar: "maya@larkspur.example", title: "Interview debrief: Jordan Lee", start: at(0, "16:30"), end: at(0, "17:00"), organizer: "Maya Chen", attendees: ["Maya Chen", "Leo Martins", "Jonas Weber"], location: "Room 2" },
    { event_id: "ev-standup-1", calendar: "maya@larkspur.example", title: "Standup", start: at(1, "09:00"), end: at(1, "09:15"), organizer: "Maya Chen", attendees: ["Engineering"], location: "Zoom" },
    { event_id: "ev-planning", calendar: "maya@larkspur.example", title: "Sprint planning", start: at(1, "09:30"), end: at(1, "10:15"), organizer: "Maya Chen", attendees: ["Engineering"], location: "Room 1" },
    {
      event_id: "ev-postmortem",
      calendar: "maya@larkspur.example",
      title: "Checkout postmortem",
      start: at(1, "10:30"),
      end: at(1, "11:15"),
      organizer: "Maya Chen",
      attendees: ["Maya Chen", "Priya Patel", "Daniel Kim", "Jonas Weber", "Sam Okafor", "Leo Martins"],
      responses: { "Priya Patel": "accepted", "Daniel Kim": "accepted", "Jonas Weber": "accepted", "Sam Okafor": "accepted", "Leo Martins": "tentative" },
      location: "Room 1",
      description: "Notion: Postmortem: checkout crash on percent-off coupons",
    },
    { event_id: "ev-lunch-ava", calendar: "maya@larkspur.example", title: "Lunch with Ava", start: at(1, "12:30"), end: at(1, "13:15"), organizer: "Ava Rossi", attendees: ["Maya Chen", "Ava Rossi"], location: "Tartine" },
    { event_id: "ev-onsite", calendar: "maya@larkspur.example", title: "Onsite: Alex Moreno, senior frontend engineer", start: at(1, "15:00"), end: at(1, "16:00"), organizer: "Maya Chen", attendees: ["Maya Chen", "Leo Martins", "Alex Moreno"], location: "Room 2" },
    { event_id: "ev-board-prep", calendar: "maya@larkspur.example", title: "Board update prep with Jonas", start: at(2, "13:00"), end: at(2, "14:00"), organizer: "Jonas Weber", attendees: ["Maya Chen", "Jonas Weber"], location: "Room 1" },
    { event_id: "ev-oncall", calendar: "eng-oncall", title: "On call: Daniel Kim", start: at(-1, "09:00"), end: at(6, "09:00"), organizer: "Daniel Kim", attendees: ["Daniel Kim"] },
    { event_id: "ev-all-hands", calendar: "company", title: "All hands", start: at(3, "16:00"), end: at(3, "16:45"), organizer: "Jonas Weber", attendees: ["Everyone"], location: "Kitchen and Zoom" },
  ],
};

const gmail = {
  labels: [
    { name: "INBOX", unread: 3 },
    { name: "Support", unread: 1 },
    { name: "Alerts", unread: 0 },
    { name: "Billing", unread: 0 },
    { name: "Hiring", unread: 0 },
  ],
  messages: [
    { message_id: "msg-01", thread_id: "th-bluebird", from: "Grace Liu <grace@bluebirdbakery.example>", to: "support@larkspur.example", subject: "Charged twice?", date: at(0, "09:31"), labels: ["Support"], unread: false, body: "Hi Larkspur team, we tried to upgrade to the Studio plan this morning. The page crashed after I entered our coupon, so I tried again, and now our card shows two charges of $79. Can you refund one? Thanks, Grace (Bluebird Bakery)" },
    { message_id: "msg-02", thread_id: "th-bluebird", from: "Sam Okafor <sam@larkspur.example>", to: "Maya Chen <maya@larkspur.example>", subject: "Fwd: Charged twice?", date: at(0, "09:45"), labels: ["INBOX", "Support"], unread: false, body: "Maya, Bluebird hit the checkout crash and got charged twice. I'll refund the second charge today unless you object." },
    { message_id: "msg-03", thread_id: "th-bluebird", from: "Sam Okafor <sam@larkspur.example>", to: "Grace Liu <grace@bluebirdbakery.example>", cc: "Maya Chen <maya@larkspur.example>", subject: "Re: Charged twice?", date: at(0, "10:12"), labels: ["INBOX", "Support"], unread: false, body: "Hi Grace, sorry about this! A bug in yesterday's release broke checkout for some coupons. You were charged twice, and we'll refund the second $79 charge today. Your Studio plan is active. Sam" },
    { message_id: "msg-04", thread_id: "th-harbor", from: "Tom Reyes <tom@harboryoga.example>", to: "support@larkspur.example", subject: "Can't upgrade", date: at(0, "09:20"), labels: ["Support"], unread: true, body: "The upgrade page goes blank when I enter FALL25. Is the coupon still valid? Tom, Harbor Yoga" },
    { message_id: "msg-05", thread_id: "th-sentry", from: "Sentry <alerts@sentry.example>", to: "maya@larkspur.example", subject: "[larkspur-web] New issue: TypeError: Cannot read properties of undefined (reading 'amount')", date: at(0, "08:12"), labels: ["Alerts"], unread: false, body: "New issue LARKSPUR-WEB-3F2 in larkspur-web, release web@2.31.0: TypeError in applyCoupon (src/checkout/applyCoupon.ts). 14 events in the first 5 minutes." },
    { message_id: "msg-06", thread_id: "th-stripe-1", from: "Stripe <notifications@stripe.example>", to: "maya@larkspur.example", subject: "Payment of $79.00 from Bluebird Bakery", date: at(0, "09:02"), labels: ["Billing"], unread: false, body: "Bluebird Bakery paid $79.00 for Upgrade to Studio. Payment pi_3QbL01." },
    { message_id: "msg-07", thread_id: "th-stripe-2", from: "Stripe <notifications@stripe.example>", to: "maya@larkspur.example", subject: "Payment of $79.00 from Bluebird Bakery", date: at(0, "09:04"), labels: ["Billing"], unread: false, body: "Bluebird Bakery paid $79.00 for Upgrade to Studio. Payment pi_3QbL02." },
    { message_id: "msg-08", thread_id: "th-q4", from: "Jonas Weber <jonas@larkspur.example>", to: "eng@larkspur.example", subject: "Q4 planning: the draft is in Notion", date: at(-1, "18:05"), labels: ["INBOX"], unread: true, body: "The Q4 roadmap draft is in Notion. Please comment by Friday. Checkout v2 is still the big one." },
    { message_id: "msg-09", thread_id: "th-alex", from: "Nora Kim <nora@talentbridge.example>", to: "maya@larkspur.example", subject: "Alex Moreno: onsite confirmed for Wednesday at 3 PM", date: at(-1, "11:20"), labels: ["INBOX", "Hiring"], unread: true, body: "Alex confirmed the onsite on Wednesday, October 7, at 3 PM. Their portfolio is attached to the calendar invite." },
    { message_id: "msg-10", thread_id: "th-aws", from: "AWS Billing <billing@aws.example>", to: "maya@larkspur.example", subject: "Your September invoice is available", date: at(-2, "06:00"), labels: ["Billing"], unread: false, body: "Your AWS invoice for September is $4,212.36.", attachments: [{ filename: "invoice-september.pdf", text: "Total due: $4,212.36. EC2 $2,904.10, RDS $1,031.55, S3 $276.71." }] },
  ].map((message) => ({ ...message, snippet: message.body.slice(0, 100) })),
  drafts: [{ draft_id: "draft-01", to: "Jonas Weber <jonas@larkspur.example>", subject: "Re: Q4 planning: the draft is in Notion", body: "Looks good. Two notes on hiring: we should open the frontend role this week, and", updated_at: at(-1, "19:10") }],
};

const sentry = {
  organizations: [{ slug: "larkspur", name: "Larkspur" }],
  teams: [
    { slug: "web", name: "Web", members: ["Leo Martins", "Priya Patel"] },
    { slug: "platform", name: "Platform", members: ["Priya Patel", "Daniel Kim"] },
  ],
  projects: [
    { project: "larkspur-web", platform: "javascript-react", team: "web", dsn: "https://9f2c41@o4508.ingest.sentry.example/1" },
    { project: "larkspur-api", platform: "node", team: "platform", dsn: "https://77a0be@o4508.ingest.sentry.example/2" },
  ],
  issues: [
    {
      issue_id: "LARKSPUR-WEB-3F2",
      project: "larkspur-web",
      title: "TypeError: Cannot read properties of undefined (reading 'amount')",
      culprit: "applyCoupon(src/checkout/applyCoupon.ts)",
      level: "error",
      status: "unresolved",
      priority: "high",
      assigned_to: "Priya Patel",
      first_seen: at(0, "08:12"),
      last_seen: at(0, "09:58"),
      events: 214,
      users: 37,
      first_release: "web@2.31.0",
      linked_issues: ["ENG-142"],
      tags: { browser: { "Chrome 141": 131, "Safari 26": 60, "Firefox 143": 23 }, url: { "/checkout": 214 }, coupon: { FALL25: 214 } },
      activity: [
        { type: "assigned", user: "Daniel Kim", date: at(0, "08:25"), note: "Assigned to Priya Patel" },
        { type: "linked", user: "Daniel Kim", date: at(0, "08:31"), note: "Linked Linear ENG-142" },
      ],
    },
    { issue_id: "LARKSPUR-API-1A7", project: "larkspur-api", title: "Stripe webhook took longer than 10s", culprit: "POST /webhooks/stripe", level: "warning", status: "unresolved", priority: "medium", assigned_to: null, first_seen: at(0, "09:03"), last_seen: at(0, "09:06"), events: 12, users: 0, first_release: "api@1.48.1", linked_issues: [], tags: { endpoint: { "/webhooks/stripe": 12 } }, activity: [] },
    { issue_id: "LARKSPUR-WEB-3E9", project: "larkspur-web", title: "ChunkLoadError: Loading chunk 812 failed", culprit: "app/router", level: "error", status: "resolved", priority: "medium", assigned_to: "Leo Martins", first_seen: at(-9, "13:40"), last_seen: at(-7, "16:01"), events: 58, users: 41, first_release: "web@2.30.1", linked_issues: [], tags: {}, activity: [] },
    { issue_id: "LARKSPUR-WEB-3D1", project: "larkspur-web", title: "RangeError: Invalid time zone specified: Asia/Kolkatta", culprit: "formatClassTime(src/calendar/format.ts)", level: "error", status: "ignored", priority: "low", assigned_to: null, first_seen: at(-30, "07:15"), last_seen: at(-2, "06:40"), events: 9, users: 2, first_release: "web@2.28.0", linked_issues: [], tags: {}, activity: [] },
  ],
  events: [
    { event_id: "evt-91f2", issue_id: "LARKSPUR-WEB-3F2", project: "larkspur-web", timestamp: at(0, "09:02"), message: "TypeError: Cannot read properties of undefined (reading 'amount')", release: "web@2.31.0", user: "grace@bluebirdbakery.example", url: "/checkout?plan=studio", trace_id: "trace-4c1a", stacktrace: ["applyCoupon at src/checkout/applyCoupon.ts:5", "CheckoutForm at src/checkout/CheckoutForm.tsx:2", "renderWithHooks at react-dom.production.js"], tags: { browser: "Chrome 141", coupon: "FALL25" } },
    { event_id: "evt-91a7", issue_id: "LARKSPUR-WEB-3F2", project: "larkspur-web", timestamp: at(0, "09:19"), message: "TypeError: Cannot read properties of undefined (reading 'amount')", release: "web@2.31.0", user: "tom@harboryoga.example", url: "/checkout?plan=studio", trace_id: "trace-4c3e", stacktrace: ["applyCoupon at src/checkout/applyCoupon.ts:5", "CheckoutForm at src/checkout/CheckoutForm.tsx:2"], tags: { browser: "Safari 26", coupon: "FALL25" } },
    { event_id: "evt-90b3", issue_id: "LARKSPUR-WEB-3F2", project: "larkspur-web", timestamp: at(0, "08:12"), message: "TypeError: Cannot read properties of undefined (reading 'amount')", release: "web@2.31.0", user: "anonymous", url: "/checkout?plan=pro", trace_id: "trace-49d0", stacktrace: ["applyCoupon at src/checkout/applyCoupon.ts:5", "CheckoutForm at src/checkout/CheckoutForm.tsx:2"], tags: { browser: "Chrome 141", coupon: "FALL25" } },
    { event_id: "evt-77c0", issue_id: "LARKSPUR-API-1A7", project: "larkspur-api", timestamp: at(0, "09:04"), message: "Stripe webhook took longer than 10s", release: "api@1.48.1", user: "stripe", url: "/webhooks/stripe", trace_id: "trace-4c20", stacktrace: ["handleStripeWebhook at src/webhooks/stripe.ts:4"], tags: { event_type: "invoice.paid" } },
  ],
  releases: [
    { version: "web@2.31.0", project: "larkspur-web", date_released: at(-1, "17:40"), commits: 6, new_issues: 1, crash_free_sessions: "97.8%" },
    { version: "web@2.30.2", project: "larkspur-web", date_released: at(-7, "16:05"), commits: 3, new_issues: 0, crash_free_sessions: "99.6%" },
    { version: "api@1.48.1", project: "larkspur-api", date_released: at(-1, "15:30"), commits: 2, new_issues: 1, crash_free_sessions: "99.9%" },
  ],
  traces: [
    {
      trace_id: "trace-4c1a",
      duration_ms: 1840,
      spans: [
        { op: "ui.click", description: "Pay $79", duration_ms: 12 },
        { op: "http.client", description: "POST /api/checkout/session", duration_ms: 1210, status: "ok" },
        { op: "function", description: "applyCoupon", duration_ms: 1, status: "internal_error" },
      ],
    },
  ],
};

const stripe = {
  balance: { available: [{ amount: 1248022, currency: "usd" }], pending: [{ amount: 103200, currency: "usd" }] },
  customers: [
    { id: "cus_QbLuBk7Ze2", name: "Bluebird Bakery", email: "grace@bluebirdbakery.example", created: "2025-03-14T10:00:00-07:00", plan: "Studio", payment_method: "Visa ending 4242" },
    { id: "cus_QhRy4Gt9Xa", name: "Harbor Yoga", email: "tom@harboryoga.example", created: "2025-11-02T10:00:00-08:00", plan: "Starter", payment_method: "Mastercard ending 4444" },
    { id: "cus_PzAc2Fi8Lm", name: "Acme Fitness", email: "billing@acmefitness.example", created: "2024-06-20T10:00:00-07:00", plan: "Pro", payment_method: "Amex ending 0005" },
    { id: "cus_Pn0rT5De1k", name: "Northside Dental", email: "office@northsidedental.example", created: "2025-01-09T10:00:00-08:00", plan: "Starter", payment_method: "Visa ending 1881" },
    { id: "cus_Qe7PiNe3Co", name: "Pine & Co Pilates", email: "hello@pineandco.example", created: "2025-07-30T10:00:00-07:00", plan: "Studio", payment_method: "Visa ending 0341" },
  ],
  payment_intents: [
    { payment_intent: "pi_3QbL02", customer: "cus_QbLuBk7Ze2", customer_name: "Bluebird Bakery", amount: 7900, currency: "usd", status: "succeeded", created: at(0, "09:04"), description: "Upgrade to Studio" },
    { payment_intent: "pi_3QbL01", customer: "cus_QbLuBk7Ze2", customer_name: "Bluebird Bakery", amount: 7900, currency: "usd", status: "succeeded", created: at(0, "09:02"), description: "Upgrade to Studio" },
    { payment_intent: "pi_3QhR01", customer: "cus_QhRy4Gt9Xa", customer_name: "Harbor Yoga", amount: 7900, currency: "usd", status: "canceled", created: at(0, "09:15"), description: "Upgrade to Studio", cancellation_reason: "abandoned" },
    { payment_intent: "pi_3PzA01", customer: "cus_PzAc2Fi8Lm", customer_name: "Acme Fitness", amount: 14900, currency: "usd", status: "succeeded", created: at(0, "06:00"), description: "Pro plan, monthly" },
    { payment_intent: "pi_3Pn001", customer: "cus_Pn0rT5De1k", customer_name: "Northside Dental", amount: 2900, currency: "usd", status: "succeeded", created: at(-1, "06:00"), description: "Starter plan, monthly" },
    { payment_intent: "pi_3Qe701", customer: "cus_Qe7PiNe3Co", customer_name: "Pine & Co Pilates", amount: 7900, currency: "usd", status: "requires_payment_method", created: at(-1, "06:00"), description: "Studio plan, monthly", last_payment_error: "Your card was declined." },
  ],
  refunds: [{ refund: "re_3Pn0R1", payment_intent: "pi_3Pn0Q8", customer: "cus_Pn0rT5De1k", customer_name: "Northside Dental", amount: 2900, status: "succeeded", created: at(-20, "11:00"), reason: "requested_by_customer" }],
  subscriptions: [
    { subscription: "sub_1QbLuB", customer: "cus_QbLuBk7Ze2", customer_name: "Bluebird Bakery", plan: "Studio", amount: 7900, status: "active", current_period_end: "2026-11-06", created: "2025-03-14T10:00:00-07:00", changed: at(0, "09:04") },
    { subscription: "sub_1QhRy4", customer: "cus_QhRy4Gt9Xa", customer_name: "Harbor Yoga", plan: "Starter", amount: 2900, status: "active", current_period_end: "2026-11-02", created: "2025-11-02T10:00:00-08:00" },
    { subscription: "sub_1PzAc2", customer: "cus_PzAc2Fi8Lm", customer_name: "Acme Fitness", plan: "Pro", amount: 14900, status: "active", current_period_end: "2026-11-06", created: "2024-06-20T10:00:00-07:00" },
    { subscription: "sub_1Pn0rT", customer: "cus_Pn0rT5De1k", customer_name: "Northside Dental", plan: "Starter", amount: 2900, status: "active", current_period_end: "2026-11-05", created: "2025-01-09T10:00:00-08:00" },
    { subscription: "sub_1Qe7Pi", customer: "cus_Qe7PiNe3Co", customer_name: "Pine & Co Pilates", plan: "Studio", amount: 7900, status: "past_due", current_period_end: "2026-11-05", created: "2025-07-30T10:00:00-07:00" },
  ],
  invoices: [
    { invoice: "in_1QbL9x", customer: "cus_QbLuBk7Ze2", customer_name: "Bluebird Bakery", amount_due: 7900, amount_paid: 7900, status: "paid", created: at(0, "09:04"), lines: ["Larkspur Studio, monthly"] },
    { invoice: "in_1PzA7c", customer: "cus_PzAc2Fi8Lm", customer_name: "Acme Fitness", amount_due: 14900, amount_paid: 14900, status: "paid", created: at(0, "06:00"), lines: ["Larkspur Pro, monthly"] },
    { invoice: "in_1Qe7Pz", customer: "cus_Qe7PiNe3Co", customer_name: "Pine & Co Pilates", amount_due: 7900, amount_paid: 0, status: "open", created: at(-1, "06:00"), lines: ["Larkspur Studio, monthly"] },
  ],
  products: [
    { product: "prod_starter", name: "Larkspur Starter", description: "One location, up to 200 bookings a month" },
    { product: "prod_studio", name: "Larkspur Studio", description: "One location, unlimited bookings, waitlists" },
    { product: "prod_pro", name: "Larkspur Pro", description: "Up to five locations, unlimited bookings, payroll export" },
  ],
  prices: [
    { price: "price_starter_monthly", product: "prod_starter", amount: 2900, currency: "usd", interval: "month" },
    { price: "price_studio_monthly", product: "prod_studio", amount: 7900, currency: "usd", interval: "month" },
    { price: "price_pro_monthly", product: "prod_pro", amount: 14900, currency: "usd", interval: "month" },
  ],
  coupons: [
    { coupon: "FALL25", name: "Fall, 25% off", percent_off: 25, amount_off: null, duration: "once", times_redeemed: 41, valid: true },
    { coupon: "WELCOME10", name: "Welcome, $10 off", percent_off: null, amount_off: 1000, duration: "once", times_redeemed: 212, valid: true },
  ],
  promotion_codes: [
    { code: "FALL25", coupon: "FALL25", active: false, note: "Turned off at 9:05 during the checkout incident" },
    { code: "WELCOME10", coupon: "WELCOME10", active: true, note: "" },
  ],
  disputes: [],
  payment_links: [{ payment_link: "plink_studio", price: "price_studio_monthly", active: true, url: "https://buy.stripe.example/studio" }],
};

export const DATA = { github, slack, linear, notion, calendar, gmail, sentry, stripe };
