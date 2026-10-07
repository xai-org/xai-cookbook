import { mkdir, writeFile } from "node:fs/promises";
import { styleText } from "node:util";
import { type Answer, SAMPLE_QUESTION, type Step, ask, openStore } from "./ask.ts";

const question = process.argv.slice(2).join(" ") || SAMPLE_QUESTION;
const MCP_PORT = Number(process.env.MCP_PORT ?? 3001);

console.log(styleText("dim", "Starting the MCP server and opening a tunnel to it"));
const store = await openStore(MCP_PORT);
console.log(styleText("dim", `SpaceXAI reaches it at ${store.url}\n`));
console.log(styleText("bold", question));

const started = Date.now();
let midLine = false;
let answering = false;
const write = (text: string) => {
  process.stdout.write(text);
  midLine = !text.endsWith("\n");
};
const newLine = () => midLine && write("\n");

try {
  const answer = await ask(question, store, {
    reasoning: (text) => write(styleText("dim", text)),
    called: (step) => {
      newLine();
      write(`${formatStep(step)}\n`);
    },
    text: (text) => {
      if (!answering) {
        newLine();
        write("\n");
        answering = true;
      }
      write(text);
    },
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  const name = slugify(question);
  await mkdir("output", { recursive: true });
  await writeFile(`output/${name}.md`, transcript(question, answer, seconds));
  console.log(`\n\n${answer.steps.length} calls to the MCP server, ${seconds} seconds, $${answer.cost.toFixed(4)}. Saved output/${name}.md`);
} finally {
  store.close();
}

function formatStep(step: Step): string {
  const head = styleText("cyan", `→ ${step.tool}`) + (step.arguments.table ? ` ${step.arguments.table}` : "");
  if (step.error) return `${head} ${styleText("red", step.error)}`;
  if (step.tool === "list_tables") return `${head} ${tables(step.output).map(({ name, rows }) => `${name} (${rows})`).join(", ")}`;
  if (step.tool !== "run_query") return head;
  const { columns, rows } = step.output as { columns: string[]; rows: unknown[][] };
  const sql = String(step.arguments.sql).replace(/\s+/g, " ");
  const table = [columns, ...rows.slice(0, 10)].map((row) => `    ${row.map(String).join(" | ")}`).join("\n");
  return `${head}\n${styleText("dim", `    ${sql}`)}\n${table}${rows.length > 10 ? `\n    and ${rows.length - 10} more rows` : ""}`;
}

function transcript(question: string, answer: Answer, seconds: number): string {
  const steps = answer.steps.map((step, index) => {
    const lines = [`### ${index + 1}. ${step.tool}${step.arguments.table ? ` ${step.arguments.table}` : ""}`];
    if (step.arguments.sql) lines.push("```sql", String(step.arguments.sql), "```");
    if (step.error) lines.push(`**Error:** ${step.error}`);
    else if (step.tool === "list_tables") lines.push(markdownTable(["table", "rows"], tables(step.output).map(({ name, rows }) => [name, rows])));
    else if (step.tool === "describe_table") lines.push("```sql", (step.output as { sql: string }).sql, "```");
    else lines.push(markdownTable((step.output as { columns: string[] }).columns, (step.output as { rows: unknown[][] }).rows));
    return lines.join("\n");
  });
  return `# ${question}\n\n${answer.text}\n\n## Calls to the MCP server\n\n${steps.join("\n\n")}\n\n${seconds} seconds, $${answer.cost.toFixed(4)}\n`;
}

function tables(output: unknown): Array<{ name: string; rows: number }> {
  return (output as { tables: Array<{ name: string; rows: number }> }).tables;
}

function markdownTable(columns: string[], rows: unknown[][]): string {
  if (!columns.length) return "No rows.";
  const line = (cells: unknown[]) => `| ${cells.map((cell) => String(cell).replaceAll("|", "\\|")).join(" | ")} |`;
  return [line(columns), line(columns.map(() => "---")), ...rows.map(line)].join("\n");
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "answer";
}
