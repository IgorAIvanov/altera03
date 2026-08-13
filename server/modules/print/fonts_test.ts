// Вбудовані шрифти друку не розійшлися з @fontsource/roboto на диску.
//
// Та сама проба, що й у core-sql_test.ts: артефакт генерується руками
// (`deno task print:fonts`), тож після оновлення @fontsource/roboto у пакет
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
  new URL("../../../node_modules/@fontsource/roboto/files/", import.meta.url),
);

// Порядок такий самий, як у генераторі: рендерер бере перший субсет, що
// покриває символ, тож переставлені місцями файли змінили б і вибір шрифту.
const CASES = [
  { file: "roboto-cyrillic-400-normal.woff", embedded: PRINT_FONT_SUBSETS_REGULAR[0]!.base64 },
  { file: "roboto-cyrillic-700-normal.woff", embedded: PRINT_FONT_SUBSETS_BOLD[0]!.base64 },
];

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
