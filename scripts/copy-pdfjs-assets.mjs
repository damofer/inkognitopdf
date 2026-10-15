// Copies pdf.js standard fonts and CMaps, and the bundled open fonts used to
// complete edited text (SIL OFL 1.1), into public/ so they are served by the
// app itself (offline, no CDN). Runs before dev and build.
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdfjs = dirname(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
);
const target = join(root, "public", "pdfjs");

await rm(target, { recursive: true, force: true });
for (const dir of ["standard_fonts", "cmaps"])
  await cp(join(pdfjs, dir), join(target, dir), { recursive: true });
console.log(`pdf.js assets copied to ${target}`);

// Arimo, Tinos, Cousine, Carlito and Caladea: metric-compatible with Arial,
// Times New Roman, Courier New, Calibri and Cambria.
const require = createRequire(import.meta.url);
const fonts = join(root, "public", "fonts");
const folders = {
  Regular: "400Regular",
  Italic: "400Regular_Italic",
  Bold: "700Bold",
  BoldItalic: "700Bold_Italic",
};
await rm(fonts, { recursive: true, force: true });
await mkdir(fonts, { recursive: true });
for (const family of ["Arimo", "Tinos", "Cousine", "Carlito", "Caladea"]) {
  const pkg = dirname(
    require.resolve(`@expo-google-fonts/${family.toLowerCase()}/package.json`),
  );
  for (const [variant, folder] of Object.entries(folders))
    await cp(
      join(pkg, folder, `${family}_${folder}.ttf`),
      join(fonts, `${family}-${variant}.ttf`),
    );
  await cp(join(pkg, "LICENSE_FONT"), join(fonts, `${family}-LICENSE.txt`));
}
// Handwriting fonts for typed signatures (spec 004).
for (const [family, pkgName] of [
  ["DancingScript", "dancing-script"],
  ["GreatVibes", "great-vibes"],
  ["Caveat", "caveat"],
]) {
  const pkg = dirname(
    require.resolve(`@expo-google-fonts/${pkgName}/package.json`),
  );
  await cp(
    join(pkg, "400Regular", `${family}_400Regular.ttf`),
    join(fonts, `${family}-Regular.ttf`),
  );
  await cp(join(pkg, "LICENSE_FONT"), join(fonts, `${family}-LICENSE.txt`));
}
console.log(`Open fonts copied to ${fonts}`);

// OCR (spec 003): Tesseract.js worker, its WebAssembly core (LSTM builds) and
// the Spanish and English data, served locally. Apache-2.0; the data packages
// are MIT (tessdata: Apache-2.0).
const tesseract = join(root, "public", "tesseract");
await rm(tesseract, { recursive: true, force: true });
await mkdir(tesseract, { recursive: true });
const tjs = dirname(require.resolve("tesseract.js/package.json"));
const core = dirname(require.resolve("tesseract.js-core/package.json"));
await cp(join(tjs, "dist", "worker.min.js"), join(tesseract, "worker.min.js"));
await cp(join(tjs, "LICENSE.md"), join(tesseract, "tesseract.js-LICENSE.txt"));
for (const name of ["", "simd-", "relaxedsimd-"])
  await cp(
    join(core, `tesseract-core-${name}lstm.wasm.js`),
    join(tesseract, `tesseract-core-${name}lstm.wasm.js`),
  );
await cp(
  join(core, "LICENSE"),
  join(tesseract, "tesseract.js-core-LICENSE.txt"),
);
for (const lang of ["spa", "eng"])
  await cp(
    join(
      dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)),
      "4.0.0_best_int",
      `${lang}.traineddata.gz`,
    ),
    join(tesseract, `${lang}.traineddata.gz`),
  );
console.log(`Tesseract.js assets copied to ${tesseract}`);
