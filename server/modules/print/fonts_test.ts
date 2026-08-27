// Вбудовані шрифти друку не розійшлися з @fontsource на диску.
//
// Та сама проба, що й у core-sql_test.ts: артефакт генерується руками
// (`deno task print:fonts`), тож після оновлення гарнітури у пакет
// поїхала б стара гарнітура — мовчки, бо все компілюється й малюється.
//
// Якщо node_modules немає (голий чекаут без `deno install`), проба
// ПРОПУСКАЄТЬСЯ: вона стереже свіжість артефакту, а не наявність залежностей,
// і валити на цьому весь `test:unit` було б неправильно.
import { assertEquals } from "@std/assert";
import { encodeBase64 } from "jsr:@std/encoding@^1/base64";
import { fromFileUrl } from "@std/path";
import { PRINT_FONT_SUBSETS_BOLD, PRINT_FONT_SUBSETS_REGULAR } from "./fonts.generated.ts";

const FONTS_DIR = fromFileUrl(
  new URL("../../../node_modules/@fontsource/", import.meta.url),
);

// Порядок такий самий, як у генераторі: рендерер бере перший субсет, що
// покриває символ, тож переставлені місцями файли змінили б і вибір шрифту.
const CASES = [
  { file: "roboto/files/roboto-cyrillic-400-normal.woff", embedded: PRINT_FONT_SUBSETS_REGULAR[0]!.base64 },
  { file: "pt-sans/files/pt-sans-cyrillic-ext-400-normal.woff", embedded: PRINT_FONT_SUBSETS_REGULAR[1]!.base64 },
  { file: "roboto/files/roboto-cyrillic-700-normal.woff", embedded: PRINT_FONT_SUBSETS_BOLD[0]!.base64 },
  { file: "pt-sans/files/pt-sans-cyrillic-ext-700-normal.woff", embedded: PRINT_FONT_SUBSETS_BOLD[1]!.base64 },
];

// Гарнітури, чиї байти лежать у пакеті, — тобто ті, чию ліцензію він зобов'язаний
// нести. Виводяться з CASES, щоб доданий п'ятий субсет не лишився поза нотисами.
const FONT_PACKAGES = [...new Set(CASES.map(({ file }) => file.split("/")[0]!))];

Deno.test("fonts.generated.ts збігається з @fontsource/roboto", async (t) => {
  for (const { file, embedded } of CASES) {
    await t.step(file, async () => {
      let bytes: Uint8Array;
      try {
        bytes = await Deno.readFile(`${FONTS_DIR}${file}`);
      } catch {
        console.log(`  · ${file}: node_modules немає — пропуск`);
        return;
      }

      assertEquals(
        embedded,
        encodeBase64(bytes),
        `${file} змінився після генерації — виконай \`deno task print:fonts\``,
      );
    });
  }
});

// Нотиси не розійшлися з тим, що пакет справді везе.
//
// Проба потрібна саме тут, бо це єдиний спосіб про це дізнатися: підняти версію
// гарнітури або додати п'яту — і все компілюється, друкується й проходить пробу
// вище (байти ж перегенеровані), а в THIRD-PARTY-NOTICES.md лишається вчорашній
// перелік. Невиконане ліцензійне зобов'язання нічого не ламає — воно просто є.
//
// Звіряються три речі, і кожна ловить свій випадок: НАЗВА — забуту гарнітуру,
// ВЕРСІЯ — оновлення (@fontsource/roboto 5.3.0 змінив ліцензію з Apache 2.0 на
// OFL саме мінорним підняттям), ТЕКСТ — підміну самої ліцензії.
Deno.test("THIRD-PARTY-NOTICES.md перелічує вбудовані гарнітури", async (t) => {
  const noticesPath = fromFileUrl(new URL("../../THIRD-PARTY-NOTICES.md", import.meta.url));
  const notices = await Deno.readTextFile(noticesPath);

  for (const pkg of FONT_PACKAGES) {
    await t.step(`@fontsource/${pkg}`, async () => {
      let meta: { name: string; version: string; license: string };
      let license: string;
      try {
        meta = JSON.parse(await Deno.readTextFile(`${FONTS_DIR}${pkg}/package.json`));
        license = await Deno.readTextFile(`${FONTS_DIR}${pkg}/LICENSE`);
      } catch {
        console.log(`  · ${pkg}: node_modules немає — пропуск`);
        return;
      }

      const hint = "виконай `deno task print:fonts`";
      const entry = `\`${meta.name}\` ${meta.version}`;
      assertEquals(notices.includes(entry), true, `нотиси не називають ${entry} — ${hint}`);
      assertEquals(
        notices.includes(`## ${meta.license}`),
        true,
        `нотиси не називають ліцензію ${meta.license} для ${meta.name} — ${hint}`,
      );

      // Перший рядок — copyright гарнітури, він у нотисах іде окремим пунктом;
      // звіряється решта, тобто власне текст ліцензії.
      const body = license.replaceAll("\r\n", "\n").split("\n").slice(1).join("\n").trim();
      assertEquals(
        notices.includes(body),
        true,
        `текст ліцензії ${meta.name} у нотисах не збігається — ${hint}`,
      );
    });
  }
});
