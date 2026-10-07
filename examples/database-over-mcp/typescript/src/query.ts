import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

export type QueryJob = { path: string; sql: string; maxRows: number; maxChars: number };
export type QueryResult = { columns: string[]; rows: unknown[][]; truncated: boolean } | { error: string };

// Runs one query that Grok wrote, for the MCP server's run_query tool. Each query gets a process of its
// own, so the server can kill it when it runs too long: SQLite can't stop a query that's running.
process.once("message", (job: QueryJob) => {
  let result: QueryResult;
  try {
    result = query(job);
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) };
  }
  process.send?.(result, () => process.disconnect());
});

function query({ path, sql, maxRows, maxChars }: QueryJob): QueryResult {
  // SQLite itself refuses to write through a read-only connection, whatever the SQL says.
  const db = new DatabaseSync(path, { readOnly: true });
  // Read-only connections still allow ATTACH, which can open other database files on this machine, and
  // temporary tables, so only SELECT gets through.
  if (!/^(select|with)\b/i.test(sql.replace(/^(\s+|--.*|\/\*[\s\S]*?\*\/)*/, ""))) {
    throw new Error("Only SELECT statements are allowed. This database is read-only.");
  }
  const statement = db.prepare(sql);
  // prepare() compiles the first statement and quietly drops the rest.
  if (statement.sourceSQL.trim() !== sql.trim()) throw new Error("Send one statement at a time.");

  let columns: string[] = [];
  const rows: unknown[][] = [];
  let chars = 0;
  for (const row of statement.iterate()) {
    columns = Object.keys(row);
    const values = Object.values(row).map(cell);
    chars += JSON.stringify(values).length;
    if (rows.length === maxRows || chars > maxChars) return { columns, rows, truncated: true };
    rows.push(values);
  }
  return { columns, rows, truncated: false };
}

function cell(value: SQLOutputValue): unknown {
  return value instanceof Uint8Array ? `<${value.byteLength} bytes>` : value;
}
