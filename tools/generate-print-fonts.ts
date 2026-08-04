// Вбудовування шрифтів друку в TS-модуль.
//
// Причина та сама, що й у generate-core-sql.ts, generate-client-assets.ts і
// generate-scaffold-template.ts: у встановленому пакеті файлу на диску немає.
// Тут це коштувало живого дефекту — рендерер читав woff відносним шляхом
// `../../../node_modules/@fontsource/roboto/...` від власного `import.meta.url`.
// У монорепо цей шлях є, у застосунку — ні: модуль приїжджає або з кеша JSR
// (тоді `import.meta.url` це `https://`, і Deno.readFile каже «Must be a file
// URL»), або з `vendor/`, де node_modules поряд немає взагалі. Друк падав
// однаково в обох випадках, і лише у встановленому застосунку.
//
// Шрифти маленькі (по ~10 КБ), тож base64 у модулі — найдешевше рішення:
// жодних активів, жодних шляхів, пакет самодостатній.
import { encodeBase64 } from "jsr:@std/encoding@^1/base64";
import { join } from "@std/path";

const HEADER = `// ЗГЕНЕРОВАНО \`deno task print:fonts\` з @fontsource/roboto — не редагувати.
//
// Кирилиці у StandardFonts (pdf-lib) немає, а читати woff із node_modules
// установлений пакет не може: файлу поряд із ним не існує. Чому саме так —
// у tools/generate-print-fonts.ts.
`;

/** Гарнітури, потрібні рендереру: звичайна й жирна, обидві з кирилицею. */
const FONTS = [
  { constant: "PRINT_FONT_REGULAR_BASE64", file: "roboto-cyrillic-400-normal.woff" },
  { constant: "PRINT_FONT_BOLD_BASE64", file: "roboto-cyrillic-700-normal.woff" },
];

export async function generatePrintFonts(
  options: { fontsDir: string; outFile: string; verbose?: boolean },
): Promise<number> {
  const chunks: string[] = [];

  for (const font of FONTS) {
    const path = join(options.fontsDir, font.file);
    const bytes = await Deno.readFile(path);
    chunks.push(`export const ${font.constant}: string =\n  ${JSON.stringify(encodeBase64(bytes))};`);
    if (options.verbose) console.log(`· ${font.file} — ${(bytes.length / 1024).toFixed(1)} КБ`);
  }

  await Deno.writeTextFile(options.outFile, `${HEADER}\n${chunks.join("\n\n")}\n`);
  return FONTS.length;
}

async function main() {
  const verbose = Deno.args.includes("--verbose");
  const [fontsDir, outFile] = Deno.args.filter((arg) => !arg.startsWith("--"));

  if (!fontsDir || !outFile) {
    throw new Error("Вжиток: generate-print-fonts <fontsDir> <outFile> [--verbose]");
  }

  const count = await generatePrintFonts({ fontsDir, outFile, verbose });
  console.log(`✓ ${count} шрифтів → ${outFile}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("❌ Вбудовування шрифтів упало:", error);
    Deno.exit(1);
  });
}
