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
 * **Прийнята домовленість: змінене на приймачі рішення не розглядається.**
 * Тому `app/` заміняється цілком, а не зливається. Непорожній каталог — це
 * помилка, доки не сказано `--force`: мовчазна заміна чужої роботи гірша за
 * зайве питання.
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
  SOLUTION_FORMAT_VERSION,
  type SolutionManifest,
  stripJsonComments,
} from "./export-solution.ts";

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

  // `--check` доповідає ПЕРШИМ, до будь-якої відмови: він для того й потрібен,
  // щоб побачити наслідки, ще нічого не вирішивши. Відмова замість плану
  // залишала б без відповіді єдине питання, заради якого його й запускають —
  // «а що буде?», — і саме в тому випадку, коли app/ непорожній, тобто завжди
  // при оновленні рішення.
  if (options.check) {
    const needsForce = errors.length > 0 || existing.length > 0;
    console.log(`\nБуде записано: ${manifest.files.length} файлів`);
    if (existing.length) console.log(`Буде замінено: ${existing.length} наявних записів у app/`);
    console.log(
      needsForce
        ? "\n⚠ Для запису потрібен --force (див. причини вище). Нічого не записано."
        : "\n✅ Перешкод немає. Нічого не записано.",
    );
    return { manifest, written: 0 };
  }

  if (errors.length && !options.force) {
    throw new Error("Завантаження зупинено. Вирівняй версії або повтори з --force.");
  }
  if (errors.length) console.error("   → --force: продовжую попри це.");

  if (existing.length && !options.force) {
    throw new Error(
      `${appDir} не порожній (${existing.length} записів). Прийнято домовленість, що змінене на ` +
        `приймачі рішення не зливається, тому каталог заміняється цілком — повтори з --force.`,
    );
  }

  // Заміна цілком, а не поверх: інакше файли моделі, прибраної в новій версії
  // рішення, лишилися б у дереві й далі потрапляли б у збірку.
  if (existing.length) await Deno.remove(appDir, { recursive: true });

  for (const entry of manifest.files) {
    const target = join(appDir, entry.path);
    await Deno.mkdir(dirname(target), { recursive: true });
    await Deno.writeFile(target, files.get(entry.path)!);
    if (options.verbose) console.log(`   + app/${entry.path}`);
  }

  console.log(`\n✅ Записано ${manifest.files.length} файлів у ${appDir}`);
  console.log("\nДалі — штатний ланцюжок:");
  console.log("   deno install");
  console.log("   deno task sql:registry");
  console.log("   deno task sql:assemble");
  console.log("   deno task sql:publish");
  console.log("   deno task build:front");

  return { manifest, written: manifest.files.length };
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
