/**
 * Реєстр наборів імпорту: `app/_import/**` → модуль зі СТАТИЧНИМИ імпортами.
 *
 * ЧОМУ ЦЕ ПОТРІБНЕ. Набір правил конвертації — це TS-файли, які виконує сама
 * установка: окремого інструмента міграції немає, у клієнта немає Deno.
 * Установка при цьому буває трьох видів — `deno task dev`, однофайловий бінар
 * і Deno Deploy, — а динамічний `import()` за шляхом, зібраним у рантаймі,
 * працює лише в першому з трьох. `deno compile` бере в бінар те, що видно
 * СТАТИЧНО в графі модулів; Deploy — так само.
 *
 * Ту саму пастку ми вже проходили з TS-командами моделей: саме тому вони
 * підключаються не обходом каталогу, а згенерованим `ts-commands.generated.ts`
 * зі статичними `import`. Тут те саме й з тієї самої причини.
 *
 * Для бінаря причина ще й друга, менш очевидна: карта імпортів для
 * `deno compile` рахується з графа `deno info`, а не з `deno.json`. Модуль,
 * підключений динамічно, у граф не потрапляє — отже й залежності правила в
 * карту не поїдуть, і збірка або впаде на «not a dependency and not in import
 * map», або збереться без них.
 *
 * ЧОГО ТУТ СВІДОМО НЕМАЄ — знання про ФОРМАТ правила. Реєстр описує файли
 * набору, а не їхній вміст: що таке правило конвертації, вирішує прикладне
 * рішення, і поки формат не усталився, ядро його не фіксує. Тому все
 * експортоване тут має тип `unknown` — читач сам знає, що він читає.
 */
import { relative, resolve, SEPARATOR } from "@std/path";

/** Один набір: каталог у `app/_import/`. */
export interface ImportSet {
  /** Ім'я набору — воно ж ім'я каталогу: `bas-2.1`, `excel`. */
  name: string;
  /** Шлях каталогу відносно кореня застосунку, у posix-формі. */
  dir: string;
  /** Правила конвертації: ім'я → шлях модуля відносно каталогу набору. */
  rules: Array<{ name: string; path: string }>;
  /** Тексти запитів: ім'я → шлях модуля відносно каталогу набору. */
  queries: Array<{ name: string; path: string }>;
  /**
   * Файли набору, які МОДУЛЯМИ не є: еталон метаданих джерела, зібрана обробка
   * `.epf`, зразок вивантаження. Сервер їх читає або віддає, тож знати про них
   * треба — але імпортувати нема чого.
   */
  files: string[];
}

const RULE_SUFFIX = ".rule.ts";
const QUERY_SUFFIX = ".query.ts";

function toPosix(value: string): string {
  return value.replaceAll(SEPARATOR, "/");
}

/**
 * Ім'я всередині набору — шлях без суфікса.
 *
 * Саме шлях, а не голе ім'я файла: правила можна розкладати по підкаталогах
 * (`catalogs/counterparty.rule.ts`), і два однойменні файли в різних теках не
 * мають зіткнутися. Ціна — ім'я з косою рискою, і це чесно: воно й є адресою.
 */
function entryName(pathInSet: string, suffix: string): string {
  const name = pathInSet.slice(0, -suffix.length);
  // `queries/` — домовлена тека, і нести її в імені означало б, що набір
  // звертається до запиту як `queries["queries/settlement"]`. Знімаємо рівно
  // цей префікс і рівно на верхньому рівні; зіткнення імен після цього —
  // голосна відмова нижче, а не мовчазне перетирання.
  return suffix === QUERY_SUFFIX && name.startsWith("queries/")
    ? name.slice("queries/".length)
    : name;
}

/** Два файли набору дали одне ім'я — це помилка розкладки, а не дрібниця. */
function assertUniqueNames(set: string, kind: string, items: Array<{ name: string; path: string }>) {
  const seen = new Map<string, string>();
  for (const item of items) {
    const first = seen.get(item.name);
    if (first) {
      throw new Error(
        `Набір «${set}»: ${kind} «${item.name}» оголошено двічі — ${first} і ${item.path}. ` +
          `Одне з імен мусить бути іншим, інакше в реєстр потрапить лише одне.`,
      );
    }
    seen.set(item.name, item.path);
  }
}

/** Ідентифікатор для `import` — з адреси, бо вона унікальна в межах набору. */
export function importIdentifier(set: string, kind: string, name: string): string {
  const safe = `${kind}_${set}_${name}`.replace(/[^A-Za-z0-9_$]/g, "_");
  return /^[0-9]/.test(safe) ? `_${safe}` : safe;
}

async function walk(dir: string, base: string, out: string[]): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory) {
      await walk(full, base, out);
    } else if (entry.isFile) {
      out.push(toPosix(relative(base, full)));
    }
  }
}

/**
 * Зібрати набори застосунку. Немає каталогу `_import` — порожній перелік, і це
 * звичайна конфігурація: імпорт потрібен не кожному.
 */
export async function collectImportSets(appDir: string): Promise<ImportSet[]> {
  const root = resolve(appDir, "_import");

  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(root)) entries.push(entry);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }

  const sets: ImportSet[] = [];

  for (const entry of entries.filter((item) => item.isDirectory)) {
    const setDir = resolve(root, entry.name);
    const found: string[] = [];
    await walk(setDir, setDir, found);
    found.sort();

    const set: ImportSet = {
      name: entry.name,
      dir: toPosix(relative(appDir, setDir)),
      rules: [],
      queries: [],
      files: [],
    };

    for (const path of found) {
      if (path.endsWith(RULE_SUFFIX)) {
        set.rules.push({ name: entryName(path, RULE_SUFFIX), path });
      } else if (path.endsWith(QUERY_SUFFIX)) {
        set.queries.push({ name: entryName(path, QUERY_SUFFIX), path });
      } else {
        // Решта — не модулі, навіть якщо це `.ts`. Імпортувати наосліп те, що
        // не оголосило себе правилом чи запитом, означало б тягнути в граф
        // хелпери й чернетки — і падати на першій же з них.
        set.files.push(path);
      }
    }

    assertUniqueNames(set.name, "правило", set.rules);
    assertUniqueNames(set.name, "запит", set.queries);

    sets.push(set);
  }

  sets.sort((left, right) => left.name.localeCompare(right.name));
  return sets;
}

/**
 * Модуль реєстру: статичні `import` плюс дані про файли.
 *
 * `outputDir` — каталог, куди ляже файл (звідти рахуються відносні шляхи
 * імпортів), `appDir` — корінь застосунку, від якого рахується `dir` набору.
 */
export function renderImportSets(
  sets: ImportSet[],
  outputDir: string,
  appDir: string,
): string {
  const imports: string[] = [];
  const blocks: string[] = [];

  const prefix = toPosix(relative(outputDir, appDir)) || ".";
  const specifier = (set: ImportSet, path: string) => {
    const full = `${prefix}/${set.dir}/${path}`;
    return full.startsWith(".") ? full : `./${full}`;
  };

  for (const set of sets) {
    const entry = (kind: "rule" | "query", items: Array<{ name: string; path: string }>) =>
      items.map((item) => {
        const id = importIdentifier(set.name, kind, item.name);
        imports.push(`import ${id} from ${JSON.stringify(specifier(set, item.path))};`);
        return `      ${JSON.stringify(item.name)}: ${id},`;
      });

    const rules = entry("rule", set.rules);
    const queries = entry("query", set.queries);

    blocks.push(
      [
        `  ${JSON.stringify(set.name)}: {`,
        `    dir: ${JSON.stringify(set.dir)},`,
        `    rules: {`,
        ...rules,
        `    },`,
        `    queries: {`,
        ...queries,
        `    },`,
        `    files: ${JSON.stringify(set.files)},`,
        `  },`,
      ].join("\n"),
    );
  }

  const header = [
    "// Generated from app/_import/**. Do not edit manually.",
    "//",
    "// Статичні import — не стиль, а вимога: `deno compile` і Deno Deploy беруть",
    "// лише те, що видно в графі модулів, тож набір, підключений динамічно, у",
    "// встановленому застосунку просто відсутній. Та сама пастка, що з",
    "// TS-командами моделей.",
    "//",
    "// Тип вмісту — `unknown` навмисно: формат правила належить прикладному",
    "// рішенню, а реєстр описує ФАЙЛИ набору, а не те, що в них написано.",
  ].join("\n");

  const type = [
    "export interface ImportSetModules {",
    "  /** Каталог набору відносно кореня застосунку. */",
    "  dir: string;",
    "  rules: Record<string, unknown>;",
    "  queries: Record<string, unknown>;",
    "  /** Файли набору, які модулями не є: еталон метаданих, зібрана обробка. */",
    "  files: string[];",
    "}",
  ].join("\n");

  const body = blocks.length
    ? `export const importSets: Record<string, ImportSetModules> = {\n${blocks.join("\n")}\n};\n`
    : "export const importSets: Record<string, ImportSetModules> = {};\n";

  return `${imports.length ? `${imports.join("\n")}\n\n` : ""}${header}\n\n${type}\n\n${body}`;
}
