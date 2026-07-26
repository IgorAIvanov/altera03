/// <reference lib="deno.ns" />
// Guardrail меж пакетів.
//
// Дві різні перевірки, і друга з'явилася не просто так: `server/database/migrate.ts`
// роками імпортував `../../../scripts/...` — тобто повз корінь репозиторію, — і
// стара перевірка цього не бачила, бо шукала лише згадки застосунку.
//
//   1. client/* і server/* не імпортують застосунок узагалі — обидва composition
//      root (app/main.ts, app/server.ts) живуть у самому застосунку;
//   2. client/* і server/* не виходять відносними імпортами за власні межі:
//      те, що тягне сусідні каталоги, — не бібліотека, а частина збірки.
//   3. CSS у бібліотеках — плоский: без директив збірки Tailwind і без імпортів
//      з npm. Третя перевірка теж має історію: `client/styles/tailwind.css` довго
//      містив `@source "../../app"` — бібліотека сканувала застосунок, — і жодна
//      з двох попередніх цього не бачила, бо обидві обходять лише `.ts`.
//
// Запуск: deno task check:deps
import { dirname, normalize, resolve, SEPARATOR } from "jsr:@std/path@^1.1.2";

const violations: string[] = [];

async function* walk(dir: string, extensions: string[]): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* walk(path, extensions);
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      yield path;
    }
  }
}

/** Специфікатор із рядка імпорту (`import … from "x"` або `import "x"`). */
function importSpecifier(line: string): string | null {
  const match = line.match(/\bfrom\s+["']([^"']+)["']/) ??
    line.match(/^\s*import\s+["']([^"']+)["']/);
  return match ? match[1] : null;
}

async function* importLines(root: string) {
  for await (const file of walk(root, [".ts", ".tsx"])) {
    const text = await Deno.readTextFile(file);
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!/^\s*import\b/.test(line)) continue;
      yield { file, line, lineNumber: index + 1, specifier: importSpecifier(line) };
    }
  }
}

function report(file: string, lineNumber: number, line: string, reason: string) {
  violations.push(`${file}:${lineNumber}  ${line.trim()}\n      → ${reason}`);
}

/** Бібліотека не має знати про конкретний застосунок. */
async function checkNoAppDependency(root: string, allow: (file: string) => boolean) {
  for await (const { file, line, lineNumber } of importLines(root)) {
    if (allow(file)) continue;
    // `@shared/` — це аліас на `app/shared/`, тож для бібліотеки він така сама
    // залежність від застосунку, як `@app/`. Раніше це було сліпе пятно: client
    // роками імпортував `@shared/schema.ts`, і перевірка цього не бачила, бо
    // шукала лише `@app`/`../app` (schema.ts відтоді переїхав у `client/shared`).
    if (/["']@app\//.test(line) || /["']@shared\//.test(line) || /["'][^"']*\.\.\/app\//.test(line)) {
      report(file, lineNumber, line, "залежність від застосунку");
    }
  }
}

/** Відносний імпорт не має залишати каталог пакета. */
async function checkStaysInsidePackage(root: string) {
  const rootAbs = normalize(resolve(root)) + SEPARATOR;

  for await (const { file, line, lineNumber, specifier } of importLines(root)) {
    if (!specifier?.startsWith(".")) continue;

    const target = normalize(resolve(dirname(resolve(file)), specifier));
    if (!target.startsWith(rootAbs)) {
      report(file, lineNumber, line, `вихід за межі ${root}/ → ${target}`);
    }
  }
}

/**
 * CSS бібліотеки — актив, а не вхід збірки.
 *
 * Директиви Tailwind (`@import "tailwindcss"`, `@source`, `@plugin`) означають, що
 * пакет компілює стилі замість застосунку, а `@source` до того ж указує каталог —
 * саме так `client/` і почав сканувати `app/`. Імпорт з npm (`@fontsource/...`)
 * вимагає node_modules, яких у встановленого пакета немає.
 *
 * Генерація має бути одна, і належить вона застосунку: `app/styles/tailwind.css`.
 */
async function checkCssIsPlain(root: string) {
  const rootAbs = normalize(resolve(root)) + SEPARATOR;

  for await (const file of walk(root, [".css"])) {
    const lines = (await Deno.readTextFile(file)).split("\n");

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const lineNumber = index + 1;

      if (/^\s*@(source|plugin|config|tailwind)\b/.test(line)) {
        report(file, lineNumber, line, "директива збірки Tailwind у бібліотеці");
        continue;
      }

      const imported = line.match(/^\s*@import\s+["']([^"']+)["']/)?.[1];
      if (!imported) continue;

      if (!imported.startsWith(".")) {
        report(file, lineNumber, line, `імпорт поза пакетом: ${imported}`);
        continue;
      }

      const target = normalize(resolve(dirname(resolve(file)), imported));
      if (!target.startsWith(rootAbs)) {
        report(file, lineNumber, line, `вихід за межі ${root}/ → ${target}`);
      }
    }
  }
}

/**
 * Кожен шлях `@client/...`, яким користується застосунок, оголошений в
 * `exports` пакета клієнта.
 *
 * У монорепо `@client/` — аліас на КАТАЛОГ, тому працює будь-який шлях, і
 * дірка в експорт-мапі не видно взагалі. У встановленому застосунку той самий
 * імпорт іде через експорт-мапу і падає. Знайшлося це аж на зібраному з
 * scaffold застосунку: дев'ять шляхів (`auth/session.ts`, `data/api.ts`,
 * `ui-kit/components/*` …) не були оголошені жодного разу за весь час.
 *
 * Перевіряємо і шаблон scaffold — він генерує код, який теж ходить у пакет.
 */
async function checkClientExportsCoverUsage() {
  const manifest = JSON.parse(await Deno.readTextFile("client/deno.json")) as {
    exports: Record<string, string>;
  };
  const declared = new Set(Object.keys(manifest.exports));
  const seen = new Map<string, string>();

  for (const root of ["app", "create/template"]) {
    for await (const file of walk(root, [".ts"])) {
      const lines = (await Deno.readTextFile(file)).split("\n");
      for (const line of lines) {
        const specifier = importSpecifier(line);
        if (!specifier?.startsWith("@client/")) continue;
        const exportPath = "." + specifier.slice("@client".length);
        if (!declared.has(exportPath) && !seen.has(exportPath)) seen.set(exportPath, file);
      }
    }
  }

  for (const [exportPath, file] of seen) {
    violations.push(
      `${file}: ${exportPath} не оголошено в exports пакета @altera/client — ` +
        `у монорепо працює через аліас-каталог, у встановленому застосунку впаде`,
    );
  }
}

await checkClientExportsCoverUsage();

// Винятків більше немає: обидва composition root живуть у застосунку
// (app/server.ts і app/main.ts), тож бібліотеки про застосунок не знають узагалі.
await checkNoAppDependency("client", () => false);
await checkNoAppDependency("server", () => false);
// tools/ читає застосунок лише в рантаймі (аргумент appDir), а не імпортом —
// статичної залежності від app бути не має.
await checkNoAppDependency("tools", () => false);

await checkStaysInsidePackage("client");
await checkStaysInsidePackage("server");
await checkStaysInsidePackage("tools");

await checkCssIsPlain("client");
await checkCssIsPlain("server");

if (violations.length > 0) {
  console.error("❌ Порушення меж пакетів:");
  for (const violation of violations) console.error("  " + violation);
  console.error(
    "\nБібліотека не повинна ані залежати від конкретного застосунку, ані тягнути сусідні\n" +
      "каталоги репозиторію. Залежність від застосунку виноситься через точку розширення\n" +
      "(конфігурація bootstrap, реєстр), а збіркові інструменти живуть у scripts/.",
  );
  Deno.exit(1);
}

console.log(
  "✅ Межі пакетів дотримані: client/server не залежать від app, не виходять за свої каталоги,\n" +
    "   CSS у них — плоский актив без директив збірки.",
);
