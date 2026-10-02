import { xAI } from "@xai-official/sdk";

const client = new xAI();

export type Component = { name: string; code: string };

export type ComponentEvents = {
  reasoning?: (text: string) => void;
  name?: (name: string) => void;
  code?: (text: string) => void;
};

const PROMPT = `You turn screenshots of user interfaces into a single React component.
- Write one TypeScript (TSX) file with a default-exported function component. Import only from "react", and only if you need hooks.
- Style everything with Tailwind CSS classes. Use arbitrary values like bg-[#18181b] or text-[44px] when you need to match a color or size exactly.
- Match the layout, spacing, colors, font sizes and weights, borders, and corner radii as closely as you can, and keep the text exactly as written.
- Draw icons with inline SVG or text characters. Don't use external images.
- Make it responsive, and add hover states to buttons and links.`;

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", pattern: "^[A-Z][A-Za-z0-9]*$", description: "The component's name in PascalCase" },
    code: { type: "string", description: "The full contents of the .tsx file" },
  },
  required: ["name", "code"],
  additionalProperties: false,
};

// Streams the component and reports the code as it's written, so callers can show it before Grok is done.
export async function writeComponent(screenshot: Blob, on: ComponentEvents = {}, signal?: AbortSignal): Promise<Component> {
  let json = "";
  let named = false;
  let written = 0;
  const stream = await client.responses.create(
    {
      model: "grok-4.7",
      input: [
        { role: "system", content: PROMPT },
        {
          role: "user",
          content: [
            { type: "input_image", image: screenshot, detail: "high" },
            { type: "input_text", text: "Recreate this screenshot as a React component." },
          ],
        },
      ],
      text: { format: { type: "json_schema", name: "component", schema: SCHEMA } },
      stream: true,
    },
    { signal },
  );
  const response = await stream
    .on("reasoning", (text) => on.reasoning?.(text))
    .on("text", (delta) => {
      json += delta;
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
  return response.toJson() as Component;
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
