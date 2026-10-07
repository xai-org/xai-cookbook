import type { Tool } from "@xai-official/sdk";
import { DATA } from "./data.ts";
import { FIELDS } from "./fields.ts";

// The tools read Larkspur's made-up data, so every one of them works without an account anywhere. A
// real agent would get the same kind of tools from each service's MCP server.

type Row = { [field: string]: unknown };
type Args = { [name: string]: unknown };
export type Result = { status: "ok" | "dry run" | "error"; data: unknown };
// What a runner returns, so the tool's description can say so.
type Returns = { kind: "list"; path: string; options: FindOptions } | { kind: "record"; path: string; field?: string; fields?: string[]; omit?: string[]; latest?: boolean } | { kind: "change" };
export type Runner = ((args: Args) => Result) & { returns?: Returns };
type Param = { type: string; description: string; enum?: string[]; items?: { type: string } };
export type Spec = { name: string; description: string; params: { [name: string]: Param }; required: string[]; run: Runner };
export type Operation = { name: string; service: string; summary: string; tool: Extract<Tool, { type: "function" }>; run: Runner };

export const text = (description: string): Param => ({ type: "string", description });
export const integer = (description: string): Param => ({ type: "integer", description });
export const boolean = (description: string): Param => ({ type: "boolean", description });
export const strings = (description: string): Param => ({ type: "array", items: { type: "string" }, description });
export const oneOf = (values: string[], description: string): Param => ({ type: "string", enum: values, description });
export const QUERY = text('Words to search for, like "checkout crash". Words shorter than three letters and common words like "the" are ignored, and results that contain more of the words come first, so a distinctive word works better than a whole sentence.');
export const LIMIT = integer("The most results to return, from 1 to 50. Defaults to 10. The response's total says how many matched in all, so you can tell when there are more.");
export const AFTER = text("Only results from after this time, in ISO 8601, like 2026-10-06 for the start of that day or 2026-10-06T09:00 for 9 AM. Times without an offset are Pacific Time.");
export const BEFORE = text("Only results from before this time, in ISO 8601, like 2026-10-07 for the end of October 6. Times without an offset are Pacific Time.");

export function tool(name: string, description: string, params: Spec["params"], required: string[], run: Runner): Spec {
  return { name, description, params, required, run };
}

const COLLECTIONS: { [service: string]: { [name: string]: unknown } } = DATA;

// The records in a collection, like "github.pulls".
export function records(path: string): Row[] {
  const [service, name] = path.split(".");
  return COLLECTIONS[service][name] as Row[];
}

type FindOptions = {
  // Which record fields each argument filters on, like { customer: ["customer", "customer_name"] }.
  filters?: { [arg: string]: string | string[] };
  // The fields the query argument searches.
  search?: string[];
  // The time field that after and before compare, and that results are sorted by, newest first.
  date?: string;
  order?: "newest" | "oldest";
  // Values every result has, like { unread: true }.
  where?: Row;
  // Only these fields in each result, or every field but these.
  fields?: string[];
  omit?: string[];
};

// Lists the records that match every filter Grok passed, best matches for the query first.
export function find(path: string, options: FindOptions = {}): Runner {
  const run = (args: Args): Result => {
    const query = typeof args.query === "string" ? words(args.query) : [];
    const found = records(path).flatMap((record) => {
      if (Object.entries(options.where ?? {}).some(([field, value]) => record[field] !== value)) return [];
      for (const [arg, fields] of Object.entries(options.filters ?? {})) {
        if (args[arg] !== undefined && args[arg] !== "" && ![fields].flat().some((field) => matches(record[field], args[arg]))) return [];
      }
      if (options.date && args.after && toTime(record[options.date]) < toTime(args.after)) return [];
      if (options.date && args.before && toTime(record[options.date]) >= toTime(args.before)) return [];
      const haystack = JSON.stringify((options.search ?? []).map((field) => record[field])).toLowerCase();
      const score = query.filter((word) => haystack.includes(word)).length;
      return query.length && !score ? [] : [{ record, score }];
    });
    const sign = options.order === "oldest" ? 1 : -1;
    found.sort((a, b) => b.score - a.score || (options.date ? sign * (toTime(a.record[options.date]) - toTime(b.record[options.date])) : 0));
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
    return { status: "ok", data: { total: found.length, results: found.slice(0, limit).map(({ record }) => project(record, options)) } };
  };
  return Object.assign(run, { returns: { kind: "list", path, options } as const });
}

// The first record find would list, or an error if there's none.
export function first(path: string, options: FindOptions = {}): Runner {
  const run = (args: Args): Result => {
    const { results } = find(path, options)({ ...args, limit: 1 }).data as { results: Row[] };
    return results.length ? { status: "ok", data: results[0] } : notFound(args);
  };
  return Object.assign(run, { returns: { kind: "record", path, fields: options.fields, omit: options.omit, latest: true } as const });
}

// The record whose key fields equal Grok's arguments of the same names, or one of its fields. Names
// and other text can match in part, so "web" finds larkspur/web.
export function get(path: string, keys: string | string[], options: { field?: string; partial?: boolean; omit?: string[] } = {}): Runner {
  const run = (args: Args): Result => {
    const record = records(path).find((record) => [keys].flat().every((key) => same(record[key], args[key], options.partial)));
    if (!record) return notFound(args);
    return { status: "ok", data: options.field ? (record[options.field] ?? []) : project(record, options) };
  };
  return Object.assign(run, { returns: { kind: "record", path, field: options.field, omit: options.omit } as const });
}

// The record whose ID equals Grok's argument or whose name contains it, like a page by ID or title.
export function lookup(path: string, arg: string, id: string, name: string, field?: string): Runner {
  const run = (args: Args): Result => {
    const record = records(path).find((record) => same(record[id], args[arg]) || same(record[name], args[arg], true));
    if (!record) return notFound(args);
    return { status: "ok", data: field ? (record[field] ?? []) : record };
  };
  return Object.assign(run, { returns: { kind: "record", path, field } as const });
}

// For tools that would change something. The workspace is made up, so they say what they would have
// done instead.
export function change(action: string): Runner {
  const run = (args: Args): Result => ({ status: "dry run", data: { dry_run: true, would: action, arguments: args, note: "Larkspur's workspace is made up, so nothing was changed." } });
  return Object.assign(run, { returns: { kind: "change" } as const });
}

// A tool's full description, written the way real MCP servers write theirs: what it does, what it
// returns, field by field, how its arguments match, and notes about the service. That's what makes
// each definition cost a few hundred tokens.
export function describe(spec: Spec, service: { name: string; notes: string }): string {
  const returns = spec.run.returns;
  const parts = [spec.description];
  if (returns?.kind === "list") {
    const { noun } = FIELDS[returns.path];
    const order = !returns.options.date ? "" : returns.options.order === "oldest" ? ", in time order" : ", newest first";
    const ranked = returns.options.search ? " When you pass query, the results that contain more of its words come first." : "";
    parts.push(`Returns an object with total, how many ${plural(noun)} match, and results, the first of them up to limit${order}.${ranked} Each result has ${fieldList(returns.path, returns.options)}.`);
    parts.push(`Filters match any part of a value and ignore case, so "priya" matches Priya Patel, and "me" means Maya. A filter on a list, like labels, matches if any item in it does. Pass several filters to narrow the results instead of raising limit, and leave out the ones you don't need.`);
  } else if (returns?.kind === "record") {
    const { noun, fields } = FIELDS[returns.path];
    parts.push(returns.field ? `Returns the ${noun}'s ${returns.field}: ${fields[returns.field]}.` : `Returns the ${returns.latest ? "latest matching " : ""}${noun} with ${fieldList(returns.path, returns)}.`);
    parts.push("IDs have to match exactly, but names, titles, and other text can match in part. If nothing matches, the result is an error instead of a guess, so look the ID up with a search or list tool first.");
  } else if (returns?.kind === "change") {
    parts.push(`This changes ${service.name} for everyone who uses it, and it can't be undone from here. Only call it when Maya has asked for this change, and check the exact wording with her first if she hasn't given it.`);
  }
  parts.push(service.notes);
  return parts.join("\n\n");
}

function fieldList(path: string, { fields, omit }: { fields?: string[]; omit?: string[] }): string {
  return Object.entries(FIELDS[path].fields)
    .filter(([field]) => (fields ? fields.includes(field) : !omit?.includes(field)))
    .map(([field, meaning]) => `${field} (${meaning})`)
    .join(", ");
}

function plural(noun: string): string {
  if (noun === "person") return "people";
  if (/(s|ch)$/.test(noun)) return `${noun}es`;
  return /[^aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`;
}

function notFound(args: Args): Result {
  return { status: "error", data: { error: `Nothing found for ${JSON.stringify(args)}` } };
}

function project(record: Row, { fields, omit }: { fields?: string[]; omit?: string[] }): Row {
  return Object.fromEntries(Object.entries(record).filter(([field]) => (fields ? fields.includes(field) : !omit?.includes(field))));
}

// Text matches if it contains the argument, a list if any item matches, and "me" is Maya.
function matches(value: unknown, arg: unknown): boolean {
  const wanted = String(arg).toLowerCase() === "me" ? "maya" : String(arg).toLowerCase();
  if (wanted === "all" || wanted === "any") return true;
  if (Array.isArray(value)) return value.some((item) => matches(item, arg));
  if (value === null || value === undefined) return false;
  if (typeof value === "object") return JSON.stringify(value).toLowerCase().includes(wanted);
  return typeof value === "string" ? value.toLowerCase().includes(wanted) : String(value).toLowerCase() === wanted;
}

function same(value: unknown, arg: unknown, partial = false): boolean {
  if (arg === undefined || arg === null || value === undefined || value === null) return false;
  const [have, want] = [String(value).toLowerCase(), String(arg).toLowerCase()];
  return partial && typeof value === "string" ? have.includes(want) : have === want;
}

const STOP_WORDS = new Set(["the", "and", "for", "with", "this", "that", "from", "about", "any", "are", "was", "what", "who"]);
function words(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9#@.$-]+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

// A day like 2026-10-07 means its start, and a time without an offset is Pacific Time, like the data.
export function toTime(value: unknown): number {
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(`${text}T00:00:00-07:00`);
  if (/T\d{2}:\d{2}(:\d{2})?$/.test(text)) return Date.parse(`${text}${text.length === 16 ? ":00" : ""}-07:00`);
  return Date.parse(text);
}
