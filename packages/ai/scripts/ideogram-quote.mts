/**
 * What one Ideogram lead design really costs, without generating or paying (dry_run):
 * every format's size is checked against Ideogram, each quality level is quoted, Layerize
 * is quoted on a real flyer image, and the total is set against what a generation earns.
 *   pnpm ideogram:quote            (reads IDEOGRAM_API_KEY / IDEOGRAM_QUALITY from .env.local)
 */
import type { FlyerFormat } from "@flyer/design/canvas/types";
import { decorForVariant, rankedChoices, rulesBrief, toDesignCopy } from "../src/brief";
import { chooseVariants, composeDesign, hasRichCopy } from "@flyer/design/compose";
import { ideogramSize } from "../src/ideogram";
import { renderPng } from "@flyer/design/render/png";
import { CREDIT_COSTS, PAID_PLANS, PLANS } from "@flyer/billing/plans";

const key = process.env.IDEOGRAM_API_KEY;
if (!key) {
  console.log("IDEOGRAM_API_KEY is empty in .env.local.");
  process.exit(1);
}
const configured = process.env.IDEOGRAM_QUALITY || "medium";
const usd = (micros: number) => `$${(micros / 1e6).toFixed(3)}`;

async function dryRun(path: string, form: FormData) {
  const response = await fetch(`https://api.ideogram.ai${path}?dry_run=true`, { method: "POST", headers: { "Api-Key": key! }, body: form, signal: AbortSignal.timeout(30_000) });
  const body = await response.text();
  if (!response.ok) return { ok: false as const, error: `HTTP ${response.status} ${body.slice(0, 160)}` };
  return { ok: true as const, micros: Number((JSON.parse(body) as { usd_micros?: number }).usd_micros ?? NaN) };
}

function generateForm(format: FlyerFormat, quality: string) {
  const size = ideogramSize(format);
  const form = new FormData();
  form.set("prompt", 'A professionally designed flyer. Headline: "Price check".');
  form.set("magic_prompt", "off");
  form.set("size", `${size.width}x${size.height}`);
  form.set("quality", quality);
  form.set("num_images", "1");
  return { form, size };
}

console.log("Sizes (each format, at the configured quality):");
let sizesOk = true;
for (const format of ["poster", "square", "story", "landscape"] as const) {
  const { form, size } = generateForm(format, configured);
  const quote = await dryRun("/v2/image/generate/ideogram-4-5", form);
  sizesOk &&= quote.ok;
  console.log(`  ${format.padEnd(9)} ${`${size.width}x${size.height}`.padEnd(10)} ${quote.ok ? "accepted" : `REJECTED — ${quote.error}`}`);
}

// Layerize is quoted on a real rendered flyer, the kind of image it will receive.
const brief = rulesBrief("Summer jazz night, Friday 8pm");
const copy = toDesignCopy(brief);
const choices = rankedChoices(brief);
const [variant] = chooseVariants(choices, { hasPhotos: false, richCopy: hasRichCopy(copy) });
const png = await renderPng(composeDesign({ format: "poster", copy, variant: variant!, photos: [], decor: decorForVariant(choices.decor, 0) }), 1024);
const layerForm = new FormData();
layerForm.set("image", new Blob([new Uint8Array(png)], { type: "image/png" }), "flyer.png");
const layerize = await dryRun("/v2/design/layerize/ideogram-3", layerForm);
if (!layerize.ok) console.log(`\nLayerize quote failed: ${layerize.error}`);
const layerMicros = layerize.ok ? layerize.micros : 0;

// What a generation earns: its credit cost at each paid plan's monthly price per credit.
const earns = PAID_PLANS.map((plan) => ({ plan, micros: (PLANS[plan].price.month / PLANS[plan].monthlyCredits) * CREDIT_COSTS.generate * 1e6 }));

console.log(`\nOne lead design = one image + one Layerize call (${usd(layerMicros)}). A generation costs ${CREDIT_COSTS.generate} credits.`);
console.log(`  quality  image    total    ${earns.map((e) => `vs ${PLANS[e.plan].name} (earns ${usd(e.micros)})`).join("   ")}`);
for (const quality of ["low", "medium", "high"]) {
  const quote = await dryRun("/v2/image/generate/ideogram-4-5", generateForm("poster", quality).form);
  if (!quote.ok) {
    console.log(`  ${quality.padEnd(8)} ${quote.error}`);
    continue;
  }
  const total = quote.micros + layerMicros;
  const margins = earns.map((e) => `${e.micros - total >= 0 ? "+" : "−"}${usd(Math.abs(e.micros - total))}`.padEnd(String(`vs ${PLANS[e.plan].name} (earns ${usd(e.micros)})`).length));
  console.log(`  ${(quality + (quality === configured ? "*" : "")).padEnd(8)} ${usd(quote.micros).padEnd(8)} ${usd(total).padEnd(8)} ${margins.join("   ")}`);
}
console.log("  * configured (IDEOGRAM_QUALITY). Margins exclude Paynow fees and the free Groq/Unsplash calls.");
process.exit(sizesOk && layerize.ok ? 0 : 1);
