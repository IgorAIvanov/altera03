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

const HEADER = `// ЗГЕНЕРОВАНО \`deno task print:fonts\` з @fontsource/* — не редагувати.
//
// УВАГА, ЛІЦЕНЗІЯ. Нижче лежать НЕ наші байти: субсети Roboto та PT Sans під
// SIL Open Font License 1.1. OFL вбудовування дозволяє, але вимагає, щоб її
// текст ішов РАЗОМ із даними, і забороняє віддавати їх під іншою ліцензією —
// тобто «пакет під MIT» про цей файл сказати не можна. Тому поруч лежить
// THIRD-PARTY-NOTICES.md (той самий прогін генератора), а поле \`license\` у
// server/deno.json лишається «MIT»: JSR приймає один упізнаваний ідентифікатор
// SPDX і складений вираз відхиляє. Тож єдине місце, де сказано про OFL, — оці
// нотиси. Без них твердження пакета було б неповним, а вимога OFL — невиконаною.
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
 * Субсети, з яких складається бланк. Порядок значущий: рендерер бере ПЕРШИЙ,
 * що покриває символ, тож основна гарнітура мусить стояти вище.
 *
 * Шляхи — від каталогу `node_modules/@fontsource`, бо гарнітур тут дві.
 *
 * **Roboto cyrillic** — основна: кирилиця та `№`. Латиницю, лапки-ялинки,
 * тире, апостроф і три крапки покриває Helvetica з pdf-lib, тож `latin` тут
 * зайвий.
 *
 * **PT Sans cyrillic-ext** — рівно заради знака гривні `₴` (U+20B4). Його
 * немає ні у WinAnsi, ні в ЖОДНОМУ з 162 файлів @fontsource/roboto (перевірено
 * скануванням), тож без другої гарнітури сума зі знаком гривні друкувалася б
 * порожньою рамкою. З трьох гарнітур, у яких гліф знайшовся (Inter, Noto Sans,
 * PT Sans), узята найдешевша: 10.8 КБ проти 13.0 і 28.0.
 *
 * Ціна рішення чесна: `₴` малюється іншою гарнітурою, ніж цифри поруч. Для
 * знака валюти це непомітно, а альтернатива — міняти гарнітуру ВСІХ бланків,
 * під яку вже підібрані ширини колонок.
 *
 * Жодна українська літера сюди не провалюється: Roboto покриває і `Ґґ`
 * (U+0490-0491), і `ЄІЇєії` з основного діапазону.
 *
 * Ліцензії дозволяють вбудовування: обидві гарнітури під OFL-1.1. Roboto був
 * Apache 2.0 і став OFL у @fontsource/roboto 5.3.0 — тобто ліцензія вбудованих
 * байтів МІНЯЄТЬСЯ з версією пакета, і виписати її сюди руками означало б
 * отримати назавжди застряглий рядок (саме це тут і сталося). Тому нотиси
 * збираються з LICENSE у node_modules тим самим прогоном, що й байти.
 *
 * Reserved Font Name не оголошено в жодної з двох (у тексті OFL обох пакетів
 * після copyright порожньо), тож субсети не потребують перейменування — інакше
 * назву довелося б міняти вже й у метриках, і в шаблонах бланків.
 */
const SUBSETS = [
  "roboto/files/roboto-cyrillic-400-normal.woff",
  "pt-sans/files/pt-sans-cyrillic-ext-400-normal.woff",
];
const SUBSETS_BOLD = [
  "roboto/files/roboto-cyrillic-700-normal.woff",
  "pt-sans/files/pt-sans-cyrillic-ext-700-normal.woff",
];

/**
 * Нотиси на вбудовані шрифти: перелік пакетів, їхні copyright і повний текст
 * ліцензії.
 *
 * Збирається з тих самих файлів, з яких беруться байти, і в тому ж прогоні —
 * бо саме розсинхрон тут і є ризиком: доданий п'ятий субсет під іншою
 * ліцензією не викликав би НІЧОГО (модуль зібрався б, друк працював би), а
 * зобов'язання з'явилося б мовчки.
 *
 * Тексти OFL у різних пакетів побайтово однакові й різняться лише рядком
 * copyright, тож однаковий текст друкується один раз на групу — 93 рядки на
 * кожну гарнітуру були б не повагою до ліцензії, а шумом, у якому не видно
 * власне переліку.
 */
async function buildNotices(fontsDir: string, files: string[]): Promise<string> {
  const packages = [...new Set(files.map((file) => file.split("/")[0]!))];

  // Ключ — текст ліцензії без рядка copyright: групуємо однакові.
  const groups = new Map<string, { spdx: string; entries: string[] }>();

  for (const pkg of packages) {
    const meta = JSON.parse(
      await Deno.readTextFile(join(fontsDir, pkg, "package.json")),
    ) as { name: string; version: string; license: string };
    const license = await Deno.readTextFile(join(fontsDir, pkg, "LICENSE"));

    const [copyright, ...rest] = license.replaceAll("\r\n", "\n").split("\n");
    const body = rest.join("\n").trim();

    const group = groups.get(body) ?? { spdx: meta.license, entries: [] };
    group.entries.push(`- \`${meta.name}\` ${meta.version} — ${copyright!.trim()}`);
    groups.set(body, group);
  }

  const sections = [...groups].map(([body, group]) =>
    `## ${group.spdx}\n\n${group.entries.join("\n")}\n\n\`\`\`\n${body}\n\`\`\``
  );

  return [
    "# Сторонні компоненти в @altera/server",
    "",
    "<!-- ЗГЕНЕРОВАНО `deno task print:fonts` — не редагувати. -->",
    "",
    "Код пакета — MIT (див. `LICENSE`). Але `modules/print/fonts.generated.ts`",
    "містить ВБУДОВАНІ байти шрифтів, і вони під власною ліцензією: пакет везе їх",
    "усередині себе, тож її текст мусить їхати разом із ним. Решта залежностей",
    "(`pdf-lib`, `postgres`, `@danet/core`…) сюди не входить навмисно — вони",
    "резолвляться споживачем із реєстру, у пакет не потрапляють і атрибуції з нас",
    "не вимагають.",
    "",
    ...sections,
    "",
  ].join("\n");
}

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
  options: { fontsDir: string; outFile: string; noticesFile: string; verbose?: boolean },
): Promise<number> {
  const regular = await buildSubsets(options.fontsDir, SUBSETS, options.verbose);
  const bold = await buildSubsets(options.fontsDir, SUBSETS_BOLD, options.verbose);

  const chunks = [
    `export const PRINT_FONT_SUBSETS_REGULAR: readonly PrintFontSubset[] = [\n${regular.join(",\n")},\n];`,
    `export const PRINT_FONT_SUBSETS_BOLD: readonly PrintFontSubset[] = [\n${bold.join(",\n")},\n];`,
  ];

  await Deno.writeTextFile(options.outFile, `${HEADER}\n${chunks.join("\n\n")}\n`);

  const notices = await buildNotices(options.fontsDir, [...SUBSETS, ...SUBSETS_BOLD]);
  await Deno.writeTextFile(options.noticesFile, notices);
  if (options.verbose) console.log(`· нотиси → ${options.noticesFile}`);

  return SUBSETS.length + SUBSETS_BOLD.length;
}

async function main() {
  const verbose = Deno.args.includes("--verbose");
  const [fontsDir, outFile, noticesFile] = Deno.args.filter((arg) => !arg.startsWith("--"));

  if (!fontsDir || !outFile || !noticesFile) {
    throw new Error(
      "Вжиток: generate-print-fonts <fontsDir> <outFile> <noticesFile> [--verbose]",
    );
  }

  const count = await generatePrintFonts({ fontsDir, outFile, noticesFile, verbose });
  console.log(`✓ ${count} шрифтів → ${outFile}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("❌ Вбудовування шрифтів упало:", error);
    Deno.exit(1);
  });
}
