import { openAsBlob } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { type Component, componentPage, writeComponent } from "./component.ts";

const screenshot = process.argv[2] ?? "sample-screenshot.png";
console.log(`Recreating ${screenshot}`);

const component = await writeComponent(await openAsBlob(screenshot));

await mkdir("output", { recursive: true });
await writeFile(`output/${component.name}.tsx`, component.code);
await copyFile(screenshot, `output/${basename(screenshot)}`);
await writeFile("output/preview.html", previewPage(component, basename(screenshot)));
console.log(`Saved output/${component.name}.tsx. Open output/preview.html to compare it with the screenshot.`);

// The component renders in an iframe as wide as the screenshot, scaled down to fit its column, so its
// layout and breakpoints match the screenshot's size instead of the width of the column.
function previewPage(component: Component, screenshot: string): string {
  const frame = componentPage(component).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${component.name}</title>
<style>
  body { margin: 0; }
  .preview-page { box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; gap: 24px; padding: 24px; background: #e5e5e5; min-height: 100vh; font-family: system-ui, sans-serif; }
  .preview-label { font-size: 13px; font-weight: 600; color: #525252; margin: 0 0 8px; }
  .preview-shot, .preview-frame { display: block; width: 100%; border-radius: 8px; background: #fff; overflow: hidden; }
  .preview-frame iframe { display: block; border: 0; transform-origin: 0 0; }
</style>
<div class="preview-page">
  <section><h2 class="preview-label">Screenshot</h2><img class="preview-shot" id="shot" src="${screenshot}" alt=""></section>
  <section><h2 class="preview-label">${component.name}</h2><div class="preview-frame" id="frame"><iframe id="component" title="${component.name}" sandbox="allow-scripts" srcdoc="${frame}"></iframe></div></section>
</div>
<script>
  const shot = document.getElementById("shot");
  const frame = document.getElementById("frame");
  const iframe = document.getElementById("component");
  function fit() {
    const { naturalWidth: width, naturalHeight: height } = shot;
    if (!width) return;
    frame.style.aspectRatio = width + " / " + height;
    iframe.style.width = width + "px";
    iframe.style.height = height + "px";
    iframe.style.transform = "scale(" + frame.clientWidth / width + ")";
  }
  shot.onload = fit;
  new ResizeObserver(fit).observe(frame);
</script>
</html>
`;
}
