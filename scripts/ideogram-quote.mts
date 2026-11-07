/**
 * Exact Ideogram price for one lead design, without generating or paying (dry_run).
 *   pnpm ideogram:quote            (reads IDEOGRAM_API_KEY / IDEOGRAM_QUALITY from .env.local)
 */
import { ideogramSize } from "@/lib/design/ideogram";

const key = process.env.IDEOGRAM_API_KEY;
if (!key) {
  console.log("IDEOGRAM_API_KEY is empty in .env.local.");
  process.exit(1);
}

for (const quality of [process.env.IDEOGRAM_QUALITY || "medium", "low", "high"].filter((q, i, all) => all.indexOf(q) === i)) {
  const size = ideogramSize("poster");
  const form = new FormData();
  form.set("prompt", "A professionally designed portrait flyer. Headline: \"Price check\".");
  form.set("magic_prompt", "off");
  form.set("size", `${size.width}x${size.height}`);
  form.set("quality", quality);
  form.set("num_images", "1");
  const response = await fetch("https://api.ideogram.ai/v2/image/generate/ideogram-4-5?dry_run=true", {
    method: "POST",
    headers: { "Api-Key": key },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  console.log(`generate · quality ${quality} · ${size.width}x${size.height}: HTTP ${response.status} ${body.slice(0, 400)}`);
}
console.log("Layerize is billed per call on top of generation; see ideogram.ai/api-pricing.");
