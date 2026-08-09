// Складання локалей застосунку з файлів, що лежать поряд із кодом.
//
// Навіщо. Усе, що належить моделі, живе в її каталозі — манифест, схема,
// екрани, `db/*.sql`, шаблони друку. Усе, крім рядків перекладу: вони лежали
// одним файлом на застосунок, і належність трималася на угоді про префікс
// (`bank.*` — це модель `bank`). Угода вже розходилася з дійсністю в чотирьох
// місцях, а перевірити її не було чим: файл спільний, дописати в нього можна
// що завгодно.
//
// Тепер джерело — `_locales/` у каталозі власника, а `app/_locales/*.json`
// збирається з них. Належність стає структурною, тобто збрехати про неї не
// можна: рядок лежить рівно там, де код, який його показує.
//
// Чому вихід лишився в `app/_locales/`, хоч і генерується: саме звідти пресет
// Vite копіює локалі в `dist/locales/app/`, причому ПЛОСКО (`stripBase: true`).
// Класти джерела підкаталогами туди ж не можна — плоска копія звалила б їх в
// одну теку з виходом. Той самий прийом, що зі згенерованим CRUD-SQL: артефакт
// комітиться, бо той, хто склонував репозиторій, має отримати робочий
// застосунок без запуску задач.
import { join, relative, SEPARATOR } from "@std/path";

/** Каталог-джерело: як називається в дереві й що в ньому лежить. */
export interface LocaleSource {
  /** Власник — шлях каталогу відносно app/ (`catalog/bank`, `shared`). */
  owner: string;
  /** Код мови → рядки, у порядку файлу. */
  byLocale: Map<string, Record<string, string>>;
}

export interface MergeResult {
  /** Код мови → зібрані рядки. */
  locales: Map<string, Record<string, string>>;
  /** Один ключ у двох власників — це помилка, а не попередження. */
  collisions: Array<{ key: string; owners: string[] }>;
  /** Ключ є в одній мові власника й відсутній в іншій. */
  gaps: Array<{ owner: string; locale: string; keys: string[] }>;
}

/** Каталоги, у які не заходимо: продукти збірки й чужі дерева. */
const SKIP_DIRS = new Set(["node_modules", "dist", ".vite", "_sqlpackage", "_generated"]);

/**
 * Каталоги `_locales/` у дереві застосунку, крім кореневого.
 *
 * Кореневий — це ВИХІД. Прочитати його разом із джерелами означало б, що раз
 * зібраний файл сам себе відтворює: прибраний з моделі ключ лишався б у виході
 * назавжди, і причини не було б видно ніде.
 */
export async function collectLocaleSources(appDir: string): Promise<LocaleSource[]> {
  const sources: LocaleSource[] = [];

  async function walk(dir: string): Promise<void> {
    const entries: Deno.DirEntry[] = [];
    for await (const entry of Deno.readDir(dir)) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (!entry.isDirectory || SKIP_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);

      if (entry.name === "_locales") {
        if (dir === appDir) continue; // вихід, не джерело
        sources.push(await readSource(appDir, path));
        continue;
      }
      await walk(path);
    }
  }

  await walk(appDir);
  return sources;
}

async function readSource(appDir: string, localeDir: string): Promise<LocaleSource> {
  const owner = relative(appDir, join(localeDir, "..")).replaceAll(SEPARATOR, "/");
  const byLocale = new Map<string, Record<string, string>>();

  const names: string[] = [];
  for await (const entry of Deno.readDir(localeDir)) {
    if (entry.isFile && entry.name.endsWith(".json")) names.push(entry.name);
  }
  names.sort();

  for (const name of names) {
    const text = await Deno.readTextFile(join(localeDir, name));
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`${owner}/_locales/${name}: ${(error as Error).message}`);
    }
    byLocale.set(name.slice(0, -".json".length), parsed);
  }

  return { owner, byLocale };
}

/**
 * Склейка.
 *
 * Порядок власників — алфавітний, ключі всередині власника — у порядку файлу.
 * Не суцільне сортування за ключем: вихід комітиться, тож дифф має лишатися
 * там, де правка, а не розповзатися файлом.
 */
export function mergeLocales(sources: LocaleSource[]): MergeResult {
  const codes = new Set<string>();
  for (const source of sources) for (const code of source.byLocale.keys()) codes.add(code);

  const ordered = [...sources].sort((left, right) => left.owner.localeCompare(right.owner));
  const locales = new Map<string, Record<string, string>>();
  const claimedBy = new Map<string, string[]>();

  for (const code of [...codes].sort()) {
    const merged: Record<string, string> = {};
    for (const source of ordered) {
      for (const [key, value] of Object.entries(source.byLocale.get(code) ?? {})) {
        merged[key] = value;
      }
    }
    locales.set(code, merged);
  }

  // Зіткнення рахуються по ВСІХ мовах разом: ключ, доданий двом власникам лише
  // в українській, це та сама помилка — просто помітна не одразу.
  for (const source of ordered) {
    const keys = new Set<string>();
    for (const strings of source.byLocale.values()) for (const key of Object.keys(strings)) keys.add(key);
    for (const key of keys) claimedBy.set(key, [...(claimedBy.get(key) ?? []), source.owner]);
  }

  const collisions = [...claimedBy]
    .filter(([, owners]) => owners.length > 1)
    .map(([key, owners]) => ({ key, owners }));

  const gaps: MergeResult["gaps"] = [];
  for (const source of ordered) {
    const all = new Set<string>();
    for (const strings of source.byLocale.values()) for (const key of Object.keys(strings)) all.add(key);
    for (const code of [...codes].sort()) {
      const strings = source.byLocale.get(code);
      if (!strings) {
        gaps.push({ owner: source.owner, locale: code, keys: [...all] });
        continue;
      }
      const missing = [...all].filter((key) => !(key in strings));
      if (missing.length) gaps.push({ owner: source.owner, locale: code, keys: missing });
    }
  }

  return { locales, collisions, gaps };
}

export interface GenerateAppLocalesOptions {
  appDir: string;
  verbose?: boolean;
  /** Нічого не писати — лише порахувати. Використовує проба. */
  dryRun?: boolean;
}

export interface GenerateAppLocalesResult extends MergeResult {
  sources: LocaleSource[];
  /** Ім'я файлу → текст, як він має лежати в `app/_locales/`. */
  files: Map<string, string>;
}

/**
 * Перелік мов застосунку окремим файлом.
 *
 * Потрібен рівно для перемикача мови в інтерфейсі: браузер каталогів не читає,
 * а рахувати мови з чогось іншого нізвідки — рядки приїжджають по одному файлу
 * на мову, і про існування сусіднього рантайм не знає. Без цього переліку
 * «поклав `pl.json` — мова з'явилася» трималося б на тому, що хтось не забув
 * дописати «pl» ще й у список усередині коду шапки.
 *
 * Ім'я з підкресленням, щоб не збігтися з кодом мови: `_index` мовною міткою
 * бути не може, тож звичайний файл локалі його ніколи не перекриє.
 */
export const LOCALE_INDEX_FILE = "_index.json";

/**
 * Попередження про генерацію — ключем `"//"`, бо коментарів у JSON немає.
 *
 * Той самий прийом, що в `deno.json` цього репозиторію. Ключ доїжджає до
 * клієнта разом з іншими й лягає в мапу перекладів, але покликати його нікому:
 * `t("//")` не пишуть. Зате напис лежить рівно там, куди дивиться той, хто
 * зібрався правити файл руками, — а це єдине місце, де правку ще можна не
 * зробити. Розсинхрон, якщо її все ж зробили, ловить проба.
 */
export const GENERATED_NOTICE =
  "ЗГЕНЕРОВАНО `deno task locales:build` з _locales/ поряд із кодом — не редагувати.";

/** Текст вихідного файлу однієї мови. Окремо — щоб проба звіряла без запису. */
export function renderLocaleFile(strings: Record<string, string>): string {
  return JSON.stringify({ "//": GENERATED_NOTICE, ...strings }, null, 2) + "\n";
}

/** Текст переліку мов. Назви мов тут не пишемо — їх дає `Intl` на клієнті. */
export function renderLocaleIndex(codes: string[]): string {
  return JSON.stringify({ "//": GENERATED_NOTICE, locales: [...codes].sort() }, null, 2) + "\n";
}

export async function generateAppLocales(
  options: GenerateAppLocalesOptions,
): Promise<GenerateAppLocalesResult> {
  const { appDir, verbose, dryRun } = options;

  const sources = await collectLocaleSources(appDir);
  if (sources.length === 0) {
    throw new Error(`У ${appDir} немає жодного каталогу _locales/ поряд із кодом — збирати нічого.`);
  }

  const merged = mergeLocales(sources);

  if (merged.collisions.length) {
    const lines = merged.collisions.map((c) => `  ${c.key} ← ${c.owners.join(", ")}`);
    throw new Error(
      `Один ключ оголошений кількома власниками:\n${lines.join("\n")}\n` +
        "Ключ належить одному місцю: або перенеси його в спільний shared/_locales, або перейменуй.",
    );
  }

  const files = new Map<string, string>();
  for (const [code, strings] of merged.locales) files.set(`${code}.json`, renderLocaleFile(strings));
  files.set(LOCALE_INDEX_FILE, renderLocaleIndex([...merged.locales.keys()]));

  if (!dryRun) {
    const outDir = join(appDir, "_locales");
    await Deno.mkdir(outDir, { recursive: true });
    for (const [name, text] of files) {
      await Deno.writeTextFile(join(outDir, name), text);
    }
  }

  if (verbose) {
    for (const source of sources) {
      const counts = [...source.byLocale].map(([code, s]) => `${code}:${Object.keys(s).length}`).join(" ");
      console.log(`· ${source.owner.padEnd(28)} ${counts}`);
    }
  }
  for (const gap of merged.gaps) {
    console.log(`⚠ ${gap.owner}: у мові ${gap.locale} немає ${gap.keys.length} ключ(ів) — ${gap.keys.slice(0, 5).join(", ")}${gap.keys.length > 5 ? " …" : ""}`);
  }

  return { ...merged, sources, files };
}

async function main() {
  const verbose = Deno.args.includes("--verbose");
  const appDir = Deno.args.find((arg) => !arg.startsWith("--"));
  if (!appDir) {
    throw new Error("Вкажи каталог застосунку: generate-app-locales <appDir> [--verbose]");
  }

  const { locales, sources } = await generateAppLocales({ appDir, verbose });
  const counts = [...locales].map(([code, s]) => `${code}: ${Object.keys(s).length}`).join(", ");
  console.log(`✓ ${sources.length} джерел → ${join(appDir, "_locales")} (${counts}) + ${LOCALE_INDEX_FILE}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("❌ Складання локалей застосунку впало:\n", error.message ?? error);
    Deno.exit(1);
  });
}
