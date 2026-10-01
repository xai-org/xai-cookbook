// Throwaway end-to-end check: open the demo, click into the agent, and wait for the deployed
// worker to actually greet us. Run with the dev server up on :3020.
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3020';

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  permissions: ['microphone'],
  viewport: { width: 1400, height: 1000 },
});
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [console error]', m.text().slice(0, 160));
});
page.on('response', (r) => {
  if (r.url().includes('connection_details')) console.log(`  [api] ${r.status()} → token`);
});

await page.goto(BASE, { waitUntil: 'networkidle' });
console.log('cards:', JSON.stringify(await page.getByRole('heading', { level: 2 }).allTextContents()));
console.log('card accent:', await page.evaluate(() => {
  const el = document.querySelector('div[style*="fgAccentPrimary1"]');
  return el ? getComputedStyle(el).getPropertyValue('--lk-color-fgAccentPrimary1').trim() : 'none';
}));

await page.getByRole('button', { name: 'Start conversation' }).click();
await page.waitForURL('**/patient-intake', { timeout: 10_000 });
console.log('url after click:', new URL(page.url()).pathname);
await page.getByRole('button', { name: 'Back to agents' }).waitFor({ timeout: 10_000 });
console.log('conversation panel mounted');

// The agent greets first, so its first transcript line proves the whole path:
// token → room → dispatch → deployed worker → STT/LLM/TTS → transcript stream.
const panel = () => page.locator('[aria-label="Back to agents"]').locator('xpath=ancestor::div[3]');
const started = Date.now();
let spoke = null;
for (let i = 0; i < 45; i++) {
  const text = await page.evaluate(() => {
    const scroller = document.querySelector('.scroll-fade');
    return scroller ? scroller.innerText.trim() : '';
  });
  if (text && !/^connecting$/i.test(text)) {
    spoke = text;
    break;
  }
  await page.waitForTimeout(1000);
}

if (spoke) {
  console.log(`\nAGENT SPOKE after ${((Date.now() - started) / 1000).toFixed(1)}s:`);
  spoke.split('\n').filter(Boolean).slice(0, 6).forEach((l) => console.log('  >', l.trim().slice(0, 200)));
} else {
  console.log('\nNO AGENT AUDIO/TRANSCRIPT within 45s');
}

console.log('\npanel visualizer dots:', await page.evaluate(() => {
  const p = document.querySelector('[aria-label="Back to agents"]')?.closest('div[style]');
  if (!p) return 'no panel';
  return [...new Set([...p.querySelectorAll('[data-lk-highlighted="true"]')].map((d) => getComputedStyle(d).backgroundColor))];
}));
console.log('mic control present:', await page.locator('button[aria-label*="icrophone" i], button:has-text("End call")').count());

await page.screenshot({ path: 'e2e-conversation.png' });
console.log('screenshot -> e2e-conversation.png');
await browser.close();
