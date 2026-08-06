/**
 * Завантаження прикладного рішення з переносимого пакета.
 *
 * Кладе дерево рішення в `app/` каталогу-приймача. Далі — штатний ланцюжок,
 * який цей інструмент НЕ запускає сам:
 *
 *   deno install && deno task sql:registry && deno task sql:assemble
 *     && deno task sql:publish && deno task build:front
 *
 * Не запускає свідомо: `sql:publish` пише в базу, а вирішувати, у яку саме й
 * коли, — не справа розпакування. Наступні кроки друкуються в кінці.
 *
 * **Що станеться з наявним `app/`, вирішує стан підтримки** (див.
 * `solution-status.ts`). Дерево збігається з поставкою — заміна автоматична,
 * без зайвих питань: втрачати нема чого. Розходиться — `app/` не чіпається
 * взагалі, пакет лягає поруч у `app.incoming/`, і друкується, чого торкнулися
 * обидві сторони. `--force` затирає правки свідомо.
 *
 * `deno.json` приймача інструмент не редагує. Бракуючі залежності він
 * ПЕРЕЛІЧУЄ готовими рядками — карта імпортів належить каркасу, і правити її
 * чужою рукою означало б мовчки міняти версії, на яких стоїть застосунок.
 *
 * Запуск:
 *   deno task solution:import -- ./erp-solution.tar.gz --check
 *   deno task solution:import -- ./erp-solution.tar.gz --force
 */
import { dirname, join, resolve } from "@std/path";
import { UntarStream } from "@std/tar";

import {
  frameworkPin,
  type InstalledSolution,
  SOLUTION_FORMAT_VERSION,
  SOLUTION_MANIFEST_FILE,
  type SolutionManifest,
  stripJsonComments,
} from "./export-solution.ts";
import { readSolutionStatus, type SolutionStatus } from "./solution-status.ts";

/** Шляхи в пакеті, які не записуються ніколи (див. коментар у циклі запису). */
const SKIPPED_PATHS = new Set(["deno.json", "deno.jsonc", "deno.lock"]);

/**
 * Що робити з наявним `app/`.
 *
 * Головна відмінність від попередньої поведінки: **на підтримці заміна
 * автоматична**. Раніше будь-який непорожній каталог вимагав `--force` — тобто
 * той, хто нічого не міняв, мусив щоразу підтверджувати «затри мої правки»,
 * яких у нього немає. Тепер підтвердження потрібне рівно там, де є що втрачати.
 */
export type ImportMode =
  /** Порожній `app/` — перша установка. */
  | "install"
  /** Дерево збігається з поставкою (або сказано `--force`) — заміна цілком. */
  | "replace"
  /** Знято з підтримки — розкласти поруч, `app/` не чіпати. */
  | "aside"
  /** Манифесту немає: звірити нема з чим, тож рішення за людиною. */
  | "unknown";

function resolveMode(hasExisting: boolean, status: SolutionStatus, force: boolean): ImportMode {
  if (!hasExisting) return "install";
  if (force) return "replace";
  if (!status.installed) return "unknown";
  return status.supported ? "replace" : "aside";
}

/** Що змінив постачальник і де це перетинається з правками приймача. */
interface UpdatePlan {
  supplierChanged: string[];
  supplierAdded: string[];
  supplierRemoved: string[];
  /** Файли, яких торкнулися ОБИДВІ сторони — саме тут і потрібна людина. */
  conflicts: string[];
}

function describeUpdate(status: SolutionStatus, incoming: SolutionManifest): UpdatePlan {
  const installed = status.installed;
  if (!installed) {
    return { supplierChanged: [], supplierAdded: [], supplierRemoved: [], conflicts: [] };
  }

  const before = new Map(installed.files.map((entry) => [entry.path, entry.sha256]));
  const after = new Map(incoming.files.map((entry) => [entry.path, entry.sha256]));

  const supplierChanged: string[] = [];
  const supplierAdded: string[] = [];
  for (const [path, hash] of after) {
    const previous = before.get(path);
    if (previous === undefined) supplierAdded.push(path);
    else if (previous !== hash) supplierChanged.push(path);
  }
  const supplierRemoved = [...before.keys()].filter((path) => !after.has(path));

  const touchedBySupplier = new Set([...supplierChanged, ...supplierAdded, ...supplierRemoved]);
  const touchedLocally = [...status.changed, ...status.added, ...status.removed];
  const conflicts = touchedLocally.filter((path) => touchedBySupplier.has(path));

  return {
    supplierChanged: supplierChanged.sort(),
    supplierAdded: supplierAdded.sort(),
    supplierRemoved: supplierRemoved.sort(),
    conflicts: conflicts.sort(),
  };
}

function listSample(title: string, paths: string[]) {
  if (!paths.length) return;
  console.log(`  ${title} (${paths.length}):`);
  for (const path of paths.slice(0, 10)) console.log(`    ${path}`);
  if (paths.length > 10) console.log(`    … ще ${paths.length - 10}`);
}

function reportPlan(
  mode: ImportMode,
  plan: UpdatePlan,
  incoming: SolutionManifest,
  status: SolutionStatus,
  errors: string[],
) {
  console.log(`\nБуде записано: ${incoming.files.length} файлів`);

  if (status.installed) {
    console.log(`Установлено зараз: ${status.installed.name}@${status.installed.version}`);
    console.log(
      status.supported
        ? "Стан підтримки: НА ПІДТРИМЦІ — рішення не змінювали"
        : `Стан підтримки: ЗНЯТО З ПІДТРИМКИ — змінено ${status.changed.length}, ` +
          `додано ${status.added.length}, видалено ${status.removed.length}`,
    );
  }

  listSample("постачальник змінив", plan.supplierChanged);
  listSample("постачальник додав", plan.supplierAdded);
  listSample("постачальник прибрав", plan.supplierRemoved);

  if (plan.conflicts.length) {
    console.log("\n⚠ Торкнулися обидві сторони — саме це доведеться зводити вручну:");
    for (const path of plan.conflicts.slice(0, 20)) console.log(`    ${path}`);
    if (plan.conflicts.length > 20) console.log(`    … ще ${plan.conflicts.length - 20}`);
  }

  const verdict = {
    install: "\n✅ Перешкод немає: app/ порожній, буде перша установка.",
    replace: "\n✅ Перешкод немає: рішення не змінювали, заміна відбудеться автоматично.",
    aside: "\n⚠ Рішення знято з підтримки — пакет ляже в app.incoming/, app/ не зміниться.\n" +
      "   `--force` замінить app/ цілком і затре ваші правки.",
    unknown: "\n⚠ Манифесту поставки немає — звірити нема з чим. Потрібен --force.",
  }[mode];

  console.log(errors.length ? `${verdict}\n   Але версії фреймворку розходяться (див. вище).` : verdict);
}

/**
 * Спорожнює каталог, не видаляючи його самого.
 *
 * Саме так, а не `Deno.remove(dir, { recursive: true })` — інакше в
 * контейнерній розкладці нічого не працює: `app/` там **точка монтування**, а
 * змонтований каталог видалити не можна взагалі (`Device or resource busy`).
 * Знайшлося запуском оновлення в контейнері; на звичайній файловій системі
 * різниці немає.
 */
async function emptyDir(dir: string) {
  for await (const entry of Deno.readDir(dir)) {
    await Deno.remove(join(dir, entry.name), { recursive: true });
  }
}

/** Розкладає файли пакета в каталог. Спільне для `app/` і `app.incoming/`. */
async function writeFiles(
  targetDir: string,
  manifest: SolutionManifest,
  files: Map<string, Uint8Array>,
  verbose: boolean,
) {
  for (const entry of manifest.files) {
    // Пакети, зібрані до виправлення (tools ≤ 0.5.0), несуть `app/deno.json` —
    // конфіг члена воркспейсу з репозиторію фреймворку. У встановленому
    // застосунку він перекриває кореневий конфіг (Deno шукає найближчий угору
    // від модуля), а карти імпортів у ньому немає: збірка образу падає з
    // `Import "@altera/server" not a dependency`. Не записуємо його ніколи —
    // і кажемо про це вголос, бо це розходження з манифестом.
    if (SKIPPED_PATHS.has(entry.path)) {
      console.log(`   ⚠ пропущено ${entry.path} — артефакт монорепо фреймворку, у застосунку шкідливий`);
      continue;
    }

    const target = join(targetDir, entry.path);
    await Deno.mkdir(dirname(target), { recursive: true });
    await Deno.writeFile(target, files.get(entry.path)!);
    if (verbose) console.log(`   + ${entry.path}`);
  }
}

/**
 * Манифест поставки — ОСТАННІМ, після всіх файлів: якщо запис обірвався на
 * середині, краще лишитися без нього (стан «невідомий», автооновлення не
 * робиться), ніж із ним і збрехати, що дерево відповідає поставці.
 *
 * Пишеться і в `app.incoming/` теж: тоді розкладений поруч пакет — повноцінна
 * установка, і людина може просто перейменувати каталог, не втрачаючи ознаки
 * підтримки.
 */
async function writeInstalledManifest(
  targetDir: string,
  manifest: SolutionManifest,
  config: Record<string, unknown>,
) {
  const installed: InstalledSolution = {
    ...manifest,
    installedAt: new Date().toISOString(),
    installedFramework: receiverFrameworkPins(config),
  };
  await Deno.writeTextFile(
    join(targetDir, SOLUTION_MANIFEST_FILE),
    JSON.stringify(installed, null, 2) + "\n",
  );
}

/**
 * Піни фреймворку ПРИЙМАЧА — ними будуть зібрані `dist/` і `_sqlpackage/`.
 *
 * Не ті, що в манифесті пакета: там записано, під чим рішення збирали в
 * джерелі. Для виявлення застарілих артефактів потрібні саме тутешні.
 */
function receiverFrameworkPins(config: Record<string, unknown>): Record<string, string> {
  const imports = (config.imports ?? {}) as Record<string, string>;
  const pins: Record<string, string> = {};
  for (const pkg of ["@altera/client", "@altera/server", "@altera/tools"]) {
    const pin = frameworkPin(imports, pkg);
    if (pin) pins[pkg] = pin;
  }
  return pins;
}

interface UnpackedSolution {
  manifest: SolutionManifest;
  files: Map<string, Uint8Array>;
}

// ── Читання пакета ───────────────────────────────────────────────────────────

async function readPackage(archivePath: string): Promise<UnpackedSolution> {
  const file = await Deno.open(archivePath, { read: true });
  const files = new Map<string, Uint8Array>();
  let manifest: SolutionManifest | null = null;

  const stream = file.readable
    .pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(new UntarStream());

  for await (const entry of stream) {
    const path = entry.path.replace(/^\.\//, "");

    // Пакет — чужий файл. Запис, що виводить за каталог призначення, не
    // «дивний вміст», а спроба записати кудись іще.
    if (path.startsWith("/") || path.split("/").includes("..")) {
      await entry.readable?.cancel();
      throw new Error(`Небезпечний шлях у пакеті: ${entry.path}`);
    }

    if (!entry.readable) continue;
    const bytes = new Uint8Array(await new Response(entry.readable).arrayBuffer());

    if (path === "solution.json") {
      manifest = JSON.parse(new TextDecoder().decode(bytes)) as SolutionManifest;
      continue;
    }
    if (path.startsWith("app/")) files.set(path.slice("app/".length), bytes);
  }

  if (!manifest) throw new Error("У пакеті немає solution.json — це не пакет прикладного рішення.");
  if (manifest.formatVersion !== SOLUTION_FORMAT_VERSION) {
    throw new Error(
      `Формат пакета ${manifest.formatVersion}, цей інструмент розуміє ${SOLUTION_FORMAT_VERSION}. ` +
        `Онови @altera/tools у приймачі.`,
    );
  }

  return { manifest, files };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Уміст пакета збігається з тим, що описав манифест. */
async function verifyContents({ manifest, files }: UnpackedSolution): Promise<string[]> {
  const problems: string[] = [];

  for (const entry of manifest.files) {
    const bytes = files.get(entry.path);
    if (!bytes) {
      problems.push(`${entry.path}: оголошений у манифесті, але у пакеті його немає`);
      continue;
    }
    if (await sha256(bytes) !== entry.sha256) {
      problems.push(`${entry.path}: контрольна сума не збігається з манифестом`);
    }
  }

  const declared = new Set(manifest.files.map((entry) => entry.path));
  for (const path of files.keys()) {
    if (!declared.has(path)) problems.push(`${path}: є в пакеті, але не оголошений у манифесті`);
  }

  return problems;
}

// ── Сумісність із приймачем ──────────────────────────────────────────────────

/** Версія з піна карти імпортів: `jsr:@altera/client@^0.6.2` → `0.6.2`. */
function pinnedVersion(pin: string): [number, number, number] | null {
  const match = pin.match(/@\^?~?(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isOlder(left: [number, number, number], right: [number, number, number]) {
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i];
  }
  return false;
}

interface Compatibility {
  errors: string[];
  notes: string[];
  missingDependencies: [string, string][];
}

function checkCompatibility(manifest: SolutionManifest, config: Record<string, unknown>): Compatibility {
  const imports = (config.imports ?? {}) as Record<string, string>;
  const errors: string[] = [];
  const notes: string[] = [];

  for (const [pkg, requiredPin] of Object.entries(manifest.framework)) {
    const receiverPin = frameworkPin(imports, pkg);
    if (!receiverPin) {
      // Не помилка: у репозиторії самого фреймворку пакетів у карті імпортів
      // немає взагалі — вони підключені членами воркспейсу.
      notes.push(`${pkg}: у приймача не оголошений (рішення збиралося з ${requiredPin})`);
      continue;
    }

    const required = pinnedVersion(requiredPin);
    const receiver = pinnedVersion(receiverPin);
    if (!required || !receiver) continue;

    if (required[0] !== receiver[0]) {
      errors.push(`${pkg}: у приймача ${receiverPin}, рішення зібране під ${requiredPin} — різні мажорні версії`);
    } else if (isOlder(receiver, required)) {
      errors.push(`${pkg}: у приймача ${receiverPin}, рішення потребує щонайменше ${requiredPin}`);
    }
  }

  const missingDependencies: [string, string][] = [];
  for (const [specifier, pin] of Object.entries(manifest.dependencies)) {
    if (!imports[specifier]) missingDependencies.push([specifier, pin]);
  }

  return { errors, notes, missingDependencies };
}

// ── Завантаження ─────────────────────────────────────────────────────────────

async function listExistingFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  const stat = await Deno.stat(dir).catch(() => null);
  if (!stat?.isDirectory) return found;

  for await (const entry of Deno.readDir(dir)) {
    if (entry.name === "node_modules" || entry.name === ".vite") continue;
    found.push(entry.name);
  }
  return found;
}

export interface ImportOptions {
  /** Розібрати, звірити й надрукувати план, не записуючи нічого. */
  check?: boolean;
  /** Замінити непорожній `app/` і пройти повз розбіжності версій. */
  force?: boolean;
  verbose?: boolean;
}

export interface ImportResult {
  manifest: SolutionManifest;
  /** Скільки файлів записано; `0` для `--check`. */
  written: number;
  /**
   * Що саме зроблено. Потрібне тому, хто йде далі по ланцюжку: після `aside`
   * каталог `app/` не змінився, тож перебудовувати реєстр і публікувати схему
   * ні до чого — а `written` там ненульовий, бо файли записані поруч.
   */
  mode: ImportMode;
}

export async function importSolution(
  archivePathArg: string,
  targetDirArg: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const archivePath = resolve(Deno.cwd(), archivePathArg);
  const targetRoot = resolve(Deno.cwd(), targetDirArg);
  const appDir = join(targetRoot, "app");

  const pkg = await readPackage(archivePath);
  const { manifest, files } = pkg;

  console.log(`Пакет:   ${manifest.name}@${manifest.version} (вивантажено ${manifest.exportedAt})`);
  console.log(`Приймач: ${targetRoot}`);
  console.log(`Файлів:  ${manifest.files.length}`);

  const contentProblems = await verifyContents(pkg);
  if (contentProblems.length) {
    console.error("\n❌ Пакет пошкоджений:");
    for (const problem of contentProblems) console.error(`   ${problem}`);
    throw new Error("Уміст пакета не відповідає манифесту.");
  }

  const config = JSON.parse(
    stripJsonComments(
      await Deno.readTextFile(join(targetRoot, "deno.json")).catch(() => {
        throw new Error(`У ${targetRoot} немає deno.json — це не каталог застосунку Altera.`);
      }),
    ),
  ) as Record<string, unknown>;

  const { errors, notes, missingDependencies } = checkCompatibility(manifest, config);
  for (const note of notes) console.log(`   ℹ ${note}`);

  if (missingDependencies.length) {
    console.log("\n⚠ Рішення користується пакетами, яких немає в карті імпортів приймача.");
    console.log("  Додай у deno.json → imports (карту не чіпаю навмисно — це каркас, не рішення):");
    for (const [specifier, pin] of missingDependencies) {
      console.log(`    ${JSON.stringify(specifier)}: ${JSON.stringify(pin || "<версія невідома>")},`);
    }
  }

  if (errors.length) {
    console.error("\n❌ Версії фреймворку розходяться:");
    for (const error of errors) console.error(`   ${error}`);
  }

  const existing = await listExistingFiles(appDir);
  const status = await readSolutionStatus(targetRoot);
  const mode = resolveMode(existing.length > 0, status, options.force === true);
  const plan = describeUpdate(status, manifest);

  // `--check` доповідає ПЕРШИМ, до будь-якої відмови: він для того й потрібен,
  // щоб побачити наслідки, ще нічого не вирішивши. Відмова замість плану
  // залишала б без відповіді єдине питання, заради якого його й запускають —
  // «а що буде?».
  if (options.check) {
    reportPlan(mode, plan, manifest, status, errors);
    return { manifest, written: 0, mode };
  }

  if (errors.length && !options.force) {
    throw new Error("Завантаження зупинено. Вирівняй версії або повтори з --force.");
  }
  if (errors.length) console.error("   → --force: продовжую попри це.");

  // Знято з підтримки — рішення на приймачі змінювали, і затирати ці правки
  // мовчки не можна. Пакет розкладається ПОРУЧ, а `app/` не чіпається взагалі.
  if (mode === "aside") {
    const incomingDir = `${appDir}.incoming`;
    await emptyDir(incomingDir).catch(() => {});
    await writeFiles(incomingDir, manifest, files, options.verbose === true);
    await writeInstalledManifest(incomingDir, manifest, config);

    reportPlan(mode, plan, manifest, status, errors);
    console.log(`\n✅ Пакет розкладено в ${incomingDir}; app/ не змінено.`);
    console.log("   Порівняйте й перенесіть потрібне; `--force` затирає ваші правки свідомо.");
    return { manifest, written: manifest.files.length, mode };
  }

  if (mode === "unknown") {
    throw new Error(
      `${appDir} не порожній (${existing.length} записів), а ${SOLUTION_MANIFEST_FILE} немає — ` +
        `невідомо, чи його змінювали. Звірити нема з чим, тож автоматична заміна не робиться: ` +
        `повтори з --force, якщо вміст можна затерти.`,
    );
  }

  // Заміна цілком, а не поверх: інакше файли моделі, прибраної в новій версії
  // рішення, лишилися б у дереві й далі потрапляли б у збірку.
  if (existing.length) await emptyDir(appDir);

  await writeFiles(appDir, manifest, files, options.verbose === true);

  await writeInstalledManifest(appDir, manifest, config);

  console.log(`\n✅ Записано ${manifest.files.length} файлів у ${appDir}`);
  console.log("\nДалі — штатний ланцюжок:");
  console.log("   deno install");
  console.log("   deno task sql:registry");
  console.log("   deno task sql:assemble");
  console.log("   deno task sql:publish");
  console.log("   deno task build:front");

  return { manifest, written: manifest.files.length, mode };
}

if (import.meta.main) {
  const args = Deno.args.filter((arg) => !arg.startsWith("--"));
  const archivePath = args[0];
  const targetDir = args[1] ?? ".";

  if (!archivePath) {
    console.error("Використання: import-solution <пакет.tar.gz> [каталог-приймача] [--check] [--force] [--verbose]");
    Deno.exit(1);
  }

  // Відмова тут — очікуваний результат (непорожній app/, розбіжність версій,
  // побитий пакет), а не збій інструмента. Стек у такому разі лише ховає
  // повідомлення, заради якого перевірка й робилася.
  try {
    await importSolution(archivePath, targetDir, {
      check: Deno.args.includes("--check"),
      force: Deno.args.includes("--force"),
      verbose: Deno.args.includes("--verbose"),
    });
  } catch (error) {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
}
