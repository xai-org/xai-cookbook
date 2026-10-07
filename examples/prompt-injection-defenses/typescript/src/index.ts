import { mkdir, writeFile } from "node:fs/promises";
import { styleText } from "node:util";
import { ATTACKS } from "./attacks.ts";
import { type AttackResult, type Defenses, type LabEvents, NO_DEFENSES, demoAllowedDomains, runAttack, runSuite } from "./lab.ts";

const DEFENSE_NAMES = ["fence", "gate", "validate", "confirm"] as const;
const LABELS: Record<AttackResult["status"], string> = { breached: "BREACHED", blocked: "blocked ", safe: "safe    " };

const args = process.argv.slice(2);
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? args[onlyAt + 1] : undefined;
if (onlyAt >= 0 && !only) {
  console.error("Pass an attack id after --only.");
  process.exit(1);
}
const chosen = DEFENSE_NAMES.filter((name) => args.includes(name));

await mkdir("output", { recursive: true });
let total = 0;
const defenses: Defenses = chosen.length > 0
  ? { ...NO_DEFENSES, ...Object.fromEntries(chosen.map((name) => [name, true])) }
  : NO_DEFENSES;

if (only) {
  const attack = ATTACKS.find((item) => item.id === only);
  if (!attack) {
    console.error(`Unknown attack "${only}". Expected one of: ${ATTACKS.map((item) => item.id).join(", ")}`);
    process.exit(1);
  }
  total += await pass(chosen.length > 0 ? defenses : NO_DEFENSES, attack.id);
} else if (chosen.length > 0 || args.includes("--off")) {
  // One pass with exactly the defenses named on the command line. --off is the pass with none of them.
  total += await pass(defenses);
} else if (!args.includes("--websearch")) {
  // The default: once with every defense off, once with every defense on.
  total += await pass(NO_DEFENSES);
  console.log("");
  total += await pass({ fence: true, gate: true, validate: true, confirm: true });
}

if (args.includes("--websearch")) {
  console.log(styleText("bold", "\nallowed_domains on the real web"));
  const { text, cost } = await demoAllowedDomains("What reasoning efforts does grok-4.7 support?", ["docs.x.ai"]);
  total += cost;
  console.log(styleText("dim", `  ${text.replace(/\s+/g, " ").slice(0, 200)}`));
}

console.log(styleText("bold", `\nTotal API cost: $${total.toFixed(4)}`));

// Runs the suite once, or one attack when id is set, prints a scoreboard, and saves the results.
async function pass(defenses: Defenses, id?: string): Promise<number> {
  console.log(styleText("bold", `Defenses: ${describe(defenses)}${id ? ` · ${id}` : ""}`));
  const events: LabEvents = {
    attackStart: (attackId) => process.stdout.write(styleText("dim", `  running ${attackId}...`)),
    toolResult: (_attackId, { outcome, detail }) => {
      if (outcome === "breach") process.stdout.write(styleText("red", `\r  ✗ ${detail}\n`));
      else if (outcome === "blocked") process.stdout.write(styleText("yellow", `\r  • ${detail}\n`));
    },
    attackDone: (result) => process.stdout.write(`\r${line(result)}\n`),
  };
  const attack = id ? ATTACKS.find((item) => item.id === id) : undefined;
  const { results, cost } = attack
    ? await runAttack(attack, defenses, events).then((result) => ({ results: [result], cost: result.cost }))
    : await runSuite(defenses, events);

  const breached = results.filter((result) => result.status === "breached").length;
  console.log(`  ${breached} of ${results.length} attacks got through · $${cost.toFixed(4)}`);
  const slug = `${describe(defenses)}${id ? `-${id}` : ""}`.replace(/[^a-z]+/gi, "-").toLowerCase();
  await writeFile(`output/${slug}.json`, JSON.stringify({ defenses, cost, results }, null, 2));
  return cost;
}

function line(result: AttackResult): string {
  const color = result.status === "breached" ? "red" : result.status === "blocked" ? "yellow" : "green";
  return `  ${styleText(color, LABELS[result.status])}  ${result.id.padEnd(16)} ${styleText("dim", `${result.technique} · ${result.vector}`)}`;
}

function describe(defenses: Defenses): string {
  const on = DEFENSE_NAMES.filter((name) => defenses[name]);
  if (on.length === 0) return "none";
  if (on.length === DEFENSE_NAMES.length) return "all";
  return on.join(" + ");
}
