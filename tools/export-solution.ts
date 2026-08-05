/// <reference lib="deno.ns" />
/**
 * Вивантаження прикладного рішення у переносимий пакет.
 *
 * Прикладне рішення — це каталог `app/` цілком, і більше нічого: моделі
 * (манифест, схема, екрани, `db/*.sql`, шаблони друку), локалі, стилі,
 * оболонка, обидва composition root. Усе інше в корені репозиторію —
 * `deno.json`, `vite.config.ts`, `tsconfig.json`, `scripts/` — належить
 * КАРКАСУ: його дає scaffold, і рішення його не везе.
 *
 * Перетин рівно один — карта імпортів. Рішення може користуватися пакетами,
 * яких у свіжому scaffold немає, тому пакет несе перелік **фактично вжитих**
 * зовнішніх специфікаторів разом із версіями з джерела. Не всю карту імпортів:
 * у ній лежать і залежності каркаса, і сміття, яким рішення не користується, —
 * а перелік має відповідати на питання «чого цьому рішенню бракує в приймачі»,
 * а не «що було в deno.json того, хто вивантажував».
 *
 * Формат — `.tar.gz`: у дереві є бінарники (`favicon.ico`), і карта
 * «шлях → текст» тут не годиться.
 *
 * Запуск:
 *   deno task solution:export                       # → solution.tar.gz
 *   deno task solution:export -- --out my.tar.gz --name erp --version 1.2.0
 */
import { basename, dirname, join, relative, resolve, SEPARATOR } from "@std/path";
import { TarStream, type TarStreamInput } from "@std/tar";

/** Версія формату пакета. Приймач відмовляється читати незнайому. */
export const SOLUTION_FORMAT_VERSION = 1;

/**
 * Пакети фреймворку, чиї піни пакет мусить назвати.
 *
 * `@altera/skills` сюди не входить: він не імпортується кодом узагалі —
 * задача `skills:sync` розкладає скіли у `.claude/skills`, і в карті імпортів
 * його немає ні в шаблоні scaffold, ні деінде. Звіряти те, чого в карті не
 * буває, означало б друкувати зауваження при кожному завантаженні.
 */
const FRAMEWORK_PACKAGES = ["@altera/client", "@altera/server", "@altera/tools"];

/**
 * Пін пакета в карті імпортів.
 *
 * Дві форми, і обидві законні: `"@altera/server": "jsr:@altera/server@^0.6.1"`
 * (пакет цілком) і `"@altera/tools/": "jsr:/@altera/tools@^0.4.6/"` (лише
 * префікс для підшляхів — саме так підключений tools у шаблоні scaffold).
 * Дивитися тільки на першу означало б вважати, що версії немає.
 */
export function frameworkPin(imports: Record<string, string>, pkg: string): string | undefined {
  return imports[pkg] ?? imports[`${pkg}/`];
}

/**
 * Що з `app/` не їде.
 *
 * `_sqlpackage` і `.vite` — продукти збірки (обидва в `.gitignore`): перший
 * відновлює `sql:assemble`, другий Vite робить сам. Класти їх у пакет означало б
 * везти чужий стан і робити пакет недетермінованим від запуску до запуску.
 *
 * `_generated` НЕ виключено навмисно, хоч і генерується: це закомічений
 * вихідник (як згенерований CRUD-SQL), і пакет має бути самоописовим — приймач
 * бачить реєстр моделей до того, як щось запускав.
 */
const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".vite", "_sqlpackage"]);

export interface SolutionFileEntry {
  /** Шлях відносно каталогу застосунку, завжди через `/`. */
  path: string;
  size: number;
  sha256: string;
}

export interface SolutionManifest {
  formatVersion: number;
  name: string;
  version: string;
  exportedAt: string;
  /** Піни пакетів фреймворку, під якими рішення збиралося. */
  framework: Record<string, string>;
  /** Зовнішні специфікатори, ужиті кодом рішення, і їхні версії з джерела. */
  dependencies: Record<string, string>;
  files: SolutionFileEntry[];
}

// ── Обхід дерева ─────────────────────────────────────────────────────────────

async function* walkFiles(dir: string, base: string): AsyncGenerator<string> {
  const entries: Deno.DirEntry[] = [];
  for await (const entry of Deno.readDir(dir)) entries.push(entry);
  // Детермінований порядок: пакет, зібраний двічі з того самого дерева, має
  // бути тим самим набором у тому самому порядку.
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      yield* walkFiles(path, base);
    } else if (entry.isFile) {
      yield relative(base, path).replaceAll(SEPARATOR, "/");
    }
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Карта імпортів ───────────────────────────────────────────────────────────

/** `deno.json`/`deno.jsonc` як об'єкт. Коментарі в них є — це JSONC. */
async function readJsonc(path: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await Deno.readTextFile(path);
    return JSON.parse(stripJsonComments(text)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Прибирає коментарі JSONC.
 *
 * Посимвольно, а не регуляркою: у карті імпортів трапляється `npm:` і `jsr:/`,
 * і наївне `//`-правило зрізало б половину рядка залежності.
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += ch;
  }

  return out;
}

/** Специфікатор із рядка імпорту чи ре-експорту. */
function importSpecifier(line: string): string | null {
  const match = line.match(/\bfrom\s+["']([^"']+)["']/) ??
    line.match(/^\s*import\s+["']([^"']+)["']/) ??
    line.match(/\bimport\(\s*["']([^"']+)["']/);
  return match ? match[1] : null;
}

/**
 * Зовнішні специфікатори, якими користується код рішення.
 *
 * Не потрапляють: відносні шляхи, аліаси самого застосунку (`@app/`,
 * `@shared/`), фреймворк (`@client/`, `@altera/*` — вони йдуть окремим блоком
 * `framework`) і повні специфікатори (`npm:`, `jsr:`, `node:`, `https:`), які
 * не потребують запису в карті імпортів.
 */
/**
 * Під яким ключем карти імпортів живе специфікатор.
 *
 * Три випадки, і третій — не дрібниця: `lit/decorators.js` у карті не
 * оголошений і не мусить бути — там є `lit`, а підшлях резолвиться вже
 * експорт-мапою самого пакета. Без зведення до кореня пакета кожен такий
 * підшлях їхав би в манифест окремим рядком «версія невідома», і приймач
 * отримував би список неіснуючих залежностей.
 */
export function resolveImportKey(specifier: string, imports: Record<string, string>): string {
  if (imports[specifier]) return specifier;

  // Префіксний ключ карти імпортів (`@client/`, `@app/`).
  const prefixKey = Object.keys(imports)
    .filter((candidate) => candidate.endsWith("/") && specifier.startsWith(candidate))
    // Найдовший збіг виграє: `@sinclair/typebox/value` перекриває `@sinclair/typebox`.
    .sort((left, right) => right.length - left.length)[0];
  if (prefixKey) return prefixKey;

  const segments = specifier.split("/");
  const packageName = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
  return imports[packageName] ? packageName : specifier;
}

async function collectDependencies(appDir: string, imports: Record<string, string>) {
  const used = new Set<string>();

  for await (const relPath of walkFiles(appDir, appDir)) {
    if (!relPath.endsWith(".ts") && !relPath.endsWith(".tsx")) continue;
    const text = await Deno.readTextFile(join(appDir, relPath));
    for (const line of text.split("\n")) {
      if (!/^\s*(import|export)\b/.test(line) && !/\bimport\(/.test(line)) continue;
      const specifier = importSpecifier(line);
      if (!specifier) continue;
      if (/^[./]/.test(specifier)) continue;
      if (/^(npm|jsr|node|https?|data):/.test(specifier)) continue;
      if (specifier.startsWith("@app/") || specifier.startsWith("@shared/")) continue;
      if (specifier.startsWith("@client/") || specifier.startsWith("@altera/")) continue;

      used.add(resolveImportKey(specifier, imports));
    }
  }

  const dependencies: Record<string, string> = {};
  for (const key of [...used].sort()) {
    dependencies[key] = imports[key] ?? "";
  }
  return dependencies;
}

/**
 * Піни фреймворку.
 *
 * Два джерела, бо вивантажувати доводиться з обох боків: у встановленому
 * застосунку версії стоять у карті імпортів (`jsr:@altera/client@^0.6.2`), а в
 * репозиторії самого фреймворку їх там немає взагалі — пакети підключені
 * членами воркспейсу, і версія лежить у їхньому власному `deno.json`.
 */
async function collectFrameworkPins(root: string, config: Record<string, unknown>) {
  const imports = (config.imports ?? {}) as Record<string, string>;
  const pins: Record<string, string> = {};

  for (const pkg of FRAMEWORK_PACKAGES) {
    const pin = frameworkPin(imports, pkg);
    if (pin) {
      pins[pkg] = pin;
      continue;
    }

    for (const member of (config.workspace ?? []) as string[]) {
      const memberConfig = await readJsonc(join(root, member, "deno.json"));
      if (memberConfig?.name === pkg && typeof memberConfig.version === "string") {
        pins[pkg] = `jsr:${pkg}@^${memberConfig.version}`;
        break;
      }
    }
  }

  return pins;
}

// ── Вивантаження ─────────────────────────────────────────────────────────────

export interface ExportOptions {
  out?: string;
  name?: string;
  version?: string;
  verbose?: boolean;
}

export async function exportSolution(appDirArg: string, options: ExportOptions = {}) {
  const appDir = resolve(Deno.cwd(), appDirArg);
  const root = dirname(appDir);

  const stat = await Deno.stat(appDir).catch(() => null);
  if (!stat?.isDirectory) {
    throw new Error(`Каталог застосунку не знайдено: ${appDir}`);
  }

  const config = await readJsonc(join(root, "deno.json")) ??
    await readJsonc(join(root, "deno.jsonc")) ?? {};
  const imports = (config.imports ?? {}) as Record<string, string>;

  const files: SolutionFileEntry[] = [];
  const contents = new Map<string, Uint8Array>();

  for await (const relPath of walkFiles(appDir, appDir)) {
    const bytes = await Deno.readFile(join(appDir, relPath));
    contents.set(relPath, bytes);
    files.push({ path: relPath, size: bytes.byteLength, sha256: await sha256(bytes) });
  }

  if (files.length === 0) {
    throw new Error(`У ${appDir} немає жодного файлу — вивантажувати нічого.`);
  }

  const manifest: SolutionManifest = {
    formatVersion: SOLUTION_FORMAT_VERSION,
    name: options.name ?? basename(root),
    version: options.version ?? "0.0.0",
    exportedAt: new Date().toISOString(),
    framework: await collectFrameworkPins(root, config),
    dependencies: await collectDependencies(appDir, imports),
    files,
  };

  const outPath = resolve(Deno.cwd(), options.out ?? `${manifest.name}-solution.tar.gz`);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n");

  // Манифест ПЕРШИМ записом: приймач читає його потоком і може відмовитися
  // (незнайомий формат, розбіжність версій) не розпаковуючи решти.
  const entries: TarStreamInput[] = [
    { type: "file", path: "solution.json", size: manifestBytes.byteLength, readable: bytesStream(manifestBytes) },
    ...files.map((file): TarStreamInput => {
      const bytes = contents.get(file.path)!;
      return { type: "file", path: `app/${file.path}`, size: bytes.byteLength, readable: bytesStream(bytes) };
    }),
  ];

  const outFile = await Deno.create(outPath);
  await ReadableStream.from(entries)
    .pipeThrough(new TarStream())
    .pipeThrough(new CompressionStream("gzip"))
    .pipeTo(outFile.writable);

  const packed = (await Deno.stat(outPath)).size;

  if (options.verbose) {
    console.log(`  рішення:     ${manifest.name}@${manifest.version}`);
    console.log(`  файлів:      ${files.length}`);
    for (const [pkg, pin] of Object.entries(manifest.framework)) console.log(`  фреймворк:   ${pkg} → ${pin}`);
    for (const [dep, pin] of Object.entries(manifest.dependencies)) {
      console.log(`  залежність:  ${dep}${pin ? ` → ${pin}` : "  ⚠ немає в карті імпортів джерела"}`);
    }
  }
  console.log(`✅ ${outPath} — ${files.length} файлів, ${(packed / 1024).toFixed(1)} КБ`);

  return { manifest, outPath };
}

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

if (import.meta.main) {
  const args = [...Deno.args];
  const flag = (name: string) => {
    const index = args.indexOf(`--${name}`);
    if (index === -1) return undefined;
    return args.splice(index, 2)[1];
  };

  const verbose = args.includes("--verbose");
  const out = flag("out");
  const name = flag("name");
  const version = flag("version");
  const appDir = args.find((arg) => !arg.startsWith("--")) ?? "./app";

  await exportSolution(appDir, { out, name, version, verbose });
}
