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
//
// Запуск: deno task check:deps
import { dirname, normalize, resolve, SEPARATOR } from "jsr:@std/path@^1.1.2";

const violations: string[] = [];

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* walk(path);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
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
  for await (const file of walk(root)) {
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
    if (/["']@app\//.test(line) || /["'][^"']*\.\.\/app\//.test(line)) {
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

// Винятків більше немає: обидва composition root живуть у застосунку
// (app/server.ts і app/main.ts), тож бібліотеки про застосунок не знають узагалі.
await checkNoAppDependency("client", () => false);
await checkNoAppDependency("server", () => false);

await checkStaysInsidePackage("client");
await checkStaysInsidePackage("server");

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

console.log("✅ Межі пакетів дотримані: client/server не залежать від app і не виходять за свої каталоги.");
