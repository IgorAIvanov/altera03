// Вбудовування неісполнюваних ресурсів клієнта у TS-модулі.
//
// Навіщо. Пакет із JSR доїжджає до застосунку **тільки модулями**: `deno install`
// з `"vendor": true` матеріалізує на диск лише те, що є в графі імпортів, а кеш
// DENO_DIR — це файли з іменами-хешами. Тема (`styles/theme.css`) і локалі
// (`_locales/*.json`) модулями не є, тому у встановленому застосунку їх немає
// взагалі — збірка падала на
// `ENOENT: vendor/jsr.io/@altera/client/<версія>/styles/theme.css`.
//
// Тому текст їде в згенерованих `.ts`, а вихідники лишаються нормальними `.css`
// і `.json`. Той самий прийом, що і з SQL ядра (tools/generate-core-sql.ts), і з
// тієї ж причини — розсинхрон ловить проба в `deno task test:unit`.
import { join } from "@std/path";

const THEME_HEADER = `// ЗГЕНЕРОВАНО \`deno task client:assets\` з client/styles/theme.css — не редагувати.
//
// Тема доїжджає до застосунку модулем, а не файлом: чому саме так — у
// tools/generate-client-assets.ts.
`;

const LOCALES_HEADER = `// ЗГЕНЕРОВАНО \`deno task client:assets\` з client/_locales/*.json — не редагувати.
//
// Рядки фреймворку вбудовані, а не вивантажуються по HTTP: у встановленому
// застосунку копіювати їх нізвідки (див. tools/generate-client-assets.ts).
// Застосунок свої рядки далі вантажить із /locales/app/<locale>.json.
`;

/** Переводи рядків — у LF: інакше артефакт залежав би від core.autocrlf. */
const normalize = (text: string) => text.replaceAll("\r\n", "\n");

export async function generateClientAssets(
  options: { clientDir: string; verbose?: boolean },
): Promise<{ theme: string; locales: string; localeCount: number }> {
  const { clientDir, verbose } = options;

  const themeCss = normalize(await Deno.readTextFile(join(clientDir, "styles", "theme.css")));
  const themeFile = join(clientDir, "styles", "theme.generated.ts");
  await Deno.writeTextFile(
    themeFile,
    `${THEME_HEADER}\nexport const THEME_CSS: string = ${JSON.stringify(themeCss)};\n`,
  );
  if (verbose) console.log(`· тема: ${themeCss.length} символів`);

  const localeEntries: string[] = [];
  const localeDir = join(clientDir, "_locales");
  const localeNames: string[] = [];
  for await (const entry of Deno.readDir(localeDir)) {
    if (entry.isFile && entry.name.endsWith(".json")) localeNames.push(entry.name);
  }
  localeNames.sort();

  for (const name of localeNames) {
    const code = name.slice(0, -".json".length);
    // Пропускаємо через JSON.parse: так у модуль не потрапить ані форматування,
    // ані зламаний файл — помилка вилізе тут, а не в браузері користувача.
    const strings = JSON.parse(await Deno.readTextFile(join(localeDir, name))) as Record<string, string>;
    localeEntries.push(`  ${JSON.stringify(code)}: ${JSON.stringify(strings)},`);
    if (verbose) console.log(`· локаль ${code}: ${Object.keys(strings).length} рядків`);
  }

  const localesFile = join(clientDir, "_locales.generated.ts");
  await Deno.writeTextFile(
    localesFile,
    `${LOCALES_HEADER}\nexport const CLIENT_LOCALES: Record<string, Record<string, string>> = {\n${
      localeEntries.join("\n")
    }\n};\n`,
  );

  return { theme: themeFile, locales: localesFile, localeCount: localeNames.length };
}

async function main() {
  const verbose = Deno.args.includes("--verbose");
  const dirArg = Deno.args.find((arg) => !arg.startsWith("--"));
  if (!dirArg) {
    throw new Error("Вкажи каталог клієнта: generate-client-assets <clientDir> [--verbose]");
  }

  const { theme, locales, localeCount } = await generateClientAssets({ clientDir: dirArg, verbose });
  console.log(`✓ тема → ${theme}`);
  console.log(`✓ ${localeCount} локал(ей) → ${locales}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("❌ Генерація ресурсів клієнта впала:", error);
    Deno.exit(1);
  });
}
