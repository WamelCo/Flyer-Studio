/**
 * Regenerates lib/design/metrics.json: per-character advance widths (per 1000 units of
 * font size) for every flyer typeface and weight, measured with real fonts in headless
 * Chrome. The layout engine uses these to set type precisely on the server.
 *
 *   node scripts/gen-font-metrics.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = join(import.meta.dirname, "..", "lib", "design", "metrics.json");

// Keep in sync with lib/canvas/fonts.ts.
const FONTS = {
  sans: { family: "Inter", weights: [400, 500, 600, 700, 800] },
  geometric: { family: "Montserrat", weights: [400, 500, 600, 700, 800, 900] },
  serif: { family: "Playfair Display", weights: [400, 600, 700, 900] },
  elegant: { family: "Cormorant Garamond", weights: [400, 500, 600, 700] },
  dserif: { family: "DM Serif Display", weights: [400] },
  display: { family: "Bebas Neue", weights: [400] },
  heavy: { family: "Anton", weights: [400] },
  condensed: { family: "Oswald", weights: [300, 400, 500, 600, 700] },
  grotesk: { family: "Space Grotesk", weights: [400, 500, 600, 700] },
  calligraphy: { family: "Great Vibes", weights: [400] },
  script: { family: "Caveat", weights: [400, 600, 700] },
};

const EXTRA = "’‘“”–—…·•€£¥©®×÷°éèêáàâñüöäçíóúÉÁ";
const CHARS = [...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), ...EXTRA];

const css = Object.values(FONTS)
  .map(({ family, weights }) => `family=${family.replace(/ /g, "+")}:wght@${weights.join(";")}`)
  .join("&");
const html = `<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${css}&display=block"></head><body></body></html>`;

const profile = mkdtempSync(join(tmpdir(), "metrics-"));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"]);

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    } catch {}
  }
  if (!target) throw new Error("Chrome did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      pending.set(++id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.navigate", { url: `data:text/html,${encodeURIComponent(html)}` });
  await new Promise((r) => setTimeout(r, 1500));

  const expression = `(async () => {
    const fonts = ${JSON.stringify(FONTS)};
    const chars = ${JSON.stringify(CHARS)};
    const loads = [];
    for (const { family, weights } of Object.values(fonts)) for (const w of weights) loads.push(document.fonts.load(w + ' 100px "' + family + '"', chars.join('')));
    await Promise.all(loads);
    await document.fonts.ready;
    const ctx = document.createElement('canvas').getContext('2d');
    const out = { chars: chars.join(''), fonts: {} };
    const missing = [];
    for (const [key, { family, weights }] of Object.entries(fonts)) {
      out.fonts[key] = {};
      for (const w of weights) {
        if (!document.fonts.check(w + ' 100px "' + family + '"')) missing.push(family + ' ' + w);
        ctx.font = w + ' 1000px "' + family + '"';
        out.fonts[key][w] = chars.map((c) => Math.round(ctx.measureText(c).width));
        ctx.font = w + ' 1000px "' + family + '"';
        const m = ctx.measureText('Hxg');
        out.fonts[key][w + ':asc'] = Math.round(m.fontBoundingBoxAscent);
        out.fonts[key][w + ':desc'] = Math.round(m.fontBoundingBoxDescent);
        out.fonts[key][w + ':cap'] = Math.round(ctx.measureText('H').actualBoundingBoxAscent);
      }
    }
    return { out, missing };
  })()`;
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  const { out, missing } = result.result.result.value;
  if (missing.length) throw new Error(`Fonts failed to load: ${missing.join(", ")}`);
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`wrote ${OUT} (${Object.keys(out.fonts).length} families)`);
  ws.close();
} finally {
  chrome.kill();
}
