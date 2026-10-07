import { type ServerToolCall, SpaceXAI } from "@xai-official/sdk";
import { codeExecution } from "@xai-official/sdk/tools";

// When the API is busy, a request sometimes fails before Grok starts, with a dropped connection or a 5xx.
// retryBeforeOutput sends those again, which is safe because no code has run yet.
const client = new SpaceXAI({ retryBeforeOutput: true, maxRetries: 5 });

export const SAMPLE = new URL("../subscriptions.csv", import.meta.url);
export const DEFAULT_QUESTION = "Which plan's churn got worse after the price change?";

export type Finding = { label: string; value: string; detail: string };
export type Chart = {
  type: "line" | "bar";
  title: string;
  format: "percent" | "usd" | "number";
  highlight: string;
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
  markers: Array<{ at: string; label: string }>;
};
export type Answer = { answer: string; findings: Finding[]; chart: Chart };
export type Run = { code: string; stdout: string; stderr: string; exitCode: number | null };
export type Result = Answer & { runs: Run[]; cost: number | null };

export type AskEvents = {
  reasoning?: (text: string) => void;
  // A run's code, as soon as Grok has written it and before the sandbox runs it.
  code?: (index: number, code: string) => void;
  output?: (index: number, run: Run) => void;
  // The answer so far, with whatever is still being written closed off.
  draft?: (answer: Partial<Answer>) => void;
};

type CodeOutputs = Extract<ServerToolCall, { type: "code_interpreter_call" }>["outputs"];

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "A direct answer in two or three plain sentences, with the key numbers" },
    findings: {
      type: "array",
      description: "Two to four key numbers from your code's output",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "What the number is, in a few words" },
          value: { type: "string", description: "The number, formatted, like 6.3% or $12,400" },
          detail: { type: "string", description: "One short sentence of context, like what it compares with" },
        },
        required: ["label", "value", "detail"],
        additionalProperties: false,
      },
    },
    chart: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["line", "bar"], description: "line for values over time, bar for comparing groups" },
        title: { type: "string" },
        format: { type: "string", enum: ["percent", "usd", "number"], description: "How to show the values. For percent, 6.3 means 6.3%." },
        highlight: { type: "string", description: "The name of the series that answers the question, which the app draws in color" },
        labels: { type: "array", items: { type: "string" }, description: "The x-axis labels, in order" },
        series: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              values: { type: "array", items: { type: "number" }, description: "One value for each label" },
            },
            required: ["name", "values"],
            additionalProperties: false,
          },
        },
        markers: {
          type: "array",
          description: "Events to mark on the x-axis, like a price change. Can be empty.",
          items: {
            type: "object",
            properties: { at: { type: "string", description: "One of the labels" }, label: { type: "string" } },
            required: ["at", "label"],
            additionalProperties: false,
          },
        },
      },
      required: ["type", "title", "format", "highlight", "labels", "series", "markers"],
      additionalProperties: false,
    },
  },
  required: ["answer", "findings", "chart"],
  additionalProperties: false,
};

// Grok also gets the file's text in its context, so the prompt asks for numbers from code, not from
// reading the file.
function prompt(filename: string): string {
  return `You answer questions about a CSV file by writing and running Python with pandas.
The file is saved as ${filename} in your working directory. Read it with pd.read_csv("${filename}").
Compute every number you report with code. Never estimate, and never read numbers off the file yourself. Print every number you'll use, including each chart value, rounded the way you'll report it, with at most two decimals. Use as few runs as you need, usually one or two. Don't plot anything, since the app draws your chart.
Then answer the question directly, list two to four findings, and describe the one chart that shows the answer best, using only numbers your code printed. When the answer is a single number, chart a breakdown of it, like by month or by group. If the file can't answer the question, say so, and chart what it does show.`;
}

// Uploads the CSV once, so every question can attach it by ID. The upload deletes itself after an hour.
export async function uploadCsv(file: Blob, filename: string, signal?: AbortSignal): Promise<string> {
  const uploaded = await client.files.upload({ file, filename, expires_after: 3600 }, { signal });
  return uploaded.id;
}

// Asks one question about an uploaded CSV, reporting each code run and the answer as they arrive.
export async function ask(
  csv: { fileId: string; filename: string },
  question: string,
  on: AskEvents = {},
  signal?: AbortSignal,
): Promise<Result> {
  const runs: Run[] = [];
  const indexes = new Map<string, number>();
  const startRun = (id: string, code: string) => {
    if (!indexes.has(id)) {
      indexes.set(id, runs.length);
      runs.push({ code, stdout: "", stderr: "", exitCode: null });
      on.code?.(runs.length - 1, code);
    }
    return indexes.get(id)!;
  };

  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      // At the default effort, Grok thinks for up to half a minute between runs, and a question takes
      // close to two minutes. Low effort gets to the same numbers in one or two runs, usually in under one.
      reasoning: { effort: "low" },
      input: [
        { role: "system", content: prompt(csv.filename) },
        // An attached file lands in the sandbox's working directory under the name it was uploaded with.
        { role: "user", content: [{ type: "input_file", file_id: csv.fileId }, { type: "input_text", text: question }] },
      ],
      tools: [codeExecution()],
      // Grok has the file's text in its context, and without this it sometimes answers a simple question
      // from that, without running any code, and gets the numbers wrong.
      tool_choice: "required",
      // Without this, each run comes back with its code but not what it printed.
      include: ["code_interpreter_call.outputs"],
      text: { format: { type: "json_schema", name: "answer", schema: ANSWER_SCHEMA } },
      stream: true,
    },
    { signal },
  );
  const response = await stream
    .on("reasoning", (text) => on.reasoning?.(text))
    // The SDK doesn't know the code interpreter's own events yet, so they arrive as unknown events. This
    // one carries the code as soon as Grok has written it, before the run finishes and the tool call is
    // reported.
    .on("unknown", (event) => {
      const raw = event.raw as { type?: string; item_id?: string; code?: string };
      if (raw.type === "response.code_interpreter_call_code.done" && raw.item_id) startRun(raw.item_id, raw.code ?? "");
    })
    .on("server_tool_call", (call) => {
      if (call.type !== "code_interpreter_call") return;
      const index = startRun(call.id ?? `run-${runs.length}`, call.code ?? "");
      runs[index] = { ...runs[index], ...readLogs(call.outputs) };
      on.output?.(index, runs[index]);
    })
    .on("json", (value) => on.draft?.(value as Partial<Answer>))
    .done();
  return { ...(response.toJson() as Answer), runs, cost: response.usage.cost_usd };
}

// Each run's logs arrive as a JSON string with its stdout, stderr, and exit code, not as plain text.
function readLogs(outputs: CodeOutputs): Omit<Run, "code"> {
  const run: Omit<Run, "code"> = { stdout: "", stderr: "", exitCode: null };
  for (const output of outputs) {
    if (output.type !== "logs") continue;
    try {
      const logs = JSON.parse(output.logs) as { stdout?: string; stderr?: string; exit_code?: number };
      run.stdout += logs.stdout ?? "";
      run.stderr += logs.stderr ?? "";
      run.exitCode = logs.exit_code ?? run.exitCode;
    } catch {
      run.stdout += output.logs;
    }
  }
  return run;
}

// The name becomes the file's name in Grok's sandbox and goes into the code it writes, so it's kept to
// plain characters.
export function safeFilename(name: string): string {
  const stem = name.replace(/\.csv$/i, "").replace(/[^\w.-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(0, 60);
  return `${stem || "data"}.csv`;
}
