import { type ServerToolCall, SpaceXAI, type Usage } from "@xai-official/sdk";
import { webSearch, xSearch } from "@xai-official/sdk/tools";

// Every claim is researched at once, so now and then a request fails before Grok answers, for example
// when the API is busy. retryBeforeOutput tries those again, which is safe because nothing has streamed yet.
const client = new SpaceXAI({ retryBeforeOutput: true });

export const SAMPLE_POST = "https://x.com/unusual_whales/status/2106776609457844610";
const MAX_CLAIMS = 4;

export type Claim = { text: string; from: "text" | "image" | "video" };
export type Post = {
  url: string;
  id: string;
  author_name: string;
  username: string;
  text: string;
  posted_at: string;
  media: Array<{ type: "image" | "video"; description: string }>;
  // The images and videos Grok opened to read the post.
  viewed: Viewed[];
};
export type Viewed = { type: "image" | "video"; url: string };
// A tool call Grok made: a web search and the pages it found, a page it opened, or a search on X.
export type Search = { tool: string; detail: string; found: string[] };
export type Source = { url: string; title: string; finding: string; stance: "supports" | "contradicts" | "context" };
export type Verdict = "supported" | "missing_context" | "not_enough_evidence";
export type Check = { claim: Claim; verdict: Verdict; explanation: string; sources: Source[]; dropped: number };
export type Sentence = { text: string; sources: number[] };
// The note's sentences cite its sources by number, starting at 1.
export type Note = { sentences: Sentence[]; sources: Source[] };
// What the run cost as the API reports it, the X posts and web searches it paid for, and the tokens it used.
export type Spend = { cost: number; xPosts: number; webSearches: number; tokens: number };
export type FactCheck = { post: Post; checks: Check[]; note: Note | undefined; spend: Spend; seconds: number };

export type CheckEvents = {
  reasoning?: (text: string) => void;
  tool?: (search: Search) => void;
  viewed?: (viewed: Viewed) => void;
  // The post and its claims so far, while Grok writes them.
  draft?: (draft: Partial<Post & { claims: Claim[] }>) => void;
  read?: (post: Post, claims: Claim[]) => void;
  search?: (index: number, search: Search) => void;
  // Gets the error when a claim's research failed. The claim is then checked as not enough evidence.
  failed?: (index: number, error: Error) => void;
  checked?: (index: number, check: Check) => void;
  writing?: (sources: Source[]) => void;
  note?: (sentences: Sentence[]) => void;
};

const POST_SCHEMA = {
  type: "object",
  properties: {
    author_name: { type: "string", description: "The author's display name" },
    username: { type: "string", description: "The author's X handle, without the @" },
    text: { type: "string", description: "The full text of the post, exactly as written" },
    media: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["image", "video"] },
          description: { type: "string", description: "What it shows, including any text, numbers, or charts in it" },
        },
        required: ["type", "description"],
        additionalProperties: false,
      },
    },
    claims: {
      type: "array",
      maxItems: MAX_CLAIMS,
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "The claim, restated so it makes sense without the post" },
          from: { type: "string", enum: ["text", "image", "video"], description: "Where in the post the claim is made" },
        },
        required: ["text", "from"],
        additionalProperties: false,
      },
    },
  },
  required: ["author_name", "username", "text", "media", "claims"],
  additionalProperties: false,
};

// The sources come first, so Grok weighs the evidence before it settles on a verdict.
const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL exactly as it appeared in your search results" },
          title: { type: "string", description: "The page's title, or for a post on X, its author and a few words of it" },
          finding: { type: "string", description: "What this source says about the claim, in one sentence" },
          stance: { type: "string", enum: ["supports", "contradicts", "context"] },
        },
        required: ["url", "title", "finding", "stance"],
        additionalProperties: false,
      },
    },
    verdict: { type: "string", enum: ["supported", "missing_context", "not_enough_evidence"] },
    explanation: { type: "string", description: "Why, in one or two sentences, based only on the sources" },
  },
  required: ["sources", "verdict", "explanation"],
  additionalProperties: false,
};

const RESEARCH_PROMPT = `You fact-check one claim from a post on X. Search the web and X for the best evidence: official data and filings, primary documents, and reputable reporting. Then list the sources you relied on and judge the claim:
- supported: the sources confirm the claim as stated.
- missing_context: the sources show the claim is wrong, outdated, exaggerated, or misleading without more context.
- not_enough_evidence: the sources you found don't settle it. Say so instead of guessing.
List only sources that came back in your searches, with their URLs exactly as they appeared.`;

const NOTE_PROMPT = `You write notes that appear under posts on X, like Community Notes: short, neutral, and specific, for readers who just saw the post. Use only the fact-checks and numbered sources you're given.
- Write two to four sentences. Lead with what the post gets wrong or leaves out, if anything. If its claims hold up, say so briefly.
- Each sentence states facts from the sources and lists the numbers of the sources it comes from.
- Give numbers and dates where the sources have them. Don't mention fact-checks, verdicts, or Grok, and don't put URLs or source numbers in the text.`;

// Reads the post, researches each of its claims at the same time, and writes a note from the sources that
// held up, reporting each step as it happens so callers can show progress while Grok works.
export async function factCheck(link: string, deep: boolean, on: CheckEvents = {}, signal?: AbortSignal): Promise<FactCheck> {
  const started = Date.now();
  const spend: Spend = { cost: 0, xPosts: 0, webSearches: 0, tokens: 0 };
  const { post, claims } = await readPost(link, on, spend, signal);
  on.read?.(post, claims);
  const checks = await Promise.all(
    claims.map(async (claim, index) => {
      let check: Check;
      // One failed request shouldn't sink the other claims, so a claim whose research still fails after
      // the client's retries gets no evidence.
      try {
        check = await checkClaim(claim, post, deep, (search) => on.search?.(index, search), spend, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        const failure = error instanceof Error ? error : new Error(String(error));
        on.failed?.(index, failure);
        check = { claim, verdict: "not_enough_evidence", explanation: `The research failed: ${failure.message}`, sources: [], dropped: 0 };
      }
      on.checked?.(index, check);
      return check;
    }),
  );
  const note = await writeNote(post, checks, on, spend, signal);
  return { post, checks, note, spend, seconds: Math.round((Date.now() - started) / 1000) };
}

async function readPost(link: string, on: CheckEvents, spend: Spend, signal?: AbortSignal): Promise<{ post: Post; claims: Claim[] }> {
  const id = link.match(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/\w+\/status\/(\d+)/)?.[1];
  if (!id) throw new Error("That isn't a link to a post on X. It should look like https://x.com/user/status/123.");
  const viewed: Viewed[] = [];
  const cited = new Set<string>();
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      reasoning: { effort: "low" },
      input: `Find this post on X and read it, including its images and video: ${link}
Then list the factual claims it makes that can be checked against public sources, up to ${MAX_CLAIMS}, most important first. Restate each claim so it makes sense without the post, keeping its numbers, names, and dates. Leave out opinions, predictions, and jokes. If the post makes no claims that can be checked, return an empty list.`,
      tools: [xSearch({ enable_image_understanding: true, enable_video_understanding: true })],
      text: { format: { type: "json_schema", name: "post", schema: POST_SCHEMA } },
      stream: true,
    },
    { signal },
  );
  const response = await stream
    .on("reasoning", (text) => on.reasoning?.(text))
    .on("server_tool_call", (call) => {
      const search = describe(call);
      if (!search) return;
      on.tool?.(search);
      // Grok watches a post's video with view_x_video, and looks at its images by opening them on X's
      // image server.
      const media: Viewed | undefined =
        search.tool === "view_x_video" ? { type: "video", url: search.detail }
        : search.detail.startsWith("https://pbs.twimg.com/") ? { type: "image", url: search.detail }
        : undefined;
      if (media) {
        viewed.push(media);
        on.viewed?.(media);
      }
    })
    .on("json", (draft) => on.draft?.(draft as Partial<Post & { claims: Claim[] }>))
    .on("citation", (citation) => cited.add(urlKey(citation.url)))
    .done();
  track(spend, response.usage);
  const { claims, ...read } = response.toJson() as Omit<Post, "url" | "id" | "posted_at" | "viewed"> & { claims: Claim[] };
  // Grok cites the post when X Search returned it, so a post that isn't cited wasn't found.
  if (!cited.has(urlKey(link))) throw new Error("Couldn't find that post on X. Check the link, or try again in a moment.");
  return { post: { ...read, url: link, id, posted_at: postedAt(id), viewed }, claims: claims.slice(0, MAX_CLAIMS) };
}

async function checkClaim(claim: Claim, post: Post, deep: boolean, onSearch: (search: Search) => void, spend: Spend, signal?: AbortSignal): Promise<Check> {
  const cited = new Set<string>();
  const media = claim.from === "text" ? "" : `\nThe claim is made in the post's ${claim.from}: ${post.media.map((item) => item.description).join(" ")}`;
  const stream = await client.responses.create(
    {
      model: deep ? "grok-4.20-multi-agent" : "grok-4.7",
      // For the multi-agent model, the effort sets how many agents work on the claim: low or medium is 4,
      // high or xhigh is 16. For grok-4.7, low keeps each claim to a few searches and seconds of thinking.
      reasoning: { effort: "low" },
      // The SDK asks for encrypted reasoning when a response isn't stored, and the multi-agent model answers
      // with every agent's encrypted state, which can make one stream event bigger than the 1 MiB the SDK
      // reads. Storing the response, which is the API's default, leaves that state out.
      store: deep,
      input: [
        { role: "system", content: RESEARCH_PROMPT },
        { role: "user", content: `Claim: ${claim.text}\n\nFrom a post by @${post.username} published ${post.posted_at.slice(0, 10)}:\n${post.text}${media}` },
      ],
      tools: [webSearch(), xSearch()],
      // Adds the pages each web search found to its tool call, so they can be shown as the searches finish.
      include: ["web_search_call.action.sources"],
      text: { format: { type: "json_schema", name: "research", schema: RESEARCH_SCHEMA } },
      stream: true,
    },
    { signal },
  );
  const response = await stream
    .on("server_tool_call", (call) => {
      const search = describe(call);
      if (search) onSearch(search);
    })
    .on("citation", (citation) => cited.add(urlKey(citation.url)))
    .done();
  track(spend, response.usage);
  const { sources, verdict, explanation } = response.toJson() as { sources: Source[]; verdict: Verdict; explanation: string };
  // Grok writes its own list of sources, but only the ones that came back as citations were really returned
  // by a search, so the rest are dropped.
  const kept = sources.filter((source) => cited.has(urlKey(source.url)));
  const settled = settle(verdict, kept);
  return {
    claim,
    verdict: settled,
    explanation: settled === verdict ? explanation : "None of the sources that came back from the searches back this up.",
    sources: kept,
    dropped: sources.length - kept.length,
  };
}

// A verdict stands only if a source that came back as a citation backs it: supported needs one that supports
// the claim, and missing context needs one that contradicts it or adds context. Anything else is not enough
// evidence.
function settle(verdict: Verdict, sources: Source[]): Verdict {
  if (verdict === "supported" && sources.some((source) => source.stance === "supports")) return verdict;
  if (verdict === "missing_context" && sources.some((source) => source.stance !== "supports")) return verdict;
  return "not_enough_evidence";
}

async function writeNote(post: Post, checks: Check[], on: CheckEvents, spend: Spend, signal?: AbortSignal): Promise<Note | undefined> {
  const sources = [...new Map(checks.flatMap((check) => check.sources).map((source) => [urlKey(source.url), source])).values()];
  if (!sources.length) return undefined;
  on.writing?.(sources);
  const number = (source: Source) => sources.findIndex((other) => urlKey(other.url) === urlKey(source.url)) + 1;
  const findings = checks
    .filter((check) => check.sources.length)
    .map((check) => ({
      claim: check.claim.text,
      verdict: check.verdict,
      explanation: check.explanation,
      sources: check.sources.map((source) => ({ number: number(source), title: source.title, finding: source.finding, stance: source.stance })),
    }));
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      reasoning: { effort: "low" },
      input: [
        { role: "system", content: NOTE_PROMPT },
        { role: "user", content: JSON.stringify({ post: { author: `@${post.username}`, published: post.posted_at.slice(0, 10), text: post.text }, fact_checks: findings }) },
      ],
      text: { format: { type: "json_schema", name: "note", schema: noteSchema(sources.length) } },
      stream: true,
    },
    { signal },
  );
  const response = await stream.on("json", (partial) => on.note?.((partial as Partial<Note>).sentences ?? [])).done();
  track(spend, response.usage);
  const { sentences } = response.toJson() as { sentences: Sentence[] };
  return { sentences, sources };
}

// Each sentence lists the sources it comes from by number. The numbers are an enum of the sources that held
// up, so a sentence can't cite anything else, and minItems makes every sentence cite at least one.
function noteSchema(sourceCount: number) {
  return {
    type: "object",
    properties: {
      sentences: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            sources: { type: "array", minItems: 1, items: { type: "integer", enum: Array.from({ length: sourceCount }, (_, i) => i + 1) } },
          },
          required: ["text", "sources"],
          additionalProperties: false,
        },
      },
    },
    required: ["sentences"],
    additionalProperties: false,
  };
}

// Web searches arrive with the query and, with the include above, the pages they found. X Search's tools,
// like x_keyword_search and view_x_video, arrive as custom tool calls with their arguments as JSON, and the
// main argument comes first: the query, the post's ID, or the video's URL.
function describe(call: ServerToolCall): Search | undefined {
  if (call.type === "web_search_call") {
    const { action } = call;
    if (action.type === "search") return { tool: "web_search", detail: action.query, found: (action.sources ?? []).flatMap((source) => source.url ?? []) };
    return { tool: action.type, detail: action.url, found: [] };
  }
  if (call.type !== "custom_tool_call") return undefined;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.input ?? "{}");
  } catch {}
  const detail = Object.values(args).find((value) => typeof value === "string");
  return { tool: call.name, detail: detail ?? "", found: [] };
}

// Citations and the URLs Grok writes can differ in small ways, like a trailing slash, or a post's URL with
// or without its author's handle, so both are reduced to the same key before they're compared.
function urlKey(url: string): string {
  const post = url.match(/(?:x|twitter)\.com\/\w+\/status\/(\d+)/)?.[1];
  if (post) return `x:${post}`;
  try {
    const { hostname, pathname, search } = new URL(url);
    return `${hostname.replace(/^www\./, "")}${pathname.replace(/\/$/, "")}${search}`;
  } catch {
    return url;
  }
}

// A post's ID holds the time it was published: the bits above the lowest 22 count milliseconds since 4 Nov 2010.
function postedAt(id: string): string {
  return new Date(Number((BigInt(id) >> 22n) + 1288834974657n)).toISOString();
}

function track(spend: Spend, usage: Usage): void {
  spend.cost += usage.cost_usd ?? 0;
  spend.xPosts += usage.server_side_tool_usage_details?.x_posts_fetched ?? 0;
  spend.webSearches += usage.server_side_tool_usage_details?.web_search_calls ?? 0;
  spend.tokens += usage.total_tokens;
}
