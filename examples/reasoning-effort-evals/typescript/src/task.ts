import { z } from "zod";

const Name = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use only letters, digits, and underscores");

const TaskFile = z
  .object({
    name: z.string().min(1),
    // One string, or an array of lines, which is easier to read in a JSON file.
    prompt: z.union([z.string().min(1), z.array(z.string()).min(1).transform((lines) => lines.join("\n"))]),
    // A field with options is a choice. Any other field is free text, and max_words caps its length.
    fields: z.record(Name, z.object({ options: z.array(z.string()).min(1).optional(), max_words: z.number().int().positive().optional() })),
    // What the judge checks in the free text, one criterion per key.
    rubric: z.record(Name, z.string().min(1)).default({}),
    cases: z
      .array(
        z.object({
          id: z.string().min(1).optional(),
          input: z.string().min(1),
          // The right answer for each field that has one. Code checks these, not the judge.
          expected: z.record(z.string(), z.string()).default({}),
          // What a good answer covers, for the judge.
          notes: z.string().optional(),
        }),
      )
      .min(1),
  })
  .transform((task) => ({ ...task, cases: task.cases.map((item, index) => ({ ...item, id: item.id ?? String(index + 1) })) }))
  .superRefine((task, ctx) => {
    if (!Object.keys(task.fields).length) ctx.addIssue({ code: "custom", message: "List at least one field", path: ["fields"] });
    const ids = new Set<string>();
    task.cases.forEach((item, index) => {
      if (ids.has(item.id)) ctx.addIssue({ code: "custom", message: `Another case already has the id ${item.id}`, path: ["cases", index, "id"] });
      ids.add(item.id);
      for (const [name, value] of Object.entries(item.expected)) {
        const field = task.fields[name];
        if (!field) ctx.addIssue({ code: "custom", message: `${name} isn't one of the fields`, path: ["cases", index, "expected", name] });
        else if (field.options && !field.options.includes(value)) {
          ctx.addIssue({ code: "custom", message: `${value} isn't one of the options for ${name}`, path: ["cases", index, "expected", name] });
        }
      }
    });
  });

export type Task = z.output<typeof TaskFile>;
export type Case = Task["cases"][number];
export type Answer = Record<string, string>;
export type Check = { name: string; by: "code" | "judge"; pass: boolean; note: string };

export function parseTask(json: unknown): Task {
  const result = TaskFile.safeParse(json);
  if (!result.success) throw new Error(`The task isn't valid:\n${z.prettifyError(result.error)}`);
  return result.data;
}

// The answer Grok returns. z.toJSONSchema() turns it into the JSON Schema for a request, and the same
// schema validates the answer that comes back.
export function answerSchema(task: Task): z.ZodType<Answer> {
  const shape = Object.fromEntries(
    Object.entries(task.fields).map(([name, field]) => [name, field.options ? z.enum(field.options) : z.string()]),
  );
  return z.object(shape);
}

// Compares each field that has an expected answer, and counts the words in fields with a limit.
export function checkAnswer(task: Task, item: Case, answer: Answer): Check[] {
  const fields = Object.entries(item.expected).map(([name, expected]) => {
    const pass = normalize(answer[name]) === normalize(expected);
    return { name, by: "code" as const, pass, note: pass ? answer[name] : `Expected ${expected}, got ${answer[name]}` };
  });
  const lengths = Object.entries(task.fields).flatMap(([name, { max_words }]) => {
    if (!max_words) return [];
    const words = answer[name].split(/\s+/).filter(Boolean).length;
    return [{ name: `${name} length`, by: "code" as const, pass: words <= max_words, note: `${words} words, and the limit is ${max_words}` }];
  });
  return [...fields, ...lengths];
}

// The judge grades the free-text fields that have no expected answer, when there's a rubric to grade them by.
export function judged(task: Task, item: Case): boolean {
  return Object.keys(task.rubric).length > 0 && freeTextFields(task, item).length > 0;
}

export function freeText(task: Task, item: Case, answer: Answer): string {
  return freeTextFields(task, item)
    .map((name) => `${name}: ${answer[name]}`)
    .join("\n\n");
}

function freeTextFields(task: Task, item: Case): string[] {
  return Object.keys(task.fields).filter((name) => !task.fields[name].options && !(name in item.expected));
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}
