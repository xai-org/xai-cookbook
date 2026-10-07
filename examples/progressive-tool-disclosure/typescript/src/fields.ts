// What each collection's records are called and what their fields mean. The tool descriptions use
// these to say what a tool returns, field by field, like real MCP servers do.

type Glossary = { [path: string]: { noun: string; fields: { [field: string]: string } } };

const TIME = "ISO 8601, in Pacific Time";

export const FIELDS: Glossary = {
  "github.repos": {
    noun: "repository",
    fields: { repo: "owner/name, like larkspur/web", description: "what the repository is for", language: "its main language", default_branch: "the branch pull requests merge into", open_issues: "how many issues are open", open_pull_requests: "how many pull requests are open", updated_at: `when anything in it last changed, ${TIME}` },
  },
  "github.branches": {
    noun: "branch",
    fields: { repo: "owner/name", name: "the branch name", last_commit: "the short SHA of its latest commit", protected: "whether changes to it need a pull request" },
  },
  "github.commits": {
    noun: "commit",
    fields: { repo: "owner/name", branch: "the branch it's on", sha: "its short SHA", author: "the author's GitHub login", date: `when it was committed, ${TIME}`, message: "the commit message" },
  },
  "github.files": {
    noun: "file",
    fields: { repo: "owner/name", path: "its path in the repository", content: "the file's full text" },
  },
  "github.issues": {
    noun: "issue",
    fields: { repo: "owner/name", number: "the issue number", title: "the title", state: "open or closed", author: "the GitHub login of whoever opened it", labels: "a list of label names", assignee: "the assignee's GitHub login, or null", created_at: `when it was opened, ${TIME}`, body: "the description, in Markdown", comments: "each comment's author, time, and body, oldest first" },
  },
  "github.pulls": {
    noun: "pull request",
    fields: {
      repo: "owner/name",
      number: "the pull request number",
      title: "the title",
      state: "open, closed, or merged",
      draft: "whether it's a draft",
      author: "the author's GitHub login",
      head: "the branch with the changes",
      base: "the branch it merges into",
      created_at: `when it was opened, ${TIME}`,
      updated_at: `when it last changed, ${TIME}`,
      labels: "a list of label names",
      body: "the description, in Markdown",
      requested_reviewers: "the GitHub logins asked to review it",
      mergeable: "whether it can merge without conflicts",
      additions: "lines added",
      deletions: "lines removed",
      files: "each changed file's name and its lines added and removed",
      checks: "the overall state, success, failure, or pending, and each check run's name, conclusion, and completion time",
      reviews: "each review's reviewer, verdict (APPROVED, CHANGES_REQUESTED, or COMMENTED), time, and comment",
      comments: "each comment's author, time, and body, oldest first",
      diff: "the unified diff",
    },
  },
  "github.workflows": {
    noun: "workflow",
    fields: { repo: "owner/name", name: "the workflow name, like CI or Deploy", file: "the path of its workflow file" },
  },
  "github.runs": {
    noun: "workflow run",
    fields: { repo: "owner/name", run_id: "the run ID", workflow: "the workflow name", branch: "the branch it ran on", event: "what started it, like push or pull_request", status: "queued, in_progress, or completed", conclusion: "success, failure, or cancelled, once completed", created_at: `when it started, ${TIME}`, duration: "how long it took", logs: "the jobs' output" },
  },
  "github.releases": {
    noun: "release",
    fields: { repo: "owner/name", tag: "the tag, like web@2.31.0", name: "the release title", author: "the GitHub login of whoever published it", published_at: `when it was published, ${TIME}`, body: "the release notes" },
  },
  "github.notifications": {
    noun: "notification",
    fields: { repo: "owner/name", reason: "why you got it, like review_requested, mention, or subscribed", type: "PullRequest or Issue", subject: "the title and number of the pull request or issue", unread: "whether you've seen it", updated_at: `when it last changed, ${TIME}` },
  },
  "github.dependabot": {
    noun: "alert",
    fields: { repo: "owner/name", package: "the vulnerable package", severity: "low, moderate, high, or critical", state: "open, fixed, or dismissed", summary: "what the vulnerability is", created_at: `when it was found, ${TIME}` },
  },
  "github.code_scanning": {
    noun: "alert",
    fields: { repo: "owner/name", rule: "the rule that flagged the code", severity: "note, warning, or error", state: "open, fixed, or dismissed", path: "the file it's in", created_at: `when it was found, ${TIME}` },
  },
  "github.secret_scanning": {
    noun: "alert",
    fields: { repo: "owner/name", secret_type: "what kind of secret it is", state: "open or resolved", path: "the file it was found in", created_at: `when it was found, ${TIME}` },
  },
  "slack.channels": {
    noun: "channel",
    fields: { channel: "the channel name, without the #", topic: "the channel topic", member_count: "how many people are in it", members: "the names of the people in it" },
  },
  "slack.users": {
    noun: "person",
    fields: { name: "their display name", title: "their job title", email: "their email address", time_zone: "their time zone", status: "their status text, empty if they haven't set one" },
  },
  "slack.messages": {
    noun: "message",
    fields: {
      message_id: "the message ID, for slack_read_thread, slack_get_reactions, or slack_reply_in_thread",
      channel: "the channel it was sent in",
      user: "the sender's name",
      time: `when it was sent, ${TIME}`,
      text: "the message text",
      thread_id: "the ID of the thread's first message, if it's a reply",
      reply_count: "how many replies its thread has, if it started one",
      reactions: "each emoji and the people who added it",
      pinned: "whether it's pinned to the channel",
      unread: "whether you haven't read it yet",
    },
  },
  "slack.canvases": {
    noun: "canvas",
    fields: { title: "the canvas title", channel: "the channel it's attached to", content: "its text" },
  },
  "slack.reminders": {
    noun: "reminder",
    fields: { text: "what to be reminded about", time: `when the reminder fires, ${TIME}` },
  },
  "linear.teams": {
    noun: "team",
    fields: { team: "the team key, like ENG", name: "the team name", members: "the names of the people on it", statuses: "the statuses its issues can have, in workflow order" },
  },
  "linear.users": {
    noun: "person",
    fields: { name: "their name", email: "their email address", teams: "the keys of the teams they're on" },
  },
  "linear.issues": {
    noun: "issue",
    fields: {
      id: "the identifier, like ENG-142",
      title: "the title",
      team: "the team key",
      status: "the status, like Todo, In Progress, In Review, or Done",
      priority: "Urgent, High, Medium, or Low",
      assignee: "the assignee's name, or null",
      creator: "the name of whoever created it",
      labels: "a list of label names",
      project: "the project name, or null",
      cycle: "the cycle name, or null",
      created_at: `when it was created, ${TIME}`,
      updated_at: `when it last changed, ${TIME}`,
      description: "the description, in Markdown",
      attachments: "each linked pull request, error, or document's title and URL",
      comments: "each comment's author, time, and body, oldest first",
    },
  },
  "linear.projects": {
    noun: "project",
    fields: { project: "the project name", status: "Planned, In Progress, Paused, Completed, or Canceled", lead: "the project lead's name", target_date: "the target date", progress: "the share of its issues that are done", description: "what the project is for", updates: "each status update's author, time, health, and text, newest first" },
  },
  "linear.cycles": {
    noun: "cycle",
    fields: { team: "the team key", cycle: "the cycle name", starts_at: "the first day", ends_at: "the last day", progress: "the share of its issues that are done", scope: "how many issues are in it", completed: "how many of them are done" },
  },
  "linear.labels": {
    noun: "label",
    fields: { name: "the label name" },
  },
  "linear.documents": {
    noun: "document",
    fields: { title: "the document title", project: "the project it belongs to", updated_at: `when it last changed, ${TIME}`, content: "its text, in Markdown" },
  },
  "linear.initiatives": {
    noun: "initiative",
    fields: { name: "the initiative name", status: "Planned, Active, or Completed", projects: "the names of the projects in it" },
  },
  "notion.pages": {
    noun: "page",
    fields: {
      id: "the page ID, for notion_fetch and other page tools",
      title: "the page title",
      parent: "where the page lives, as a path of page titles",
      created_by: "the name of whoever created it",
      created_at: `when it was created, ${TIME}`,
      last_edited_by: "the name of whoever edited it last",
      last_edited_at: `when it was last edited, ${TIME}`,
      properties: "its properties, like Status and Owner, if it has any",
      content: "the page's text",
      comments: "each comment's author, time, and body",
      history: "each edit's editor and time, newest first",
    },
  },
  "notion.databases": {
    noun: "database",
    fields: { id: "the database ID", title: "the database title", description: "what it tracks", columns: "its column names", rows: "each row's values, keyed by column name" },
  },
  "notion.users": {
    noun: "person",
    fields: { name: "their name", email: "their email address" },
  },
  "notion.teams": {
    noun: "teamspace",
    fields: { name: "the teamspace name" },
  },
  "calendar.calendars": {
    noun: "calendar",
    fields: { calendar: "the calendar ID", name: "the calendar name", primary: "whether it's Maya's own calendar", time_zone: "the calendar's time zone" },
  },
  "calendar.events": {
    noun: "event",
    fields: {
      event_id: "the event ID",
      calendar: "the ID of the calendar it's on",
      title: "the event title",
      start: `when it starts, ${TIME}`,
      end: `when it ends, ${TIME}`,
      organizer: "the organizer's name",
      attendees: "the names of the people or groups invited",
      responses: "each attendee's response: accepted, declined, or tentative",
      location: "where it is, or the video call",
      description: "the event description",
    },
  },
  "gmail.labels": {
    noun: "label",
    fields: { name: "the label name", unread: "how many unread emails have the label" },
  },
  "gmail.messages": {
    noun: "email",
    fields: {
      message_id: "the message ID, for gmail_read_email, gmail_reply_to_email, and other email tools",
      thread_id: "the thread ID, for gmail_read_thread",
      from: "the sender's name and address",
      to: "the recipients",
      cc: "the people copied, if any",
      subject: "the subject",
      date: `when it was sent, ${TIME}`,
      labels: "its labels, like INBOX or Support",
      unread: "whether it's unread",
      body: "the email's text",
      snippet: "the first 100 characters of the text",
      attachments: "each attachment's filename and text",
    },
  },
  "gmail.drafts": {
    noun: "draft",
    fields: { draft_id: "the draft ID", to: "the recipients", subject: "the subject", body: "the text so far", updated_at: `when it was last saved, ${TIME}` },
  },
  "sentry.organizations": {
    noun: "organization",
    fields: { slug: "the organization slug", name: "the organization name" },
  },
  "sentry.teams": {
    noun: "team",
    fields: { slug: "the team slug", name: "the team name", members: "the names of the people on it" },
  },
  "sentry.projects": {
    noun: "project",
    fields: { project: "the project slug, like larkspur-web", platform: "the SDK platform, like javascript-react or node", team: "the slug of the team that owns it", dsn: "the DSN its SDK sends events to" },
  },
  "sentry.issues": {
    noun: "issue",
    fields: {
      issue_id: "the short ID, like LARKSPUR-WEB-3F2",
      project: "the project slug",
      title: "the error type and message",
      culprit: "the function and file where it happened",
      level: "fatal, error, warning, or info",
      status: "unresolved, resolved, or ignored",
      priority: "high, medium, or low",
      assigned_to: "the assignee's name, or null",
      first_seen: `when it first happened, ${TIME}`,
      last_seen: `when it last happened, ${TIME}`,
      events: "how many times it has happened",
      users: "how many users it has affected",
      first_release: "the release it first happened in",
      linked_issues: "identifiers of issues linked to it in other tools, like Linear",
      tags: "how many events had each value of each tag, like browser or url",
      activity: "each assignment, status change, or link, with who made it and when",
    },
  },
  "sentry.events": {
    noun: "event",
    fields: {
      event_id: "the event ID",
      issue_id: "the short ID of its issue",
      project: "the project slug",
      timestamp: `when it happened, ${TIME}`,
      message: "the error message",
      release: "the release it happened in",
      user: "the affected user's email, or anonymous",
      url: "the page or endpoint it happened on",
      trace_id: "the trace ID, for sentry_get_trace_details",
      stacktrace: "the stack frames, innermost first",
      tags: "its tags and their values",
    },
  },
  "sentry.releases": {
    noun: "release",
    fields: { version: "the version, like web@2.31.0", project: "the project slug", date_released: `when it shipped, ${TIME}`, commits: "how many commits it has", new_issues: "how many issues first happened in it", crash_free_sessions: "the share of sessions that didn't crash" },
  },
  "sentry.traces": {
    noun: "trace",
    fields: { trace_id: "the trace ID", duration_ms: "how long it took, in milliseconds", spans: "each span's operation, description, duration, and status" },
  },
  "stripe.customers": {
    noun: "customer",
    fields: { id: "the customer ID, like cus_QbLuBk7Ze2", name: "the customer's name", email: "their email address", created: `when they signed up, ${TIME}`, plan: "the plan they're on", payment_method: "the card on file" },
  },
  "stripe.payment_intents": {
    noun: "payment",
    fields: {
      payment_intent: "the payment ID, like pi_3QbL01, for stripe_create_refund",
      customer: "the customer ID",
      customer_name: "the customer's name",
      amount: "the amount, in cents",
      currency: "the currency, like usd",
      status: "succeeded, processing, requires_payment_method, or canceled",
      created: `when it was made, ${TIME}`,
      description: "what it was for",
      last_payment_error: "why the last attempt failed, if it did",
      cancellation_reason: "why it was canceled, if it was",
    },
  },
  "stripe.refunds": {
    noun: "refund",
    fields: { refund: "the refund ID", payment_intent: "the ID of the payment it refunds", customer: "the customer ID", customer_name: "the customer's name", amount: "the amount, in cents", status: "pending, succeeded, or failed", created: `when it was made, ${TIME}`, reason: "duplicate, fraudulent, or requested_by_customer" },
  },
  "stripe.subscriptions": {
    noun: "subscription",
    fields: { subscription: "the subscription ID", customer: "the customer ID", customer_name: "the customer's name", plan: "the plan name", amount: "the monthly price, in cents", status: "active, past_due, canceled, or trialing", current_period_end: "when the current billing period ends", created: `when it started, ${TIME}`, changed: `when the plan last changed, if it has, ${TIME}` },
  },
  "stripe.invoices": {
    noun: "invoice",
    fields: { invoice: "the invoice ID", customer: "the customer ID", customer_name: "the customer's name", amount_due: "the amount due, in cents", amount_paid: "the amount paid, in cents", status: "draft, open, paid, void, or uncollectible", created: `when it was created, ${TIME}`, lines: "what it bills for" },
  },
  "stripe.products": {
    noun: "product",
    fields: { product: "the product ID", name: "the product name", description: "what it includes" },
  },
  "stripe.prices": {
    noun: "price",
    fields: { price: "the price ID", product: "the product ID", amount: "the amount, in cents", currency: "the currency", interval: "how often it bills: month or year" },
  },
  "stripe.coupons": {
    noun: "coupon",
    fields: { coupon: "the coupon ID, like FALL25", name: "the coupon name", percent_off: "the percent off, or null", amount_off: "the amount off in cents, or null", duration: "once, repeating, or forever", times_redeemed: "how many times it has been used", valid: "whether it can still be used" },
  },
  "stripe.promotion_codes": {
    noun: "promotion code",
    fields: { code: "the code customers enter", coupon: "the coupon it applies", active: "whether customers can use it now", note: "why it was changed, if it was" },
  },
  "stripe.disputes": {
    noun: "dispute",
    fields: { dispute: "the dispute ID", payment_intent: "the disputed payment", amount: "the amount, in cents", reason: "why the customer disputed it", status: "needs_response, under_review, won, or lost", created: `when it was opened, ${TIME}` },
  },
  "stripe.payment_links": {
    noun: "payment link",
    fields: { payment_link: "the payment link ID", price: "the price ID it sells", active: "whether it can be used", url: "the link customers open" },
  },
};
