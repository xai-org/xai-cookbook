import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { type ServerResponse, createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { text } from "node:stream/consumers";
import type { QueryJob, QueryResult } from "./query.ts";

export const MAX_ROWS = 100;
// Rows go into Grok's context, so a few rows of very long values are cut off too.
const MAX_CHARS = 40_000;
export const QUERY_TIMEOUT_MS = 5_000;
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const QUERY_SCRIPT = new URL("./query.ts", import.meta.url);

// A request SpaceXAI made to the server, so callers can show the server's side of a run.
export type ServerRequest = { method: string; tool?: string; ms: number; error?: string };
export type McpServer = {
  // Each answer gets a token of its own, which stops working once Grok is done.
  issueToken: (log?: (request: ServerRequest) => void) => { token: string; revoke: () => void };
  close: () => void;
};
type Answer = { result?: object; error?: { code: number; message: string }; tool?: string; failure?: string };

export const TOOLS = [
  {
    name: "list_tables",
    description: "Lists the tables in the store's SQLite database and how many rows each one has.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "describe_table",
    description: "Shows a table's CREATE TABLE statement, with comments on what the columns hold, and its first three rows.",
    inputSchema: {
      type: "object",
      properties: { table: { type: "string", description: "The table's name" } },
      required: ["table"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "run_query",
    description: `Runs one read-only SELECT statement in SQLite's dialect and returns its columns and at most ${MAX_ROWS} rows. A query that runs longer than ${QUERY_TIMEOUT_MS / 1000} seconds is stopped.`,
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string", description: "A single SELECT statement" } },
      required: ["sql"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];

// Serves the database at `path` as an MCP server over Streamable HTTP, at /mcp on 127.0.0.1.
export async function startMcpServer(path: string, port: number): Promise<McpServer> {
  const db = new DatabaseSync(path, { readOnly: true });
  const tokens = new Map<string, (request: ServerRequest) => void>();

  const server = createServer(async (req, res) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") return reply(res, 404);
    const log = tokens.get(req.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? "");
    if (!log) return reply(res, 401, { error: "A valid bearer token is required" });
    // The server only answers requests, so it has no stream to offer on GET.
    if (req.method !== "POST") return reply(res, 405);

    const message = await text(req).then(JSON.parse).catch(() => undefined);
    if (typeof message?.method !== "string") {
      return reply(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
    }
    // Notifications, like notifications/initialized, have no id and get no answer.
    if (message.id === undefined) {
      log({ method: message.method, ms: 0 });
      return reply(res, 202);
    }
    const started = performance.now();
    const { result, error, tool, failure } = await answer(message.method, message.params ?? {});
    log({ method: message.method, tool, ms: Math.round(performance.now() - started), error: error?.message ?? failure });
    reply(res, 200, { jsonrpc: "2.0", id: message.id, ...(error ? { error } : { result }) });
  });

  async function answer(method: string, params: Record<string, any>): Promise<Answer> {
    if (method === "initialize") {
      const version = PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
      return { result: { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: "store", version: "1.0.0" } } };
    }
    if (method === "ping") return { result: {} };
    if (method === "tools/list") return { result: { tools: TOOLS } };
    if (method !== "tools/call") return { error: { code: -32601, message: `Method not found: ${method}` } };

    const tool = String(params.name);
    // A tool that fails answers with isError instead of a protocol error, so Grok reads what went wrong
    // and can try again.
    try {
      const output = await callTool(tool, params.arguments ?? {});
      return { tool, result: { content: [{ type: "text", text: JSON.stringify(output) }] } };
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      return { tool, failure, result: { content: [{ type: "text", text: failure }], isError: true } };
    }
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "list_tables") return listTables(db);
    if (name === "describe_table") return describeTable(db, String(args.table));
    if (name === "run_query") return runQuery(path, String(args.sql));
    throw new Error(`Unknown tool: ${name}`);
  }

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    issueToken: (log = () => {}) => {
      const token = randomBytes(32).toString("base64url");
      tokens.set(token, log);
      return { token, revoke: () => tokens.delete(token) };
    },
    close: () => {
      server.close();
      db.close();
    },
  };
}

function listTables(db: DatabaseSync) {
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
  return { tables: tables.map(({ name }) => ({ name, rows: db.prepare(`SELECT count(*) AS count FROM "${name}"`).get()?.count })) };
}

function describeTable(db: DatabaseSync, table: string) {
  const schema = db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table);
  if (!schema) throw new Error(`There's no table named ${table}. Call list_tables to see the tables.`);
  // The name matched a table above, so it's safe to put in the SQL.
  return { sql: schema.sql, rows: db.prepare(`SELECT * FROM "${table}" LIMIT 3`).all() };
}

// Runs a query Grok wrote in a child process, which is killed if it takes longer than QUERY_TIMEOUT_MS.
function runQuery(path: string, sql: string): Promise<QueryResult> {
  return new Promise((resolve, reject) => {
    const child = fork(QUERY_SCRIPT, { timeout: QUERY_TIMEOUT_MS, killSignal: "SIGKILL" });
    child.once("message", (message) => {
      const result = message as QueryResult;
      if ("error" in result) reject(new Error(result.error));
      else resolve(result);
    });
    child.once("exit", (code, signal) => {
      reject(new Error(signal ? `The query ran longer than ${QUERY_TIMEOUT_MS / 1000} seconds and was stopped.` : `The query failed with exit code ${code}.`));
    });
    child.send({ path, sql, maxRows: MAX_ROWS, maxChars: MAX_CHARS } satisfies QueryJob);
  });
}

function reply(res: ServerResponse, status: number, body?: object): void {
  res.writeHead(status, body ? { "content-type": "application/json" } : {}).end(body ? JSON.stringify(body) : undefined);
}
