import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { type InputItem, type ModelResponse, type ServerToolCall, SpaceXAI } from "@xai-official/sdk";
import { webSearch, xSearch } from "@xai-official/sdk/tools";
import { CRM_TOOLS, type Lookup, SELLER, lookUp } from "./crm.ts";

const client = new SpaceXAI();

// max_turns caps the turns Grok takes with the searches in one request. A call to one of your functions ends
// the request, and the next request counts from zero again, so MAX_REQUESTS is what caps a whole run.
export const MAX_TURNS = 3;
const MAX_REQUESTS = 6;
const DAY_MS = 86_400_000;

export const DEFAULT_COMPANY = "Stripe";

export type NewsItem = { headline: string; detail: string; date: string; sources: string[] };
export type Brief = {
  company: string;
  who_they_are: string;
  whats_new: NewsItem[];
  history: string[];
  talking_points: string[];
  risks: string[];
};
// A search Grok ran on SpaceXAI's servers, with the URLs it returned when the API reports them.
export type Search = { tool: "web" | "x"; kind: string; query: string; sources: string[] };
export type Totals = {
  requests: number;
  cost: number;
  web_searches: number;
  x_searches: number;
  x_posts: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
};
export type Result = { brief: Brief; dropped: string[]; totals: Totals; file: string };

export type BriefEvents = {
  request?: (index: number) => void;
  reasoning?: (text: string) => void;
  search?: (search: Search) => void;
  lookup?: (lookup: Lookup) => void;
  // The totals so far, after each request.
  usage?: (totals: Totals) => void;
  draft?: (brief: Partial<Brief>) => void;
};

const X_SEARCHES: Record<string, string> = {
  x_keyword_search: "X keyword search",
  x_semantic_search: "X semantic search",
  x_user_search: "X user search",
  x_thread_fetch: "X thread",
};

const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    company: { type: "string", description: "The company's name" },
    who_they_are: { type: "string", description: "Two or three sentences on what the company does, how big it is, and where it's headed" },
    whats_new: {
      type: "array",
      description: "Three to five things that happened at the company in the last 30 days, newest first",
      items: {
        type: "object",
        properties: {
          headline: { type: "string", description: "At most ten words" },
          detail: { type: "string", description: "One or two sentences, ending with why it matters for the call" },
          date: { type: "string", format: "date", description: "When it happened" },
          sources: { type: "array", items: { type: "string" }, description: "The URLs it came from, copied exactly from the search results" },
        },
        required: ["headline", "detail", "date", "sources"],
        additionalProperties: false,
      },
    },
    history: {
      type: "array",
      items: { type: "string" },
      description: "Our relationship from the CRM, one fact per item: stage and plan, who we talk to, recent meetings, open deals, and open tickets",
    },
    talking_points: {
      type: "array",
      items: { type: "string" },
      description: "Three to five things to bring up, each tying something new at the company to our relationship",
    },
    risks: { type: "array", items: { type: "string" }, description: "Two to four things that could hurt the call or the deal" },
  },
  required: ["company", "who_they_are", "whats_new", "history", "talking_points", "risks"],
  additionalProperties: false,
};

// Researches the company with the CRM functions and the searches, then writes the brief and saves it to output/.
// Reports each step as it happens, so callers can show which ran in your app and which on SpaceXAI's servers.
export async function prepareBrief(company: string, on: BriefEvents = {}, signal?: AbortSignal): Promise<Result> {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10);
  const input: InputItem[] = [
    { role: "system", content: instructions(today) },
    { role: "user", content: `Prep me for my call with ${company}.` },
  ];
  const tools = [webSearch(), xSearch({ from_date: monthAgo }), ...CRM_TOOLS];
  // Every request resends the conversation so far, and one cache key for the run lets each reuse the last one's cache.
  const cacheKey = `call-brief:${randomUUID()}`;
  // Every source the searches returned, by sourceKey().
  const cited = new Map<string, string>();
  const cite = (url: string) => {
    if (!cited.has(sourceKey(url))) cited.set(sourceKey(url), url);
  };
  const totals: Totals = { requests: 0, cost: 0, web_searches: 0, x_searches: 0, x_posts: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0 };

  for (let request = 1; request <= MAX_REQUESTS; request++) {
    on.request?.(request);
    const outputs: InputItem[] = [];
    const stream = await client.responses.create(
      {
        model: "grok-4.7",
        input,
        tools,
        max_turns: MAX_TURNS,
        // At the default effort, Grok followed up on what it found with a second round of searches, and a run took
        // about 70 seconds instead of 40, for a brief with only a few more specifics.
        reasoning: { effort: "low" },
        text: { format: { type: "json_schema", name: "call_brief", schema: BRIEF_SCHEMA } },
        prompt_cache_key: cacheKey,
        stream: true,
      },
      { signal },
    );
    const response = await stream
      .on("reasoning", (text) => on.reasoning?.(text))
      .on("server_tool_call", (call) => {
        const search = describeSearch(call);
        if (!search) return;
        search.sources.forEach(cite);
        on.search?.(search);
      })
      // SpaceXAI stops at a call to one of your functions and hands it to you. Only what the function returns
      // goes back to Grok, in the next request.
      .on("client_tool_call", (call) => {
        if (call.type !== "function_call") return;
        const lookup = lookUp(call.name, call.arguments);
        on.lookup?.(lookup);
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(lookup.result) });
      })
      .on("citation", (citation) => cite(citation.url))
      .on("json", (value) => on.draft?.(value as Partial<Brief>))
      .done();
    count(totals, response);
    on.usage?.({ ...totals });
    if (outputs.length) {
      // toInput() carries Grok's encrypted reasoning and search results into the next request, so nothing has to
      // be stored on SpaceXAI's servers between requests.
      input.push(...response.toInput(), ...outputs);
      continue;
    }
    const { brief, dropped } = keepCited(response.toJson() as Brief, cited);
    return { brief, dropped, totals, file: await saveBrief(brief, today) };
  }
  throw new Error(`Grok was still calling functions after ${MAX_REQUESTS} requests.`);
}

function instructions(today: string): string {
  return `You prepare account executives at ${SELLER} for sales calls. Today is ${today}.

Research the company in this order:
1. Look it up in our CRM: call find_account, then get_contacts, get_meetings, get_deals, and get_tickets all at once.
2. Then search the web and X for news about the company from the last 30 days, like launches, funding, earnings, leadership changes, layoffs, outages, and what people are saying about it.

Search only for public information about the company. Never put anything from the CRM in a search, like people's names, amounts, or ticket details.
If the company isn't in the CRM, say so in the history and write the rest from the searches.

Then write the brief. Keep every item to one or two short sentences, and use only facts from the CRM and the search results.`;
}

// X searches arrive as custom tool calls named after the kind of search, with their arguments as JSON.
function describeSearch(call: ServerToolCall): Search | undefined {
  if (call.type === "web_search_call") {
    const { action } = call;
    if (action.type === "search") {
      const sources = (action.sources ?? []).flatMap((source) => (source.url ? [source.url] : []));
      return { tool: "web", kind: "Web search", query: action.query, sources };
    }
    return { tool: "web", kind: action.type === "open_page" ? "Opened a page" : "Searched a page", query: action.url, sources: [] };
  }
  if (call.type === "custom_tool_call" && call.name in X_SEARCHES) {
    const args = parseJson(call.input ?? "");
    const query = typeof args?.query === "string" ? args.query : Object.values(args ?? {}).join(" ");
    return { tool: "x", kind: X_SEARCHES[call.name], query, sources: [] };
  }
  return undefined;
}

// Grok cites every source its searches return, so a source that isn't among them came from somewhere else, like
// Grok's memory. Those are dropped, along with any news left without a source, and the rest are written the way the
// search returned them. The brief's own citations only cover the searches in its request, so the sources each web
// search returned count too.
function keepCited(brief: Brief, cited: Map<string, string>): { brief: Brief; dropped: string[] } {
  const dropped: string[] = [];
  const whats_new = brief.whats_new.flatMap((item) => {
    const sources = [...new Set(item.sources.flatMap((url) => cited.get(sourceKey(url)) ?? []))];
    dropped.push(...item.sources.filter((url) => !cited.has(sourceKey(url))));
    return sources.length ? [{ ...item, sources }] : [];
  });
  return { brief: { ...brief, whats_new }, dropped };
}

// Grok sometimes writes a URL a little differently than the search returned it, so URLs are compared without the
// protocol, "www.", or a trailing slash, and posts on X by their ID.
function sourceKey(url: string): string {
  const post = url.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/\w+\/status\/(\d+)/)?.[1];
  return post ? `x:${post}` : url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
}

function count(totals: Totals, response: ModelResponse): void {
  const { usage } = response;
  const tools = usage.server_side_tool_usage_details;
  totals.requests++;
  totals.cost += usage.cost_usd ?? 0;
  totals.web_searches += tools?.web_search_calls ?? 0;
  totals.x_searches += tools?.x_search_calls ?? 0;
  totals.x_posts += tools?.x_posts_fetched ?? 0;
  totals.input_tokens += usage.input_tokens;
  totals.cached_tokens += usage.input_tokens_details.cached_tokens;
  totals.output_tokens += usage.output_tokens;
}

async function saveBrief(brief: Brief, date: string): Promise<string> {
  const file = `output/${slugify(brief.company)}-${date}.md`;
  await mkdir("output", { recursive: true });
  await writeFile(file, toMarkdown(brief, date));
  return file;
}

function toMarkdown(brief: Brief, date: string): string {
  const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
  const news = brief.whats_new.map((item) => {
    const links = item.sources.map((url) => `[${new URL(url).hostname.replace(/^www\./, "")}](${url})`).join(", ");
    return `- **${item.headline}** (${item.date}). ${item.detail} ${links}`;
  });
  const points = brief.talking_points.map((point, index) => `${index + 1}. ${point}`);
  return `# Call brief: ${brief.company}

Prepared ${date}

## Who they are

${brief.who_they_are}

## What's new

${news.join("\n") || "Nothing with a source the searches returned."}

## Our history

${list(brief.history)}

## Talking points

${points.join("\n")}

## Risks

${list(brief.risks)}
`;
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brief";
}
