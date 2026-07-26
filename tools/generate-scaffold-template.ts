// Вбудовування дерева шаблону scaffold у TS-модуль.
//
// Причина та сама, що й у generate-core-sql.ts та generate-client-assets.ts, і
// тут вона найгостріша: `@altera/create` запускають командою
// `deno run -A jsr:@altera/create my-erp` — без установки, без `vendor/`, без
// каталогу на диску взагалі. Усе, що пакет може віддати, — це модулі. Тому
// шаблон лишається деревом справжніх файлів (їх редагують і читають як код), а
// в пакет їде згенерованою мапою «шлях → вміст».
import { join, relative, SEPARATOR } from "@std/path";

const HEADER = `// ЗГЕНЕРОВАНО \`deno task scaffold:template\` з create/template/** — не редагувати.
//
// Чому шаблон вбудований, а не читається з диска — у
// tools/generate-scaffold-template.ts.
`;

/** Файли, які в шаблоні не потрібні. */
const IGNORED = new Set([".DS_Store"]);

async function collect(dir: string, root: string, out: Map<string, string>) {
  for await (const entry of Deno.readDir(dir)) {
    const full = join(dir, entry.name);

    if (entry.isDirectory) {
      await collect(full, root, out);
      continue;
    }

    if (!entry.isFile || IGNORED.has(entry.name)) continue;

    const key = relative(root, full).split(SEPARATOR).join("/");
    // LF — щоб артефакт не залежав від core.autocrlf (див. generate-core-sql.ts).
    out.set(key, (await Deno.readTextFile(full)).replaceAll("\r\n", "\n"));
  }
}

export async function generateScaffoldTemplate(
  options: { templateDir: string; outFile: string; verbose?: boolean },
): Promise<number> {
  const files = new Map<string, string>();
  await collect(options.templateDir, options.templateDir, files);

  const keys = [...files.keys()].sort();
  const entries = keys.map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(files.get(key))},`);

  if (options.verbose) for (const key of keys) console.log(`· ${key}`);

  await Deno.writeTextFile(
    options.outFile,
    `${HEADER}\nexport const TEMPLATE: Record<string, string> = {\n${entries.join("\n")}\n};\n`,
  );

  return keys.length;
}

async function main() {
  const verbose = Deno.args.includes("--verbose");
  const positional = Deno.args.filter((arg) => !arg.startsWith("--"));
  const [templateDir, outFile] = positional;

  if (!templateDir || !outFile) {
    throw new Error("Вжиток: generate-scaffold-template <templateDir> <outFile> [--verbose]");
  }

  const count = await generateScaffoldTemplate({ templateDir, outFile, verbose });
  console.log(`✓ ${count} файлів → ${outFile}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("❌ Генерація шаблону scaffold впала:", error);
    Deno.exit(1);
  });
}
