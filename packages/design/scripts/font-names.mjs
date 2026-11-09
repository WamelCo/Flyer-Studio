/**
 * Reads the PostScript name of every bundled font (assets/fonts/{key}-{weight}[-italic].ttf)
 * into lib/export/font-names.json. Photoshop text layers and Illustrator SVG import find
 * fonts by these names, so a designer with the (free Google) fonts installed gets live,
 * editable type. Re-run after scripts/fetch-fonts.mjs changes the font set.
 *   node scripts/font-names.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dir = join(root, "assets", "fonts");

/** A name record (6 = PostScript name, 16 = typographic family, 1 = family) from the 'name' table. */
function nameRecord(buffer, wanted) {
  const tables = buffer.readUInt16BE(4);
  let nameOffset = -1;
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (buffer.toString("latin1", record, record + 4) === "name") nameOffset = buffer.readUInt32BE(record + 8);
  }
  if (nameOffset < 0) return null;
  const count = buffer.readUInt16BE(nameOffset + 2);
  const strings = nameOffset + buffer.readUInt16BE(nameOffset + 4);
  let fallback = null;
  for (let i = 0; i < count; i++) {
    const r = nameOffset + 6 + i * 12;
    const [platform, , , nameId, length, offset] = [0, 2, 4, 6, 8, 10].map((o) => buffer.readUInt16BE(r + o));
    if (nameId !== wanted) continue;
    const bytes = buffer.subarray(strings + offset, strings + offset + length);
    if (platform === 3 || platform === 0) {
      let out = "";
      for (let j = 0; j + 1 < bytes.length; j += 2) out += String.fromCharCode(bytes.readUInt16BE(j));
      return out;
    }
    fallback ??= bytes.toString("latin1");
  }
  return fallback;
}

// Google Fonts' static naming ("Montserrat-SemiBold", "PlayfairDisplay-BoldItalic") — what a
// designer has installed. Some bundled files were cut from variable fonts and carry the
// default instance in the family ("MontserratThin-Regular"); the convention wins there.
const families = JSON.parse(readFileSync(join(dir, "families.json"), "utf8"));
const STYLE = { 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" };

const names = {};
const renderFamilies = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith(".ttf")).sort()) {
  const match = /^([a-z]+)-(\d{3})(-italic)?\.ttf$/.exec(file);
  if (!match) continue;
  const [, key, weight, italic] = match;
  const family = families[key].replace(/\s+/g, "");
  const style = italic ? (weight === "400" ? "Italic" : `${STYLE[weight]}Italic`) : STYLE[weight];
  const name = `${family}-${style}`;
  const buffer = readFileSync(join(dir, file));
  const actual = nameRecord(buffer, 6);
  // The family the file itself declares — what the server renderer (resvg) must ask for.
  const declared = nameRecord(buffer, 16) ?? nameRecord(buffer, 1);
  if (renderFamilies[key] && renderFamilies[key] !== declared) throw new Error(`${file}: family ${declared}, other ${key} files say ${renderFamilies[key]}`);
  renderFamilies[key] = declared;
  const artefact = new RegExp(`^${family}(Thin|ExtraLight|Light)-${style}$`);
  if (actual !== name && !artefact.test(actual ?? "")) throw new Error(`${file}: font says ${actual}, convention says ${name}`);
  (names[key] ??= {})[`${weight}${italic ? "i" : ""}`] = name;
}
writeFileSync(join(root, "src", "render", "font-names.json"), `${JSON.stringify(names, null, 2)}\n`);
// Some files cut from variable fonts declare e.g. "Montserrat Thin" as their family: the server
// renderer must ask for that name, or resvg silently draws the text in another font.
writeFileSync(join(root, "src", "render", "font-families.json"), `${JSON.stringify(renderFamilies, null, 2)}\n`);
console.log(Object.entries(names).map(([k, v]) => `${k}: ${Object.values(v).join(", ")}`).join("\n"));
