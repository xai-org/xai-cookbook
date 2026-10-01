import { openAsBlob } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { xAI } from "@xai-official/sdk";

const client = new xAI();

type Component = { name: string; code: string };

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

const screenshot = process.argv[2] ?? "sample-screenshot.png";
console.log(`Recreating ${screenshot}`);

const response = await client.responses.create({
  model: "grok-4.7",
  input: [
    { role: "system", content: PROMPT },
    {
      role: "user",
      content: [
        { type: "input_image", image: await openAsBlob(screenshot), detail: "high" },
        { type: "input_text", text: "Recreate this screenshot as a React component." },
      ],
    },
  ],
  text: { format: { type: "json_schema", name: "component", schema: SCHEMA } },
});
const component = response.toJson() as Component;

await mkdir("output", { recursive: true });
await writeFile(`output/${component.name}.tsx`, component.code);
await copyFile(screenshot, `output/${basename(screenshot)}`);
await writeFile("output/preview.html", previewPage(component, basename(screenshot)));
console.log(`Saved output/${component.name}.tsx. Open output/preview.html to compare it with the screenshot.`);

// The preview compiles the component in the browser with Babel, then imports it as a module,
// so it works without a build step. React and Tailwind load from CDNs.
function previewPage(component: Component, screenshot: string): string {
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
<style>
  .preview-page { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 24px; background: #e5e5e5; min-height: 100vh; font-family: system-ui, sans-serif; }
  .preview-label { font-size: 13px; font-weight: 600; color: #525252; margin: 0 0 8px; }
  .preview-shot, .preview-frame { width: 100%; border-radius: 8px; background: #fff; overflow: hidden; }
</style>
<div class="preview-page">
  <section><h2 class="preview-label">Screenshot</h2><img class="preview-shot" src="${screenshot}" alt=""></section>
  <section><h2 class="preview-label">${component.name}</h2><div class="preview-frame" id="root"></div></section>
</div>
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
