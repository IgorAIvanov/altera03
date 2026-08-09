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
 * **Часткове вивантаження** (`--models catalog/bank,document/invoice`) — це не
 * поставка, а інструмент розробника: скелет для подальшої роботи, фактично
 * копіювання моделей з одного місця в інше. Працездатності на приймачі воно не
 * обіцяє й не мусить: у пакет їдуть РІВНО перелічені каталоги моделей і нічого
 * більше. Те, чого їм бракуватиме, інструмент називає попередженнями — але не
 * добирає: що саме доносити, вирішує людина.
 *
 * Запуск:
 *   deno task solution:export                       # → solution.tar.gz
 *   deno task solution:export -- --out my.tar.gz --name erp --version 1.2.0
 *   deno task solution:export -- --models catalog/bank,document/invoice
 */
import { basename, dirname, join, relative, resolve, SEPARATOR } from "@std/path";
import { TarStream, type TarStreamInput } from "@std/tar";

/**
 * Версії формату пакета.
 *
 * Повний і частковий пакети при завантаженні поводяться **протилежно**: перший
 * заміняє `app/` цілком (файл прибраної моделі мусить зникнути з дерева),
 * другий не сміє затерти нічого. Тобто інструмент, який про частковий пакет не
 * знає, розпакував би його як повний і викинув усе інше рішення.
 *
 * Захист — саме номер формату, а не поле `kind`: старий приймач звіряє
 * `formatVersion` строгою рівністю й на `2` відмовляється ще до розбору. Повні
 * пакети через це лишаються на `1` — ламати сумісність там, де небезпеки немає,
 * підстав немає.
 */
export const SOLUTION_FORMAT_FULL = 1;
export const SOLUTION_FORMAT_PARTIAL = 2;

/** Формати, які цей інструмент уміє читати. */
export const SUPPORTED_FORMAT_VERSIONS: readonly number[] = [
  SOLUTION_FORMAT_FULL,
  SOLUTION_FORMAT_PARTIAL,
];

/**
 * Манифест поставки на диску встановленого застосунку — «постачальна копія».
 *
 * Лежить усередині `app/`, тобто там само, де рішення, яке описує: так він
 * переживає розкладку, у якій змонтований лише цей каталог. З нього рахується
 * ознака підтримки: збіглися суми — рішення не чіпали, розійшлися — чіпали.
 * Оголошувати цей стан руками не треба, тому його не можна ані забути, ані
 * збрехати.
 */
export const SOLUTION_MANIFEST_FILE = ".solution.json";

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

/**
 * Файли в корені `app/`, які належать РЕПОЗИТОРІЮ фреймворку, а не рішенню.
 *
 * `app/deno.json` — конфіг члена воркспейсу: у монорепо він потрібен (без нього
 * застосунок не член воркспейсу), а у встановленому застосунку його немає й
 * бути не повинно — шаблон scaffold його свідомо не кладе. Приїхавши в пакеті,
 * він **перекриває кореневий конфіг**: Deno шукає найближчий угору від модуля,
 * знаходить цей — а карти імпортів у ньому немає. Наслідок —
 * `Import "@altera/server" not a dependency` рівно там, де конфіг резолвиться
 * від точки входу (`deno install --entrypoint`, тобто збірка образу), і мовчазна
 * робота там, де від CWD. Знайшлося складанням контейнера.
 */
const EXCLUDED_ROOT_FILES = new Set([
  "deno.json",
  "deno.jsonc",
  "deno.lock",
  // Манифест ПОСТАВКИ цієї установки (див. SOLUTION_MANIFEST_FILE). Він описує
  // те, що сюди завантажили, тож у наступному пакеті означав би позаминулу
  // поставку — і звірка підтримки на приймачі порівнювала б із чужим станом.
  SOLUTION_MANIFEST_FILE,
]);

export interface SolutionFileEntry {
  /** Шлях відносно каталогу застосунку, завжди через `/`. */
  path: string;
  size: number;
  sha256: string;
}

/**
 * Що описує пакет.
 *
 * `full` — рішення цілком, тобто пакет вичерпний: чого в ньому немає, того в
 * рішенні немає. `partial` — набір моделей; відсутність файлу тут не означає
 * нічого, його просто не вивантажували.
 */
export type SolutionKind = "full" | "partial";

export interface SolutionManifest {
  formatVersion: number;
  /** Старі пакети (tools ≤ 0.6) поля не мають — читати їх треба як `full`. */
  kind?: SolutionKind;
  /** Маршрути вивантажених моделей (`catalog/bank`). Тільки в `partial`. */
  models?: string[];
  name: string;
  version: string;
  exportedAt: string;
  /** Піни пакетів фреймворку, під якими рішення збиралося. */
  framework: Record<string, string>;
  /** Зовнішні специфікатори, ужиті кодом рішення, і їхні версії з джерела. */
  dependencies: Record<string, string>;
  files: SolutionFileEntry[];
}

/** Манифест поставки, як він лежить у встановленому застосунку. */
export interface InstalledSolution extends SolutionManifest {
  /** Коли пакет розклали в цю установку. */
  installedAt: string;
  /**
   * Піни фреймворку ПРИЙМАЧА на момент установки — не ті, що в `framework`.
   *
   * Саме ними зібрані `dist/` і `_sqlpackage/`. Розбіжність із поточними
   * пінами означає, що артефакти на диску старші за фреймворк, який їх
   * обслуговує: сервер нової версії, а бандл і схема від попередньої. Видно це
   * інакше ніяк — обидва каталоги продукти збірки, і жоден із них не
   * підписаний версією.
   */
  installedFramework: Record<string, string>;
}

// ── Обхід дерева ─────────────────────────────────────────────────────────────

export async function* walkSolutionFiles(dir: string, base: string): AsyncGenerator<string> {
  const entries: Deno.DirEntry[] = [];
  for await (const entry of Deno.readDir(dir)) entries.push(entry);
  // Детермінований порядок: пакет, зібраний двічі з того самого дерева, має
  // бути тим самим набором у тому самому порядку.
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      yield* walkSolutionFiles(path, base);
    } else if (entry.isFile) {
      const relativePath = relative(base, path).replaceAll(SEPARATOR, "/");
      // Тільки в КОРЕНІ app/: `db/deno.json` (якби модель таке завела) — справа
      // рішення, а перекриває конфіг лише той, що лежить над точкою входу.
      if (dir === base && EXCLUDED_ROOT_FILES.has(entry.name)) continue;
      yield relativePath;
    }
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
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

async function collectDependencies(
  appDir: string,
  imports: Record<string, string>,
  /** Файли, які поїдуть у пакет; для повного вивантаження — усі. */
  paths: string[],
) {
  const used = new Set<string>();

  for (const relPath of paths) {
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

// ── Моделі рішення ───────────────────────────────────────────────────────────

/** Модель, знайдена в дереві рішення. */
export interface ModelRef {
  /** Маршрут — шлях каталогу відносно `app/`: `catalog/bank`. */
  route: string;
  /** Ім'я з `manifest.json`: під ним модель відома рантайму й функціям SQL. */
  model: string;
  /** Схема БД моделі; за замовчуванням `app`. */
  schema: string;
  /**
   * Модель оголошує власну структуру (`db/struc.sql`).
   *
   * Розрізняти доводиться, бо admin-екрани ядра (`admin/numerator`,
   * `admin/print_template`, `admin/menu`) правлять таблиці, які кладе САМЕ
   * ЯДРО, а не вони. Без цієї ознаки `app.numerator` у SQL документа читався б
   * як посилання на `admin/numerator` — і кожен пронумерований документ тягнув
   * би за собою пораду донести адмін-екран, до якого він стосунку не має.
   */
  ownsTable: boolean;
}

/**
 * Моделі дерева — за наявністю `manifest.json`.
 *
 * Обхід рекурсивний, а не «рівно два рівні»: розкладка `family/model` —
 * домовленість, а не властивість, і `sql.json` цілком приймає інші глибини.
 * Углиб моделі не спускаємося — `db/` і `prints/` своїх манифестів не мають, а
 * якби мали, це була б інша модель, і вкладеність нічого б не змінила.
 */
export async function discoverModels(appDir: string): Promise<ModelRef[]> {
  const found: ModelRef[] = [];

  const visit = async (dir: string) => {
    const entries: Deno.DirEntry[] = [];
    for await (const entry of Deno.readDir(dir)) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));

    if (entries.some((entry) => entry.isFile && entry.name === "manifest.json")) {
      const route = relative(appDir, dir).replaceAll(SEPARATOR, "/");
      const manifest = await readJsonc(join(dir, "manifest.json"));
      const model = typeof manifest?.model === "string" ? manifest.model : basename(dir);
      const schema = typeof manifest?.schema === "string" ? manifest.schema : "app";
      const ownsTable = await Deno.stat(join(dir, "db", "struc.sql"))
        .then((stat) => stat.isFile).catch(() => false);
      found.push({ route, model, schema, ownsTable });
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory || EXCLUDED_DIRS.has(entry.name)) continue;
      await visit(join(dir, entry.name));
    }
  };

  await visit(appDir);
  return found;
}

/** Маршрут моделі в тій формі, у якій він лежить у дереві. */
function normalizeRoute(input: string): string {
  return input
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^app\//, "")
    .replace(/\/+$/, "");
}

// ── Посилання назовні ────────────────────────────────────────────────────────

/**
 * Чого вивантаженим моделям бракуватиме на приймачі.
 *
 * Тільки попередження — інструмент нічого не добирає сам. Причина не в
 * лінощах: часткове вивантаження і є вибір людини, а «розумне» дотягування
 * залежностей перетворило б набір із двох моделей на половину рішення, причому
 * мовчки. Тут же видно рівно те, що доведеться донести руками.
 *
 * Пошук навмисно текстовий і навмисно неповний — інакше довелося б розбирати
 * SQL і шаблони Lit. Він ловить два випадки, які й трапляються:
 * посилання на ЧУЖУ модель (маршрут у `ui-picker`, її таблиця чи функція в SQL)
 * і імпорт файлу рішення поза вивантаженими каталогами (`@shared/…`).
 */
export interface MissingReference {
  /** На що посилаються: маршрут моделі або шлях у `app/`. */
  target: string;
  kind: "model" | "file";
  /** Де знайдено — перші кілька файлів, щоб було з чого починати. */
  seenIn: string[];
}

const TEXT_EXTENSIONS = [".ts", ".tsx", ".js", ".sql", ".json", ".html", ".css", ".md"];

/** Екранування для вставки рядка в регулярний вираз. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Шлях у `app/`, на який показує специфікатор імпорту, або `null`.
 *
 * `@shared/` і `@app/` — аліаси карти імпортів застосунку; відносний шлях
 * розкручується від файлу. Те, що виводить за `app/` цілком, тут не наша
 * справа — це порушення меж, і його ловить `check:deps`.
 */
export function resolveAppImport(fromFile: string, specifier: string): string | null {
  let target: string;

  if (specifier.startsWith("@shared/")) target = `shared/${specifier.slice("@shared/".length)}`;
  else if (specifier.startsWith("@app/")) target = specifier.slice("@app/".length);
  else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const segments = `${dirname(fromFile)}/${specifier}`.split("/");
    const stack: string[] = [];
    for (const segment of segments) {
      if (segment === "." || segment === "") continue;
      if (segment === "..") {
        if (!stack.length) return null;
        stack.pop();
        continue;
      }
      stack.push(segment);
    }
    target = stack.join("/");
  } else return null;

  return target;
}

export async function collectMissingReferences(
  appDir: string,
  exportedRoutes: string[],
  exportedFiles: string[],
  models: ModelRef[],
): Promise<MissingReference[]> {
  const exported = new Set(exportedRoutes);
  const exportedFileSet = new Set(exportedFiles);
  const foreign = models.filter((model) => !exported.has(model.route));

  // Регулярки будуються один раз на весь прогін: моделей десятки, файлів сотні.
  const probes = foreign.map((model) => ({
    route: model.route,
    // Маршрут як рядок: `url="catalog/bank"`, `"./bankList.ts"` тут ні до чого.
    byRoute: new RegExp(`(^|[^\\w/-])${escapeRegExp(model.route)}(?![\\w-])`),
    // Таблиця або функція моделі: `app.bank`, `app.bank_get`. Межа слова після
    // імені відсікає `app.bank_account`, якби така модель існувала окремо.
    // Тільки для моделі, яка структуру справді оголошує (див. `ownsTable`).
    bySql: model.ownsTable
      ? new RegExp(`\\b${escapeRegExp(model.schema)}\\.${escapeRegExp(model.model)}(_[a-z0-9_]+)?\\b`)
      : null,
  }));

  const hits = new Map<string, MissingReference>();
  const note = (target: string, kind: MissingReference["kind"], file: string) => {
    const found = hits.get(target) ?? { target, kind, seenIn: [] };
    if (found.seenIn.length < 3 && !found.seenIn.includes(file)) found.seenIn.push(file);
    hits.set(target, found);
  };

  for (const relPath of exportedFiles) {
    if (!TEXT_EXTENSIONS.some((extension) => relPath.endsWith(extension))) continue;
    const text = await Deno.readTextFile(join(appDir, relPath));

    for (const probe of probes) {
      if (probe.byRoute.test(text) || probe.bySql?.test(text)) note(probe.route, "model", relPath);
    }

    for (const line of text.split("\n")) {
      if (!/^\s*(import|export)\b/.test(line) && !/\bimport\(/.test(line)) continue;
      const specifier = importSpecifier(line);
      if (!specifier) continue;

      const target = resolveAppImport(relPath, specifier);
      if (!target || exportedFileSet.has(target)) continue;
      // Файл усередині вивантаженої моделі, якого просто немає на диску, — це
      // зламаний імпорт джерела, а не брак пакета. Мовчимо: не наша справа.
      if (exportedRoutes.some((route) => target.startsWith(`${route}/`))) continue;
      note(target, "file", relPath);
    }
  }

  return [...hits.values()].sort((left, right) => left.target.localeCompare(right.target));
}

// ── Вивантаження ─────────────────────────────────────────────────────────────

export interface ExportOptions {
  out?: string;
  name?: string;
  version?: string;
  verbose?: boolean;
  /**
   * Маршрути моделей для ЧАСТКОВОГО вивантаження (`catalog/bank`).
   *
   * Порожньо або не задано — пакет повний. Заданий неіснуючий маршрут —
   * помилка, а не порожній пакет: одруківка в імені моделі інакше давала б
   * успішне вивантаження без неї.
   */
  models?: string[];
}

export interface ExportResult {
  manifest: SolutionManifest;
  /** Абсолютний шлях до записаного пакета. */
  outPath: string;
  /** Чого вивантаженим моделям бракуватиме. Порожньо для повного пакета. */
  missing: MissingReference[];
}

export async function exportSolution(appDirArg: string, options: ExportOptions = {}): Promise<ExportResult> {
  const appDir = resolve(Deno.cwd(), appDirArg);
  const root = dirname(appDir);

  const stat = await Deno.stat(appDir).catch(() => null);
  if (!stat?.isDirectory) {
    throw new Error(`Каталог застосунку не знайдено: ${appDir}`);
  }

  const config = await readJsonc(join(root, "deno.json")) ??
    await readJsonc(join(root, "deno.jsonc")) ?? {};
  const imports = (config.imports ?? {}) as Record<string, string>;

  const requested = (options.models ?? []).map(normalizeRoute).filter(Boolean);
  const partial = requested.length > 0;

  const models = await discoverModels(appDir);
  const routes: string[] = [];
  if (partial) {
    const known = new Map(models.map((model) => [model.route, model]));
    for (const route of requested) {
      if (!known.has(route)) {
        throw new Error(
          `Моделі ${route} у ${appDir} немає (шукали ${route}/manifest.json). ` +
            `Наявні: ${models.map((model) => model.route).join(", ")}`,
        );
      }
      if (!routes.includes(route)) routes.push(route);
    }
  }

  const files: SolutionFileEntry[] = [];
  const contents = new Map<string, Uint8Array>();

  // Часткове вивантаження бере РІВНО перелічені каталоги моделей: ні `sql.json`,
  // ні `shared/`, ні `_generated/` — реєстр приймач перебудує в себе сам, а
  // решта або вже є, або її свідомо доносять руками.
  const sources = partial ? routes.map((route) => join(appDir, route)) : [appDir];

  for (const source of sources) {
    for await (const relPath of walkSolutionFiles(source, appDir)) {
      const bytes = await Deno.readFile(join(appDir, relPath));
      contents.set(relPath, bytes);
      files.push({ path: relPath, size: bytes.byteLength, sha256: await sha256Hex(bytes) });
    }
  }

  if (files.length === 0) {
    throw new Error(`У ${appDir} немає жодного файлу — вивантажувати нічого.`);
  }

  const missing = partial
    ? await collectMissingReferences(appDir, routes, files.map((file) => file.path), models)
    : [];

  const manifest: SolutionManifest = {
    formatVersion: partial ? SOLUTION_FORMAT_PARTIAL : SOLUTION_FORMAT_FULL,
    kind: partial ? "partial" : "full",
    ...(partial ? { models: routes } : {}),
    name: options.name ?? basename(root),
    version: options.version ?? "0.0.0",
    exportedAt: new Date().toISOString(),
    framework: await collectFrameworkPins(root, config),
    // Залежності рахуються по ФАЙЛАХ пакета, а не по всьому `app/`: приймачу
    // треба знати, чого бракує саме цим моделям.
    dependencies: await collectDependencies(appDir, imports, files.map((file) => file.path)),
    files,
  };

  const defaultName = partial ? `${manifest.name}-models.tar.gz` : `${manifest.name}-solution.tar.gz`;
  const outPath = resolve(Deno.cwd(), options.out ?? defaultName);
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
    if (partial) for (const route of routes) console.log(`  модель:      ${route}`);
    console.log(`  файлів:      ${files.length}`);
    for (const [pkg, pin] of Object.entries(manifest.framework)) console.log(`  фреймворк:   ${pkg} → ${pin}`);
    for (const [dep, pin] of Object.entries(manifest.dependencies)) {
      console.log(`  залежність:  ${dep}${pin ? ` → ${pin}` : "  ⚠ немає в карті імпортів джерела"}`);
    }
  }

  if (missing.length) {
    console.log("\n⚠ Вивантажені моделі посилаються на те, чого в пакеті немає.");
    console.log("  Пакет — скелет для розробки, тож нічого не добираю; донесіть потрібне самі:");
    for (const reference of missing) {
      const where = reference.seenIn.join(", ");
      const what = reference.kind === "model" ? "модель" : "файл ";
      console.log(`    ${what} ${reference.target}  ← ${where}`);
    }
  }

  console.log(
    `✅ ${outPath} — ${partial ? `${routes.length} моделей, ` : ""}${files.length} файлів, ` +
      `${(packed / 1024).toFixed(1)} КБ`,
  );

  return { manifest, outPath, missing };
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
  /** Прапорець, який можна повторювати: `--model a --model b`. */
  const flags = (name: string) => {
    const values: string[] = [];
    for (let value = flag(name); value !== undefined; value = flag(name)) values.push(value);
    return values;
  };

  const verbose = args.includes("--verbose");
  const out = flag("out");
  const name = flag("name");
  const version = flag("version");
  // Дві форми, бо зручні різні: список через кому для руки, повторення — для
  // скрипта, який складає рядок циклом.
  const models = [...flags("models").flatMap((value) => value.split(",")), ...flags("model")]
    .map((value) => value.trim())
    .filter(Boolean);
  const appDir = args.find((arg) => !arg.startsWith("--")) ?? "./app";

  try {
    await exportSolution(appDir, { out, name, version, verbose, models });
  } catch (error) {
    // Одруківка в маршруті моделі — очікуваний результат, а не збій
    // інструмента: стек ховав би перелік наявних моделей, заради якого відмова
    // й написана.
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
}
