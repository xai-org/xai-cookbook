import { type CreateParams, xAI } from "@xai-official/sdk";

const client = new xAI();

export type Component = { name: string; code: string };
// A component from a later round, with the differences Grok fixed.
export type Refinement = Component & { changes: string[] };

export type ComponentEvents = {
  reasoning?: (text: string) => void;
  changes?: (changes: string[]) => void;
  name?: (name: string) => void;
  code?: (text: string) => void;
};

const PROMPT = `You turn screenshots of user interfaces into a single React component.
- Write one TypeScript (TSX) file with a default-exported function component. Import only from "react", and only if you need hooks.
- Style everything with Tailwind CSS classes. Use arbitrary values like bg-[#18181b] or text-[44px] when you need to match a color or size exactly.
- Match the layout, spacing, colors, font sizes and weights, borders, and corner radii as closely as you can, and keep the text exactly as written.
- Draw icons with inline SVG or text characters. Don't use external images.
- Make it responsive, and add hover states to buttons and links.`;

const REFINE_PROMPT = `${PROMPT}

You're improving a component you wrote earlier. You get the original screenshot, a screenshot of your component rendered at the same size, an overlay of the two, and the component's code.
- The overlay traces the edges in both images: blue is the screenshot, red is your component, and black is where they line up. Wherever a red outline doesn't sit on its blue one, that part of your component is in the wrong place or the wrong size.
- Fix the layout first: move and resize things until the red outlines would sit on the blue ones. Then compare the screenshots for colors, font weights, borders, and corner radii.
- List each difference you fix in a few words, then return the full corrected file. Leave anything that already matches as it is.`;

const NAME = { type: "string", pattern: "^[A-Z][A-Za-z0-9]*$", description: "The component's name in PascalCase" };
const CODE = { type: "string", description: "The full contents of the .tsx file" };

const SCHEMA = {
  type: "object",
  properties: { name: NAME, code: CODE },
  required: ["name", "code"],
  additionalProperties: false,
};

// The changes come first, so Grok spells out the differences before it rewrites the code.
const REFINE_SCHEMA = {
  type: "object",
  properties: { changes: { type: "array", items: { type: "string" } }, name: NAME, code: CODE },
  required: ["changes", "name", "code"],
  additionalProperties: false,
};

export function writeComponent(screenshot: Blob, on: ComponentEvents = {}, signal?: AbortSignal): Promise<Component> {
  const input = [
    { role: "system", content: PROMPT },
    {
      role: "user",
      content: [
        { type: "input_image" as const, image: screenshot, detail: "high" as const },
        { type: "input_text" as const, text: "Recreate this screenshot as a React component." },
      ],
    },
  ];
  return streamComponent<Component>({ input, schema: SCHEMA }, on, signal);
}

// Compares a screenshot of the component as it renders with the original, and fixes the differences.
// The overlay is the two laid over each other, which shows Grok where things don't line up.
export function refineComponent(
  images: { screenshot: Blob; render: Blob; overlay: Blob },
  component: Component,
  on: ComponentEvents = {},
  signal?: AbortSignal,
): Promise<Refinement> {
  const input = [
    { role: "system", content: REFINE_PROMPT },
    {
      role: "user",
      content: [
        { type: "input_text" as const, text: "The original screenshot:" },
        { type: "input_image" as const, image: images.screenshot, detail: "high" as const },
        { type: "input_text" as const, text: "Your component, rendered at the same size:" },
        { type: "input_image" as const, image: images.render, detail: "high" as const },
        { type: "input_text" as const, text: "The overlay:" },
        { type: "input_image" as const, image: images.overlay, detail: "high" as const },
        { type: "input_text" as const, text: `Your component's code:\n\n${component.code}` },
      ],
    },
  ];
  // At the default effort, Grok spends minutes going over every detail of the images before it
  // writes anything. The overlay points it at what to fix, so low effort is enough.
  return streamComponent<Refinement>({ input, schema: REFINE_SCHEMA, reasoning: { effort: "low" } }, on, signal);
}

// Streams a component and reports the code as it's written, so callers can show it before Grok is done.
async function streamComponent<T extends Component>(
  request: Pick<CreateParams, "input" | "reasoning"> & { schema: object },
  on: ComponentEvents,
  signal?: AbortSignal,
): Promise<T> {
  const { schema, ...params } = request;
  let json = "";
  let listed = false;
  let named = false;
  let written = 0;
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      ...params,
      text: { format: { type: "json_schema", name: "component", schema } },
      stream: true,
    },
    { signal },
  );
  const response = await stream
    .on("reasoning", (text) => on.reasoning?.(text))
    .on("text", (delta) => {
      json += delta;
      const changes = !listed && json.match(/"changes"\s*:\s*(\[(?:[^\]"]|"(?:[^"\\]|\\.)*")*\])/);
      if (changes) {
        listed = true;
        on.changes?.(JSON.parse(changes[1]));
      }
      const name = !named && json.match(/"name"\s*:\s*("(?:[^"\\]|\\.)*")/);
      if (name) {
        named = true;
        on.name?.(JSON.parse(name[1]));
      }
      // The code is still an open JSON string, so decode it up to the last complete character,
      // leaving out an escape sequence like \n or \u00e9 that's been cut off.
      const code = json.match(/"code"\s*:\s*"((?:[^"\\]|\\u[\da-fA-F]{4}|\\[^u])*)/);
      const text: string = code ? JSON.parse(`"${code[1]}"`) : "";
      if (text.length > written) {
        on.code?.(text.slice(written));
        written = text.length;
      }
    })
    .done();
  return response.toJson() as T;
}

// A page that renders the component on its own. It compiles the component with Babel in the browser,
// then imports it as a module, so it works without a build step. React and Tailwind load from CDNs.
export function componentPage(component: Component): string {
  const source = JSON.stringify(component.code).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${component.name}</title>
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"></script>
<script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@19",
      "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime",
      "react-dom/client": "https://esm.sh/react-dom@19/client"
    }
  }
</script>
<div id="root"></div>
<script type="application/json" id="source">${source}</script>
<script type="module">
  const code = JSON.parse(document.getElementById("source").textContent);
  const { code: js } = Babel.transform(code, {
    filename: "${component.name}.tsx",
    presets: ["typescript", ["react", { runtime: "automatic" }]],
  });
  const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
  const [{ default: Component }, { createElement }, { createRoot }] = await Promise.all([
    import(url),
    import("react"),
    import("react-dom/client"),
  ]);
  createRoot(document.getElementById("root")).render(createElement(Component));
</script>
</html>
`;
}
