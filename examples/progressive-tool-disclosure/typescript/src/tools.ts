import { DATA } from "./data.ts";
import {
  AFTER,
  BEFORE,
  LIMIT,
  type Operation,
  QUERY,
  type Runner,
  type Spec,
  boolean,
  change,
  describe,
  find,
  first,
  get,
  integer,
  lookup,
  oneOf,
  records,
  strings,
  text,
  toTime,
  tool,
} from "./workspace.ts";

// The eight services Larkspur's workspace is connected to. Their tools are modeled on what each
// service's MCP server offers, and each name starts with its service, like slack_search_messages.
// Like many MCP servers, each repeats a few notes about the service in every tool's description.
export const SERVICES = [
  { key: "github", name: "GitHub", notes: "GitHub notes: repositories are named owner/name, like larkspur/web, and people by their GitHub login, like priya-patel, not their display name. Issues and pull requests share one sequence of numbers in each repository. Times are ISO 8601 in Pacific Time." },
  { key: "slack", name: "Slack", notes: "Slack notes: channels are named without the #, like incidents, and people by their display name, like Priya Patel. Replies live in threads: a message with a reply_count started one, and slack_read_thread reads it. Times are ISO 8601 in Pacific Time." },
  { key: "linear", name: "Linear", notes: "Linear notes: issues are identified by their team key and number, like ENG-142. Each team has its own statuses, which linear_list_issue_statuses lists, and people are named by their full name, like Priya Patel. Times are ISO 8601 in Pacific Time." },
  { key: "notion", name: "Notion", notes: "Notion notes: pages and databases can be found by ID or by title, and part of a title is enough. Page content comes back as plain text with line breaks. Times are ISO 8601 in Pacific Time." },
  { key: "calendar", name: "Google Calendar", notes: "Google Calendar notes: Maya's own calendar is maya@larkspur.example, and calendar_list_calendars lists the others she can see. Events come back in the order they happen. Times are ISO 8601 in Pacific Time, Maya's time zone." },
  { key: "gmail", name: "Gmail", notes: "Gmail notes: searches cover every label unless you pass one, and email to support@larkspur.example lands in Maya's mail with the Support label. Addresses match by name or email. A thread is an email and its replies, which gmail_read_thread reads in order. Times are ISO 8601 in Pacific Time." },
  { key: "sentry", name: "Sentry", notes: "Sentry notes: the organization is larkspur, with the projects larkspur-web and larkspur-api. An issue groups every event of the same error and is identified by a short ID, like LARKSPUR-WEB-3F2. Times are ISO 8601 in Pacific Time." },
  { key: "stripe", name: "Stripe", notes: "Stripe notes: amounts are whole numbers in the currency's smallest unit, so 7900 is $79.00. IDs start with their type: cus_ for customers, pi_ for payments, sub_ for subscriptions, in_ for invoices, and re_ for refunds. Times are ISO 8601 in Pacific Time." },
];

const REPO = text("Repository as owner/name, like larkspur/web. Part of the name works too, like web, as long as only one repository matches.");
const NUMBER = integer("The issue or pull request number, like 318, without the #.");
const RUN_ID = integer("The workflow run ID, like 2291, from github_list_workflow_runs.");
const PULL_SUMMARY = ["repo", "number", "title", "state", "draft", "author", "head", "updated_at", "labels"];
const PULL_DETAILS = ["files", "checks", "reviews", "comments", "diff"];
const pull = (field?: string) => get("github.pulls", ["repo", "number"], { partial: true, field, omit: PULL_DETAILS });

const github: Spec[] = [
  tool("get_me", "Get the signed-in user: login, name, email, and organizations.", {}, [], () => ({ status: "ok", data: { login: "maya-chen", name: "Maya Chen", email: "maya@larkspur.example", organizations: ["larkspur"] } })),
  tool("search_repositories", "Search repositories by words in their name or description.", { query: QUERY, limit: LIMIT }, ["query"], find("github.repos", { search: ["repo", "description"], date: "updated_at" })),
  tool("get_repository", "Get a repository's description, language, default branch, and counts of open issues and pull requests.", { repo: REPO }, ["repo"], get("github.repos", "repo", { partial: true })),
  tool("list_branches", "List a repository's branches, with the last commit on each.", { repo: REPO, limit: LIMIT }, ["repo"], find("github.branches", { filters: { repo: "repo" } })),
  tool("get_file_contents", "Get the contents of a file in a repository.", { repo: REPO, path: text("Path to the file, like src/checkout/applyCoupon.ts."), ref: text("Branch, tag, or commit. Defaults to the default branch.") }, ["repo", "path"], get("github.files", ["repo", "path"], { partial: true })),
  tool("search_code", "Search code across repositories by words in a file's path or contents. Returns the matching files. Read a file with github_get_file_contents.", { query: QUERY, repo: REPO, limit: LIMIT }, ["query"], find("github.files", { filters: { repo: "repo" }, search: ["path", "content"], fields: ["repo", "path"] })),
  tool("list_commits", "List the commits on a branch, newest first, optionally by author or time. Use this to see what changed recently, or who changed it.", { repo: REPO, branch: text("Branch name. Defaults to the default branch."), author: text("GitHub login of the author."), after: AFTER, before: BEFORE, limit: LIMIT }, ["repo"], find("github.commits", { filters: { repo: "repo", branch: "branch", author: "author" }, date: "date" })),
  tool("get_commit", "Get a commit's message, author, branch, and date.", { repo: REPO, sha: text("Commit SHA.") }, ["repo", "sha"], get("github.commits", ["repo", "sha"], { partial: true })),
  tool("list_issues", "List a repository's issues, newest first. Filter by state, label, or assignee.", { repo: REPO, state: oneOf(["open", "closed", "all"], "Issue state."), label: text("Label name."), assignee: text("GitHub login of the assignee."), after: AFTER, limit: LIMIT }, ["repo"], find("github.issues", { filters: { repo: "repo", state: "state", label: "labels", assignee: "assignee" }, date: "created_at", omit: ["comments"] })),
  tool("get_issue", "Get an issue with its body, labels, assignee, and author.", { repo: REPO, number: NUMBER }, ["repo", "number"], get("github.issues", ["repo", "number"], { partial: true, omit: ["comments"] })),
  tool("search_issues", "Search issues across repositories by words in their title or body. Use this to find an issue someone reported when you don't know its number.", { query: QUERY, repo: REPO, state: oneOf(["open", "closed", "all"], "Issue state."), limit: LIMIT }, ["query"], find("github.issues", { filters: { repo: "repo", state: "state" }, search: ["title", "body"], date: "created_at", omit: ["comments"] })),
  tool("get_issue_comments", "Get the comments on an issue, oldest first.", { repo: REPO, number: NUMBER }, ["repo", "number"], get("github.issues", ["repo", "number"], { partial: true, field: "comments" })),
  tool("list_pull_requests", "List a repository's pull requests, most recently updated first. Filter by state, author, or base branch. Use github_get_pull_request_status to see whether a pull request's checks passed, and github_get_pull_request_reviews for its reviews.", { repo: REPO, state: oneOf(["open", "closed", "merged", "all"], "Pull request state."), author: text("GitHub login of the author."), base: text("Base branch."), limit: LIMIT }, ["repo"], find("github.pulls", { filters: { repo: "repo", state: "state", author: "author", base: "base" }, date: "updated_at", fields: PULL_SUMMARY })),
  tool("get_pull_request", "Get a pull request: title, description, state, branches, requested reviewers, size, and whether it can be merged. Its checks, reviews, files, and diff have their own tools.", { repo: REPO, number: NUMBER }, ["repo", "number"], pull()),
  tool("get_pull_request_files", "List the files a pull request changes, with the lines added and removed in each.", { repo: REPO, number: NUMBER }, ["repo", "number"], pull("files")),
  tool("get_pull_request_diff", "Get a pull request's diff.", { repo: REPO, number: NUMBER }, ["repo", "number"], pull("diff")),
  tool("get_pull_request_status", "Get the status of a pull request's checks, like CI, lint, and preview deploys.", { repo: REPO, number: NUMBER }, ["repo", "number"], pull("checks")),
  tool("get_pull_request_reviews", "Get the reviews on a pull request, with each reviewer's verdict and comment.", { repo: REPO, number: NUMBER }, ["repo", "number"], pull("reviews")),
  tool("get_pull_request_comments", "Get the comments on a pull request, oldest first.", { repo: REPO, number: NUMBER }, ["repo", "number"], pull("comments")),
  tool("search_pull_requests", "Search pull requests across repositories by words in their title or description. Use this when you know what a pull request is about but not its number.", { query: QUERY, repo: REPO, state: oneOf(["open", "closed", "merged", "all"], "Pull request state."), limit: LIMIT }, ["query"], find("github.pulls", { filters: { repo: "repo", state: "state" }, search: ["title", "body"], date: "updated_at", fields: PULL_SUMMARY })),
  tool("list_workflows", "List a repository's GitHub Actions workflows.", { repo: REPO }, ["repo"], find("github.workflows", { filters: { repo: "repo" } })),
  tool("list_workflow_runs", "List recent GitHub Actions workflow runs, newest first. Use this to see whether CI passed or when the last deploy ran, then github_get_job_logs to see why a run failed.", { repo: REPO, workflow: text("Workflow name, like CI or Deploy."), branch: text("Branch name."), conclusion: oneOf(["success", "failure", "cancelled", "all"], "How the run ended."), limit: LIMIT }, ["repo"], find("github.runs", { filters: { repo: "repo", workflow: "workflow", branch: "branch", conclusion: "conclusion" }, date: "created_at", omit: ["logs"] })),
  tool("get_workflow_run", "Get a workflow run's branch, trigger, status, conclusion, and duration.", { repo: REPO, run_id: RUN_ID }, ["repo", "run_id"], get("github.runs", ["repo", "run_id"], { partial: true, omit: ["logs"] })),
  tool("get_job_logs", "Get the logs of a workflow run's jobs. Use this to see why a run failed.", { repo: REPO, run_id: RUN_ID }, ["repo", "run_id"], get("github.runs", ["repo", "run_id"], { partial: true, field: "logs" })),
  tool("list_releases", "List a repository's releases, newest first, with their notes. Use this to see what shipped and when.", { repo: REPO, limit: LIMIT }, ["repo"], find("github.releases", { filters: { repo: "repo" }, date: "published_at" })),
  tool("get_latest_release", "Get a repository's latest release.", { repo: REPO }, ["repo"], first("github.releases", { filters: { repo: "repo" }, date: "published_at" })),
  tool("list_tags", "List a repository's tags, newest first.", { repo: REPO, limit: LIMIT }, ["repo"], find("github.releases", { filters: { repo: "repo" }, date: "published_at", fields: ["tag", "published_at"] })),
  tool("list_notifications", "List your notifications, like review requests and updates on threads you follow.", { unread: boolean("Only unread notifications."), limit: LIMIT }, [], find("github.notifications", { filters: { unread: "unread" }, date: "updated_at" })),
  tool("list_dependabot_alerts", "List Dependabot alerts about vulnerable dependencies in a repository.", { repo: REPO, state: oneOf(["open", "fixed", "dismissed"], "Alert state."), limit: LIMIT }, ["repo"], find("github.dependabot", { filters: { repo: "repo", state: "state" }, date: "created_at" })),
  tool("list_code_scanning_alerts", "List code scanning alerts in a repository.", { repo: REPO, state: oneOf(["open", "fixed", "dismissed"], "Alert state."), limit: LIMIT }, ["repo"], find("github.code_scanning", { filters: { repo: "repo", state: "state" } })),
  tool("list_secret_scanning_alerts", "List secrets found committed to a repository.", { repo: REPO, state: oneOf(["open", "resolved"], "Alert state."), limit: LIMIT }, ["repo"], find("github.secret_scanning", { filters: { repo: "repo", state: "state" } })),
  tool("create_issue", "Create an issue in a repository.", { repo: REPO, title: text("Issue title."), body: text("Issue body, in Markdown."), labels: strings("Labels to add."), assignees: strings("GitHub logins to assign.") }, ["repo", "title"], change("create this issue")),
  tool("update_issue", "Change an issue's title, body, state, labels, or assignees.", { repo: REPO, number: NUMBER, title: text("New title."), body: text("New body."), state: oneOf(["open", "closed"], "New state."), labels: strings("Labels it should have."), assignees: strings("GitHub logins it should be assigned to.") }, ["repo", "number"], change("update this issue")),
  tool("add_issue_comment", "Comment on an issue or pull request.", { repo: REPO, number: NUMBER, body: text("Comment, in Markdown.") }, ["repo", "number", "body"], change("post this comment")),
  tool("create_pull_request", "Open a pull request.", { repo: REPO, title: text("Title."), body: text("Description, in Markdown."), head: text("Branch with the changes."), base: text("Branch to merge into."), draft: boolean("Open it as a draft.") }, ["repo", "title", "head", "base"], change("open this pull request")),
  tool("update_pull_request", "Change a pull request's title, description, base branch, or state.", { repo: REPO, number: NUMBER, title: text("New title."), body: text("New description."), base: text("New base branch."), state: oneOf(["open", "closed"], "New state.") }, ["repo", "number"], change("update this pull request")),
  tool("merge_pull_request", "Merge a pull request.", { repo: REPO, number: NUMBER, method: oneOf(["merge", "squash", "rebase"], "How to merge. Defaults to merge."), commit_title: text("Title of the merge commit.") }, ["repo", "number"], change("merge this pull request")),
  tool("create_pull_request_review", "Review a pull request: approve it, request changes, or comment.", { repo: REPO, number: NUMBER, event: oneOf(["APPROVE", "REQUEST_CHANGES", "COMMENT"], "The review's verdict."), body: text("Review comment.") }, ["repo", "number", "event"], change("submit this review")),
  tool("request_reviewers", "Ask people to review a pull request.", { repo: REPO, number: NUMBER, reviewers: strings("GitHub logins to ask.") }, ["repo", "number", "reviewers"], change("request these reviews")),
  tool("create_branch", "Create a branch from another branch.", { repo: REPO, branch: text("Name of the new branch."), from: text("Branch to start from. Defaults to the default branch.") }, ["repo", "branch"], change("create this branch")),
  tool("create_or_update_file", "Create or change a file in a repository, as a commit.", { repo: REPO, path: text("Path to the file."), content: text("The file's new contents."), message: text("Commit message."), branch: text("Branch to commit to.") }, ["repo", "path", "content", "message"], change("commit this file")),
  tool("rerun_workflow_run", "Run a workflow run again.", { repo: REPO, run_id: RUN_ID }, ["repo", "run_id"], change("rerun this workflow run")),
  tool("cancel_workflow_run", "Cancel a workflow run that's in progress.", { repo: REPO, run_id: RUN_ID }, ["repo", "run_id"], change("cancel this workflow run")),
  tool("create_repository", "Create a repository in your account or an organization.", { name: text("Repository name."), organization: text("Organization to create it in."), private: boolean("Make it private."), description: text("Description.") }, ["name"], change("create this repository")),
  tool("fork_repository", "Fork a repository to your account or an organization.", { repo: REPO, organization: text("Organization to fork it to.") }, ["repo"], change("fork this repository")),
  tool("mark_notifications_read", "Mark your notifications as read.", { before: BEFORE }, [], change("mark these notifications read")),
];

const CHANNEL = text("Channel name without the #, like incidents. slack_list_channels lists every channel.");
const MESSAGE_ID = text("A message ID, like m02, from slack_search_messages or slack_read_channel.");

// A message and the replies in its thread, oldest first.
const readThread: Runner = (args) => {
  const messages = records("slack.messages").filter((message) => message.message_id === args.message_id || message.thread_id === args.message_id);
  if (!messages.length) return { status: "error", data: { error: `No message with ID ${args.message_id}` } };
  return { status: "ok", data: messages.sort((a, b) => toTime(a.time) - toTime(b.time)) };
};

const slack: Spec[] = [
  tool("list_channels", "List the workspace's public channels, with their topics and member counts.", { limit: LIMIT }, [], find("slack.channels", { omit: ["members"] })),
  tool("get_channel_info", "Get a channel's topic and member count.", { channel: CHANNEL }, ["channel"], get("slack.channels", "channel", { partial: true, omit: ["members"] })),
  tool("read_channel", "Read a channel's messages, newest first, without thread replies. Each message says how many replies its thread has. To read the replies to a message, use slack_read_thread with its message_id.", { channel: CHANNEL, after: AFTER, before: BEFORE, limit: LIMIT }, ["channel"], find("slack.messages", { filters: { channel: "channel" }, where: { thread_id: undefined }, date: "time" })),
  tool("read_thread", "Read a message and every reply in its thread, oldest first. Use this after a search or channel read finds a message with replies, to see the whole conversation and what was decided. Returns each message's message_id, channel, user, time, and text, and thread_id for the replies.", { message_id: text("ID of the thread's first message, like m02.") }, ["message_id"], readThread),
  tool("search_messages", "Search messages in every channel by words, sender, channel, or time, best matches first. Use this to find a conversation when you don't know which channel it was in, or what someone said about a topic.", { query: QUERY, channel: CHANNEL, from: text("Name of the person who sent it."), after: AFTER, before: BEFORE, limit: LIMIT }, ["query"], find("slack.messages", { filters: { channel: "channel", from: "user" }, search: ["text"], date: "time" })),
  tool("search_channels", "Search channels by words in their name or topic.", { query: QUERY, limit: LIMIT }, ["query"], find("slack.channels", { search: ["channel", "topic"], omit: ["members"] })),
  tool("search_users", "Search people by name, title, or email.", { query: QUERY, limit: LIMIT }, ["query"], find("slack.users", { search: ["name", "title", "email"] })),
  tool("get_user_profile", "Get a person's profile: title, email, time zone, and status.", { name: text("The person's name.") }, ["name"], get("slack.users", "name", { partial: true })),
  tool("list_channel_members", "List the people in a channel.", { channel: CHANNEL }, ["channel"], get("slack.channels", "channel", { partial: true, field: "members" })),
  tool("get_reactions", "Get the emoji reactions on a message and who added them.", { message_id: MESSAGE_ID }, ["message_id"], get("slack.messages", "message_id", { field: "reactions" })),
  tool("list_pins", "List the messages pinned in a channel.", { channel: CHANNEL }, ["channel"], find("slack.messages", { filters: { channel: "channel" }, where: { pinned: true }, date: "time" })),
  tool("list_canvases", "List the workspace's canvases.", {}, [], find("slack.canvases", { fields: ["title", "channel"] })),
  tool("read_canvas", "Read a canvas.", { title: text("The canvas's title.") }, ["title"], get("slack.canvases", "title", { partial: true })),
  tool("list_unread", "List unread messages in channels you're in, newest first.", { limit: LIMIT }, [], find("slack.messages", { where: { unread: true }, date: "time" })),
  tool("list_reminders", "List your reminders, soonest first.", {}, [], find("slack.reminders", { date: "time", order: "oldest" })),
  tool("send_message", "Send a message to a channel.", { channel: CHANNEL, text: text("The message, in Slack markdown.") }, ["channel", "text"], change("send this message")),
  tool("reply_in_thread", "Reply in a message's thread.", { message_id: MESSAGE_ID, text: text("The reply, in Slack markdown."), also_send_to_channel: boolean("Also post the reply to the channel.") }, ["message_id", "text"], change("post this reply")),
  tool("schedule_message", "Schedule a message to send later.", { channel: CHANNEL, text: text("The message."), post_at: text("When to send it, like 2026-10-07T09:00.") }, ["channel", "text", "post_at"], change("schedule this message")),
  tool("add_reaction", "Add an emoji reaction to a message.", { message_id: MESSAGE_ID, emoji: text("Emoji name, like eyes or white_check_mark.") }, ["message_id", "emoji"], change("add this reaction")),
  tool("create_channel", "Create a channel.", { name: text("Channel name."), private: boolean("Make it private."), topic: text("Topic.") }, ["name"], change("create this channel")),
  tool("set_channel_topic", "Set a channel's topic.", { channel: CHANNEL, topic: text("New topic.") }, ["channel", "topic"], change("set this topic")),
  tool("invite_to_channel", "Add people to a channel.", { channel: CHANNEL, people: strings("Names of the people to add.") }, ["channel", "people"], change("invite these people")),
  tool("create_canvas", "Create a canvas.", { title: text("Title."), content: text("Content, in Markdown."), channel: CHANNEL }, ["title", "content"], change("create this canvas")),
  tool("update_canvas", "Replace or add to a canvas's content.", { title: text("The canvas's title."), content: text("New content, in Markdown."), mode: oneOf(["replace", "append"], "Whether to replace the content or add to it.") }, ["title", "content"], change("update this canvas")),
  tool("set_status", "Set your status.", { text: text("Status text."), emoji: text("Status emoji."), until: text("When to clear it, like 2026-10-06T17:00.") }, ["text"], change("set this status")),
  tool("create_reminder", "Remind yourself about something.", { text: text("What to be reminded about."), time: text("When, like 2026-10-07T09:00.") }, ["text", "time"], change("create this reminder")),
];

const ISSUE_ID = text("The issue identifier: its team key, a dash, and its number, like ENG-142.");
const TEAM = text("A team key, like ENG. linear_list_teams lists every team.");
const ISSUE_SUMMARY = ["id", "title", "team", "status", "priority", "assignee", "labels", "project", "updated_at"];
const issue = (field?: string) => get("linear.issues", "id", { field });

const linear: Spec[] = [
  tool("list_issues", "List issues, most recently updated first. Filter by team, status, assignee, label, project, cycle, or priority, or search their titles and descriptions. Use linear_get_issue for an issue's comments and the links attached to it.", { team: TEAM, status: text("Status, like Todo, In Progress, In Review, or Done."), assignee: text('Name of the assignee, or "me".'), label: text("Label name."), project: text("Project name."), cycle: text("Cycle name, like Cycle 31."), priority: oneOf(["Urgent", "High", "Medium", "Low"], "Priority."), query: QUERY, limit: LIMIT }, [], find("linear.issues", { filters: { team: "team", status: "status", assignee: "assignee", label: "labels", project: "project", cycle: "cycle", priority: "priority" }, search: ["title", "description"], date: "updated_at", fields: ISSUE_SUMMARY })),
  tool("get_issue", "Get an issue with its description, comments, and the links attached to it. Use this when you know the identifier, like ENG-142, from a search, a Slack message, or a pull request.", { id: ISSUE_ID }, ["id"], issue()),
  tool("search_issues", "Search issues by words in their identifier, title, description, or comments, best matches first. Use this to find the issue for a bug or task when you don't know its identifier.", { query: QUERY, team: TEAM, limit: LIMIT }, ["query"], find("linear.issues", { filters: { team: "team" }, search: ["id", "title", "description", "comments"], date: "updated_at", fields: ISSUE_SUMMARY })),
  tool("list_my_issues", "List the issues assigned to you, most recently updated first.", { status: text("Status, like Todo or In Progress."), limit: LIMIT }, [], find("linear.issues", { filters: { status: "status" }, where: { assignee: "Maya Chen" }, date: "updated_at", fields: ISSUE_SUMMARY })),
  tool("list_comments", "List the comments on an issue, oldest first.", { id: ISSUE_ID }, ["id"], issue("comments")),
  tool("list_attachments", "List the links attached to an issue, like pull requests and Sentry issues.", { id: ISSUE_ID }, ["id"], issue("attachments")),
  tool("list_teams", "List the workspace's teams.", {}, [], find("linear.teams", { omit: ["statuses"] })),
  tool("get_team", "Get a team and its members.", { team: TEAM }, ["team"], get("linear.teams", "team", { omit: ["statuses"] })),
  tool("list_users", "List the people in the workspace.", { query: QUERY, limit: LIMIT }, [], find("linear.users", { search: ["name", "email"] })),
  tool("get_user", "Get a person and the teams they're on.", { name: text("The person's name.") }, ["name"], get("linear.users", "name", { partial: true })),
  tool("list_projects", "List projects with their status, lead, target date, and progress.", { status: text("Status, like In Progress or Completed."), lead: text("Name of the project lead."), limit: LIMIT }, [], find("linear.projects", { filters: { status: "status", lead: "lead" }, omit: ["updates"] })),
  tool("get_project", "Get a project with its description and latest status updates. Use this to see how a project is going.", { project: text("Project name.") }, ["project"], get("linear.projects", "project", { partial: true })),
  tool("list_project_updates", "List a project's status updates, newest first.", { project: text("Project name.") }, ["project"], get("linear.projects", "project", { partial: true, field: "updates" })),
  tool("list_cycles", "List a team's cycles, newest first.", { team: TEAM }, ["team"], find("linear.cycles", { filters: { team: "team" }, date: "starts_at" })),
  tool("get_cycle", "Get a cycle's dates, scope, and progress.", { team: TEAM, cycle: text("Cycle name, like Cycle 31.") }, ["team", "cycle"], get("linear.cycles", ["team", "cycle"], { partial: true })),
  tool("list_issue_statuses", "List the statuses an issue can have in a team.", { team: TEAM }, ["team"], get("linear.teams", "team", { field: "statuses" })),
  tool("list_issue_labels", "List the labels issues can have.", {}, [], find("linear.labels")),
  tool("list_documents", "List documents, optionally in one project.", { project: text("Project name."), limit: LIMIT }, [], find("linear.documents", { filters: { project: "project" }, date: "updated_at", omit: ["content"] })),
  tool("get_document", "Read a document.", { title: text("The document's title.") }, ["title"], get("linear.documents", "title", { partial: true })),
  tool("list_initiatives", "List initiatives and the projects in each.", {}, [], find("linear.initiatives")),
  tool("create_issue", "Create an issue.", { team: TEAM, title: text("Title."), description: text("Description, in Markdown."), assignee: text("Name of the assignee."), priority: oneOf(["Urgent", "High", "Medium", "Low"], "Priority."), labels: strings("Labels."), project: text("Project name.") }, ["team", "title"], change("create this issue")),
  tool("update_issue", "Change an issue's title, description, status, assignee, priority, labels, or project.", { id: ISSUE_ID, title: text("New title."), description: text("New description."), status: text("New status."), assignee: text("New assignee."), priority: oneOf(["Urgent", "High", "Medium", "Low"], "New priority."), labels: strings("Labels it should have.") }, ["id"], change("update this issue")),
  tool("create_comment", "Comment on an issue.", { id: ISSUE_ID, body: text("Comment, in Markdown.") }, ["id", "body"], change("post this comment")),
  tool("create_project", "Create a project.", { name: text("Project name."), team: TEAM, lead: text("Name of the lead."), target_date: text("Target date, like 2026-12-01."), description: text("Description.") }, ["name", "team"], change("create this project")),
  tool("update_project", "Change a project's status, lead, target date, or description.", { project: text("Project name."), status: text("New status."), lead: text("New lead."), target_date: text("New target date."), description: text("New description.") }, ["project"], change("update this project")),
  tool("create_project_update", "Post a status update on a project.", { project: text("Project name."), health: oneOf(["On track", "At risk", "Off track"], "How the project is doing."), body: text("The update, in Markdown.") }, ["project", "health", "body"], change("post this project update")),
  tool("create_issue_label", "Create a label.", { name: text("Label name."), color: text("Color, like red or #e5484d.") }, ["name"], change("create this label")),
  tool("link_attachment", "Attach a link to an issue.", { id: ISSUE_ID, url: text("The link."), title: text("Its title.") }, ["id", "url"], change("attach this link")),
  tool("archive_issue", "Archive an issue.", { id: ISSUE_ID }, ["id"], change("archive this issue")),
];

const PAGE = text("A page ID from notion_search, like postmortem-checkout, or the page's title. Part of the title is enough.");
const DATABASE = text("A database ID, like incidents, or the database's title.");

// A database's rows, only those that mention the query if there is one.
const queryDatabase: Runner = (args) => {
  const result = lookup("notion.databases", "database", "id", "title", "rows")(args);
  if (result.status !== "ok" || typeof args.query !== "string") return result;
  const wanted = args.query.toLowerCase();
  return { status: "ok", data: (result.data as object[]).filter((row) => JSON.stringify(row).toLowerCase().includes(wanted)) };
};

const notion: Spec[] = [
  tool("search", "Search pages by words in their title or content, best matches first. Returns each page's ID, title, location, and when it was last edited. Use this to find a page's ID, then read the page with notion_fetch.", { query: QUERY, limit: LIMIT }, ["query"], find("notion.pages", { search: ["title", "content"], date: "last_edited_at", fields: ["id", "title", "parent", "last_edited_by", "last_edited_at"] })),
  tool("fetch", "Get a page's properties and full content. Use this to read a doc, like a postmortem, a spec, or a policy, and to check its status.", { page: PAGE }, ["page"], lookup("notion.pages", "page", "id", "title")),
  tool("get_comments", "Get the comments on a page.", { page: PAGE }, ["page"], lookup("notion.pages", "page", "id", "title", "comments")),
  tool("get_page_history", "List who edited a page and when, newest first.", { page: PAGE }, ["page"], lookup("notion.pages", "page", "id", "title", "history")),
  tool("list_recent_pages", "List the pages edited most recently.", { limit: LIMIT }, [], find("notion.pages", { date: "last_edited_at", fields: ["id", "title", "parent", "last_edited_by", "last_edited_at"] })),
  tool("list_databases", "List the workspace's databases.", {}, [], find("notion.databases", { fields: ["id", "title", "description"] })),
  tool("get_database", "Get a database's columns.", { database: DATABASE }, ["database"], lookup("notion.databases", "database", "id", "title", "columns")),
  tool("query_database", "Get a database's rows, or only the rows that mention some words. Use this for tracked lists, like incidents or the hiring pipeline. Returns each row's values, keyed by column name.", { database: DATABASE, query: QUERY }, ["database"], queryDatabase),
  tool("get_users", "List the people in the workspace.", {}, [], find("notion.users")),
  tool("get_teams", "List the workspace's teamspaces.", {}, [], find("notion.teams")),
  tool("create_pages", "Create a page, with content in Markdown.", { parent: text("Parent page ID or title."), title: text("Title."), content: text("Content, in Markdown.") }, ["title"], change("create this page")),
  tool("update_page", "Change a page's title, properties, or content.", { page: PAGE, title: text("New title."), properties: text("Properties to change, as JSON."), content: text("Content, in Markdown."), mode: oneOf(["replace", "append"], "Whether to replace the content or add to it.") }, ["page"], change("update this page")),
  tool("move_pages", "Move pages under another page.", { pages: strings("Page IDs or titles."), parent: text("New parent page ID or title.") }, ["pages", "parent"], change("move these pages")),
  tool("duplicate_page", "Make a copy of a page.", { page: PAGE }, ["page"], change("duplicate this page")),
  tool("create_database", "Create a database.", { parent: text("Parent page ID or title."), title: text("Title."), columns: strings("Column names.") }, ["parent", "title"], change("create this database")),
  tool("update_database", "Rename a database or change its columns.", { database: DATABASE, title: text("New title."), columns: strings("Columns it should have.") }, ["database"], change("update this database")),
  tool("add_database_row", "Add a row to a database.", { database: DATABASE, values: text("The row's values, as JSON keyed by column.") }, ["database", "values"], change("add this row")),
  tool("create_comment", "Comment on a page.", { page: PAGE, body: text("Comment.") }, ["page", "body"], change("post this comment")),
  tool("archive_page", "Move a page to the trash.", { page: PAGE }, ["page"], change("archive this page")),
];

const EVENT_ID = text("An event ID, like ev-postmortem, from calendar_list_events or calendar_search_events.");
const DATE = text("A day in ISO 8601, like 2026-10-07.");

// The times Maya is busy on a day, from her own calendar, in order.
function busy(date: unknown): Array<{ start: string; end: string }> {
  return records("calendar.events")
    .filter((event) => event.calendar === "maya@larkspur.example" && String(event.start).startsWith(String(date)))
    .map((event) => ({ start: String(event.start), end: String(event.end) }))
    .sort((a, b) => toTime(a.start) - toTime(b.start));
}

// The gaps between busy times, from 9 AM to 6 PM Pacific, that are long enough.
const findFreeTime: Runner = (args) => {
  const minutes = Number(args.minutes) || 30;
  const clock = (time: number) => new Date(time - 7 * 3_600_000).toISOString().slice(11, 16);
  const free: Array<{ start: string; end: string }> = [];
  let cursor = toTime(`${args.date}T09:00`);
  for (const block of [...busy(args.date), { start: `${args.date}T18:00`, end: `${args.date}T18:00` }]) {
    if (toTime(block.start) - cursor >= minutes * 60_000) free.push({ start: clock(cursor), end: clock(toTime(block.start)) });
    cursor = Math.max(cursor, toTime(block.end));
  }
  return { status: "ok", data: { date: args.date, free } };
};

const calendar: Spec[] = [
  tool("list_calendars", "List the calendars you can see.", {}, [], find("calendar.calendars")),
  tool("list_events", "List events in a time range, in the order they happen. To see one day, pass after as that day and before as the next day.", { calendar: text("Calendar ID. Defaults to every calendar you can see."), after: text("Start of the range, like 2026-10-07."), before: text("End of the range, like 2026-10-08."), query: QUERY, limit: LIMIT }, [], find("calendar.events", { filters: { calendar: "calendar" }, search: ["title", "description", "attendees"], date: "start", order: "oldest" })),
  tool("get_event", "Get an event with its attendees and their responses, location, and description.", { event_id: EVENT_ID }, ["event_id"], get("calendar.events", "event_id")),
  tool("search_events", "Search events by words in their title, description, or attendees.", { query: QUERY, after: AFTER, before: BEFORE, limit: LIMIT }, ["query"], find("calendar.events", { search: ["title", "description", "attendees"], date: "start", order: "oldest" })),
  tool("get_freebusy", "Get the times you're busy on a day, without what the events are. Returns the date and the busy stretches, each with its start and end time.", { date: DATE }, ["date"], (args) => ({ status: "ok", data: { date: args.date, busy: busy(args.date) } })),
  tool("find_free_time", "Find free time on a day between 9 AM and 6 PM. Returns the date and the free stretches, each with its start and end time.", { date: DATE, minutes: integer("How long the free time needs to be, in minutes. Defaults to 30.") }, ["date"], findFreeTime),
  tool("get_settings", "Get your calendar settings: time zone and working hours.", {}, [], () => ({ status: "ok", data: { time_zone: "America/Los_Angeles", working_hours: "9 AM to 6 PM, Monday to Friday" } })),
  tool("create_event", "Create an event and invite people.", { title: text("Title."), start: text("Start, like 2026-10-07T14:00."), end: text("End."), attendees: strings("Names or emails to invite."), location: text("Location."), description: text("Description.") }, ["title", "start", "end"], change("create this event")),
  tool("update_event", "Change an event's time, title, attendees, location, or description.", { event_id: EVENT_ID, title: text("New title."), start: text("New start."), end: text("New end."), location: text("New location."), description: text("New description.") }, ["event_id"], change("update this event")),
  tool("delete_event", "Delete an event and tell its attendees.", { event_id: EVENT_ID }, ["event_id"], change("delete this event")),
  tool("respond_to_event", "Accept, decline, or tentatively accept an invitation.", { event_id: EVENT_ID, response: oneOf(["accepted", "declined", "tentative"], "Your response.") }, ["event_id", "response"], change("send this response")),
  tool("add_attendees", "Invite more people to an event.", { event_id: EVENT_ID, attendees: strings("Names or emails to invite.") }, ["event_id", "attendees"], change("invite these people")),
  tool("quick_add", 'Create an event from a sentence, like "Lunch with Ava on Friday at noon".', { text: text("The sentence.") }, ["text"], change("create this event")),
];

const MESSAGE = text("An email's message ID, like msg-01, from gmail_search_emails or gmail_read_thread.");
const MESSAGE_IDS = strings("Email message IDs, like msg-01.");
const EMAIL_SUMMARY = ["message_id", "thread_id", "from", "to", "subject", "date", "snippet", "unread"];

const gmail: Spec[] = [
  tool("search_emails", "Search your email by words, sender, recipient, label, or date, best matches first. Returns each email's sender, subject, date, and the start of its text. Read a whole email with gmail_read_email, or an email and its replies with gmail_read_thread.", { query: QUERY, from: text("Sender's name or address."), to: text("Recipient's name or address."), label: text("Label, like Support or Alerts."), unread: boolean("Only unread emails."), after: AFTER, before: BEFORE, limit: LIMIT }, [], find("gmail.messages", { filters: { from: "from", to: ["to", "cc"], label: "labels", unread: "unread" }, search: ["subject", "body", "from"], date: "date", fields: EMAIL_SUMMARY })),
  tool("read_email", "Read an email.", { message_id: MESSAGE }, ["message_id"], get("gmail.messages", "message_id", { omit: ["snippet"] })),
  tool("read_thread", "Read every email in a thread, oldest first. Use this to see whether anyone replied to an email, and what they said.", { thread_id: text("Thread ID, like th-bluebird.") }, ["thread_id"], find("gmail.messages", { filters: { thread_id: "thread_id" }, date: "date", order: "oldest", omit: ["snippet"] })),
  tool("list_unread", "List the unread emails in your inbox, newest first.", { limit: LIMIT }, [], find("gmail.messages", { where: { unread: true }, date: "date", fields: EMAIL_SUMMARY })),
  tool("list_labels", "List your labels and how many unread emails each has.", {}, [], find("gmail.labels")),
  tool("list_drafts", "List your drafts.", {}, [], find("gmail.drafts", { date: "updated_at" })),
  tool("get_draft", "Read a draft.", { draft_id: text("Draft ID.") }, ["draft_id"], get("gmail.drafts", "draft_id")),
  tool("get_attachments", "Get the text of an email's attachments.", { message_id: MESSAGE }, ["message_id"], get("gmail.messages", "message_id", { field: "attachments" })),
  tool("get_profile", "Get your email address and how many emails and threads you have.", {}, [], () => ({ status: "ok", data: { email: "maya@larkspur.example", messages: 18412, threads: 9830 } })),
  tool("send_email", "Send an email.", { to: strings("Recipients."), cc: strings("People to copy."), subject: text("Subject."), body: text("Body.") }, ["to", "subject", "body"], change("send this email")),
  tool("reply_to_email", "Reply to an email.", { message_id: MESSAGE, body: text("The reply."), reply_all: boolean("Reply to everyone on the email.") }, ["message_id", "body"], change("send this reply")),
  tool("forward_email", "Forward an email.", { message_id: MESSAGE, to: strings("Recipients."), note: text("A note above the forwarded email.") }, ["message_id", "to"], change("forward this email")),
  tool("create_draft", "Save a draft.", { to: strings("Recipients."), subject: text("Subject."), body: text("Body.") }, ["body"], change("save this draft")),
  tool("update_draft", "Change a draft.", { draft_id: text("Draft ID."), to: strings("Recipients."), subject: text("Subject."), body: text("Body.") }, ["draft_id"], change("update this draft")),
  tool("modify_labels", "Add labels to emails or remove them.", { message_ids: MESSAGE_IDS, add: strings("Labels to add."), remove: strings("Labels to remove.") }, ["message_ids"], change("change these labels")),
  tool("archive_emails", "Archive emails.", { message_ids: MESSAGE_IDS }, ["message_ids"], change("archive these emails")),
  tool("mark_as_read", "Mark emails as read.", { message_ids: MESSAGE_IDS }, ["message_ids"], change("mark these emails read")),
  tool("trash_emails", "Move emails to the trash.", { message_ids: MESSAGE_IDS }, ["message_ids"], change("trash these emails")),
  tool("create_label", "Create a label.", { name: text("Label name.") }, ["name"], change("create this label")),
];

const SENTRY_ISSUE = text("An issue's short ID, like LARKSPUR-WEB-3F2, from sentry_search_issues.");
const PROJECT = text("A project slug, like larkspur-web. sentry_find_projects lists every project.");

const sentry: Spec[] = [
  tool("whoami", "Get the signed-in user's name, email, and organization.", {}, [], () => ({ status: "ok", data: { name: "Maya Chen", email: "maya@larkspur.example", organization: "larkspur" } })),
  tool("find_organizations", "List the organizations you belong to.", {}, [], find("sentry.organizations")),
  tool("find_teams", "List the organization's teams and their members.", {}, [], find("sentry.teams")),
  tool("find_projects", "List the organization's projects.", {}, [], find("sentry.projects", { omit: ["dsn"] })),
  tool("search_issues", "Search issues by words in their error or culprit, or filter by project, status, level, or assignee. Returns the most recently seen first, with how many events and users each has. Use this to find the issue behind an error someone reported, or to see what's breaking right now.", { query: QUERY, project: PROJECT, status: oneOf(["unresolved", "resolved", "ignored", "all"], "Issue status."), level: oneOf(["fatal", "error", "warning", "info"], "Level."), assigned_to: text("Name of the assignee."), after: text("Only issues seen after this time, like 2026-10-06."), limit: LIMIT }, [], find("sentry.issues", { filters: { project: "project", status: "status", level: "level", assigned_to: "assigned_to" }, search: ["title", "culprit"], date: "last_seen", omit: ["tags", "activity"] })),
  tool("get_issue_details", "Get an issue: its error, culprit, when it was first and last seen, event and user counts, release, assignee, linked issues, and how its events break down by tag. Use this to see how bad an issue is and who's on it.", { issue_id: SENTRY_ISSUE }, ["issue_id"], get("sentry.issues", "issue_id", { omit: ["activity"] })),
  tool("get_issue_activity", "Get an issue's activity, like assignments, status changes, and links.", { issue_id: SENTRY_ISSUE }, ["issue_id"], get("sentry.issues", "issue_id", { field: "activity" })),
  tool("get_issue_tag_values", "Get how an issue's events break down by each tag, like browser or url.", { issue_id: SENTRY_ISSUE }, ["issue_id"], get("sentry.issues", "issue_id", { field: "tags" })),
  tool("list_issue_events", "List an issue's events, newest first.", { issue_id: SENTRY_ISSUE, limit: LIMIT }, ["issue_id"], find("sentry.events", { filters: { issue_id: "issue_id" }, date: "timestamp", omit: ["stacktrace"] })),
  tool("get_event", "Get an event with its stack trace, user, release, and tags.", { event_id: text("Event ID, like evt-91f2.") }, ["event_id"], get("sentry.events", "event_id")),
  tool("get_latest_event", "Get an issue's latest event, with its stack trace. Use this to see the stack trace and which user an error affected.", { issue_id: SENTRY_ISSUE }, ["issue_id"], first("sentry.events", { filters: { issue_id: "issue_id" }, date: "timestamp" })),
  tool("search_events", "Search events in every project by words in their message, URL, or user, newest first.", { query: QUERY, project: PROJECT, after: AFTER, before: BEFORE, limit: LIMIT }, ["query"], find("sentry.events", { filters: { project: "project" }, search: ["message", "url", "user"], date: "timestamp", omit: ["stacktrace"] })),
  tool("find_releases", "List a project's releases, newest first, with how many sessions were crash-free. Use this to see whether a release made things worse.", { project: PROJECT, limit: LIMIT }, [], find("sentry.releases", { filters: { project: "project" }, date: "date_released" })),
  tool("get_release", "Get a release: when it shipped, how many commits it has, and how many new issues it brought.", { version: text("Release version, like web@2.31.0.") }, ["version"], get("sentry.releases", "version")),
  tool("get_trace_details", "Get a trace: its spans and how long each took.", { trace_id: text("Trace ID, like trace-4c1a.") }, ["trace_id"], get("sentry.traces", "trace_id")),
  tool("find_dsns", "Get the DSN a project's SDK sends events to.", { project: PROJECT }, ["project"], get("sentry.projects", "project", { field: "dsn" })),
  tool("update_issue", "Resolve, ignore, or reopen an issue, or assign it.", { issue_id: SENTRY_ISSUE, status: oneOf(["resolved", "ignored", "unresolved"], "New status."), assigned_to: text("Name of the new assignee.") }, ["issue_id"], change("update this issue")),
  tool("create_project", "Create a project.", { name: text("Project name."), platform: text("Platform, like node or javascript-react."), team: text("Team slug.") }, ["name", "platform"], change("create this project")),
  tool("update_project", "Rename a project or change its team or platform.", { project: PROJECT, name: text("New name."), team: text("New team slug."), platform: text("New platform.") }, ["project"], change("update this project")),
  tool("create_team", "Create a team.", { name: text("Team name.") }, ["name"], change("create this team")),
  tool("create_dsn", "Create a new DSN for a project.", { project: PROJECT, name: text("A name for the DSN.") }, ["project"], change("create this DSN")),
];

const CUSTOMER = text("A customer ID, like cus_QbLuBk7Ze2, or part of the customer's name, like Bluebird.");
const CUSTOMER_FIELDS = ["customer", "customer_name"];
const SUBSCRIPTION = text("A subscription ID, like sub_1QbLuB, from stripe_list_subscriptions.");
const INVOICE = text("An invoice ID, like in_1QbL9x, from stripe_list_invoices.");

const stripe: Spec[] = [
  tool("retrieve_balance", "Get the account's available and pending balance. Amounts are in cents.", {}, [], () => ({ status: "ok", data: DATA.stripe.balance })),
  tool("list_customers", "List customers, newest first, optionally by email or name.", { email: text("Email address."), name: text("Name."), limit: LIMIT }, [], find("stripe.customers", { filters: { email: "email", name: "name" }, date: "created" })),
  tool("search_customers", "Search customers by words in their name or email.", { query: QUERY, limit: LIMIT }, ["query"], find("stripe.customers", { search: ["name", "email"], date: "created" })),
  tool("retrieve_customer", "Get a customer with their plan and payment method. Use this to find a customer's ID from their name.", { customer: CUSTOMER }, ["customer"], lookup("stripe.customers", "customer", "id", "name")),
  tool("list_payment_intents", "List payments, newest first, optionally by customer, status, or time. Amounts are in cents. Use this to see whether a customer was charged, how much, and whether the payment went through. Refunds are listed separately, by stripe_list_refunds.", { customer: CUSTOMER, status: oneOf(["succeeded", "processing", "requires_payment_method", "canceled"], "Payment status."), after: AFTER, before: BEFORE, limit: LIMIT }, [], find("stripe.payment_intents", { filters: { customer: CUSTOMER_FIELDS, status: "status" }, date: "created" })),
  tool("retrieve_payment_intent", "Get a payment. The amount is in cents.", { payment_intent: text("Payment ID, like pi_3QbL01.") }, ["payment_intent"], get("stripe.payment_intents", "payment_intent")),
  tool("list_refunds", "List refunds, newest first, optionally for one payment or customer. Amounts are in cents. Use this to check whether a payment was already refunded.", { payment_intent: text("Payment ID."), customer: CUSTOMER, limit: LIMIT }, [], find("stripe.refunds", { filters: { payment_intent: "payment_intent", customer: CUSTOMER_FIELDS }, date: "created" })),
  tool("list_subscriptions", "List subscriptions, optionally by customer, status, or plan. Amounts are in cents. Use this to see a customer's plan, or who is past due.", { customer: CUSTOMER, status: oneOf(["active", "past_due", "canceled", "trialing", "all"], "Subscription status."), plan: text("Plan name, like Studio."), limit: LIMIT }, [], find("stripe.subscriptions", { filters: { customer: CUSTOMER_FIELDS, status: "status", plan: "plan" } })),
  tool("retrieve_subscription", "Get a subscription.", { subscription: SUBSCRIPTION }, ["subscription"], get("stripe.subscriptions", "subscription")),
  tool("list_invoices", "List invoices, newest first, optionally by customer or status. Amounts are in cents.", { customer: CUSTOMER, status: oneOf(["draft", "open", "paid", "void", "uncollectible"], "Invoice status."), limit: LIMIT }, [], find("stripe.invoices", { filters: { customer: CUSTOMER_FIELDS, status: "status" }, date: "created" })),
  tool("retrieve_invoice", "Get an invoice and its lines.", { invoice: INVOICE }, ["invoice"], get("stripe.invoices", "invoice")),
  tool("list_products", "List products.", {}, [], find("stripe.products")),
  tool("list_prices", "List prices, optionally for one product. Amounts are in cents.", { product: text("Product ID, like prod_studio.") }, [], find("stripe.prices", { filters: { product: "product" } })),
  tool("list_coupons", "List coupons.", { limit: LIMIT }, [], find("stripe.coupons")),
  tool("retrieve_coupon", "Get a coupon.", { coupon: text("Coupon ID, like FALL25.") }, ["coupon"], get("stripe.coupons", "coupon")),
  tool("list_promotion_codes", "List promotion codes and whether customers can use them.", { coupon: text("Coupon ID."), active: boolean("Only active codes.") }, [], find("stripe.promotion_codes", { filters: { coupon: "coupon", active: "active" } })),
  tool("list_disputes", "List disputes, newest first.", { limit: LIMIT }, [], find("stripe.disputes", { date: "created" })),
  tool("list_payment_links", "List payment links.", {}, [], find("stripe.payment_links")),
  tool("create_customer", "Create a customer.", { name: text("Name."), email: text("Email address.") }, ["name", "email"], change("create this customer")),
  tool("create_refund", "Refund a payment, in full or in part.", { payment_intent: text("Payment ID."), amount: integer("Amount to refund, in cents. Defaults to the whole payment."), reason: oneOf(["duplicate", "fraudulent", "requested_by_customer"], "Why.") }, ["payment_intent"], change("refund this payment")),
  tool("update_subscription", "Change a subscription's plan or quantity.", { subscription: SUBSCRIPTION, price: text("New price ID."), quantity: integer("New quantity.") }, ["subscription"], change("update this subscription")),
  tool("cancel_subscription", "Cancel a subscription.", { subscription: SUBSCRIPTION, at_period_end: boolean("Cancel at the end of the period instead of now.") }, ["subscription"], change("cancel this subscription")),
  tool("create_invoice", "Create a draft invoice for a customer.", { customer: CUSTOMER, description: text("Description.") }, ["customer"], change("create this invoice")),
  tool("finalize_invoice", "Finalize a draft invoice so the customer can pay it.", { invoice: INVOICE }, ["invoice"], change("finalize this invoice")),
  tool("create_coupon", "Create a coupon.", { name: text("Name."), percent_off: integer("Percent off."), amount_off: integer("Amount off, in cents."), duration: oneOf(["once", "repeating", "forever"], "How long it applies.") }, ["name", "duration"], change("create this coupon")),
  tool("update_promotion_code", "Turn a promotion code on or off.", { code: text("The code, like FALL25."), active: boolean("Whether customers can use it.") }, ["code", "active"], change("update this promotion code")),
  tool("create_payment_link", "Create a payment link for a price.", { price: text("Price ID."), quantity: integer("Quantity.") }, ["price"], change("create this payment link")),
  tool("create_product", "Create a product.", { name: text("Name."), description: text("Description.") }, ["name"], change("create this product")),
  tool("create_price", "Create a price for a product.", { product: text("Product ID."), amount: integer("Amount, in cents."), interval: oneOf(["month", "year"], "How often it bills.") }, ["product", "amount", "interval"], change("create this price")),
  tool("update_dispute", "Submit evidence for a dispute.", { dispute: text("Dispute ID."), evidence: text("The evidence.") }, ["dispute", "evidence"], change("submit this evidence")),
];

const SPECS: { [service: string]: Spec[] } = { github, slack, linear, notion, calendar, gmail, sentry, stripe };

// Every tool as a function tool named after its service, like linear_get_issue.
export const TOOLS: Operation[] = SERVICES.flatMap((service) =>
  SPECS[service.key].map((spec) => {
    const name = `${service.key}_${spec.name}`;
    const parameters = { type: "object", properties: spec.params, required: spec.required };
    const tool = { type: "function" as const, name, description: describe(spec, service), parameters };
    return { name, service: service.key, summary: spec.description.split(/(?<=\.) /)[0], tool, run: spec.run };
  }),
);
