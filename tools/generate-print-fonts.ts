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
import fontkit from "@pdf-lib/fontkit";

const HEADER = `// ЗГЕНЕРОВАНО \`deno task print:fonts\` з @fontsource/roboto — не редагувати.
//
// Кирилиці у StandardFonts (pdf-lib) немає, а читати woff із node_modules
// установлений пакет не може: файлу поряд із ним не існує. Чому саме так —
// у tools/generate-print-fonts.ts.
//
// Поруч із байтами лежить ПОКРИТТЯ кожного субсета — діапазони кодів, які в
// ньому справді є. Без нього рендерер вибирав шрифт за межею \`код <= 0x7F\`,
// і все, що вище, віддавав у Roboto: лапка «U+00AB» у кирилічному субсеті
// відсутня, тож назва «ТОВ «Демо»» друкувалася сміттям. Питання мусить бути
// «чи є гліф», а не «чи це ASCII», — а на нього відповідають саме ці дані.

/** Субсет шрифту: байти та коди, які він покриває (пари [від, до]). */
export interface PrintFontSubset {
  readonly base64: string;
  readonly ranges: readonly (readonly [number, number])[];
}
`;

/**
 * Субсети Roboto, потрібні бланку. Список, а не пара констант: рендерер бере
 * ПЕРШИЙ, що покриває символ, тож новий субсет колись додасться рядком.
 *
 * Сьогодні субсет один — кирилиця. Решту (лапки-ялинки, тире, апостроф, три
 * крапки) покриває Helvetica, тож `latin` тут зайвий; `cyrillic-ext` теж
 * пробували — він не дає нічого, крім давньослов'янських літер.
 *
 * ЧОГО ТУТ НЕМАЄ І ЧОМУ. Знака гривні `₴` (U+20B4) немає в ЖОДНОМУ субсеті
 * @fontsource/roboto — перевірено всі дев'ять — і немає у WinAnsi. Тобто
 * надрукувати його цим набором неможливо в принципі: він вийде порожньою
 * рамкою. Лікується тільки іншим джерелом гарнітури, і це окреме рішення.
 */
const SUBSETS = ["roboto-cyrillic-400-normal.woff"];
const SUBSETS_BOLD = ["roboto-cyrillic-700-normal.woff"];

/** Коди, які покриває шрифт, згорнуті в діапазони. */
function coverageRanges(bytes: Uint8Array): Array<[number, number]> {
  const font = fontkit.create(bytes) as unknown as { characterSet: number[] };
  const codes = [...new Set(font.characterSet)].sort((a, b) => a - b);

  const ranges: Array<[number, number]> = [];
  for (const code of codes) {
    const last = ranges[ranges.length - 1];
    if (last && code === last[1] + 1) {
      last[1] = code;
      continue;
    }
    ranges.push([code, code]);
  }
  return ranges;
}

async function buildSubsets(fontsDir: string, files: string[], verbose?: boolean) {
  const entries: string[] = [];

  for (const file of files) {
    const bytes = await Deno.readFile(join(fontsDir, file));
    const ranges = coverageRanges(bytes);
    const covered = ranges.reduce((sum, [from, to]) => sum + (to - from + 1), 0);

    entries.push(
      `  {\n    base64:\n      ${JSON.stringify(encodeBase64(bytes))},\n` +
        `    ranges: [${ranges.map(([from, to]) => `[${from}, ${to}]`).join(", ")}],\n  }`,
    );

    if (verbose) {
      console.log(`· ${file} — ${(bytes.length / 1024).toFixed(1)} КБ, гліфів ${covered}`);
    }
  }

  return entries;
}

export async function generatePrintFonts(
  options: { fontsDir: string; outFile: string; verbose?: boolean },
): Promise<number> {
  const regular = await buildSubsets(options.fontsDir, SUBSETS, options.verbose);
  const bold = await buildSubsets(options.fontsDir, SUBSETS_BOLD, options.verbose);

  const chunks = [
    `export const PRINT_FONT_SUBSETS_REGULAR: readonly PrintFontSubset[] = [\n${regular.join(",\n")},\n];`,
    `export const PRINT_FONT_SUBSETS_BOLD: readonly PrintFontSubset[] = [\n${bold.join(",\n")},\n];`,
  ];

  await Deno.writeTextFile(options.outFile, `${HEADER}\n${chunks.join("\n\n")}\n`);
  return SUBSETS.length + SUBSETS_BOLD.length;
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
