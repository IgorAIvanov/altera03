/**
 * Стан підтримки прикладного рішення.
 *
 * Відповідає на одне питання: чи чіпали `app/` після того, як його сюди
 * завантажили. Це те, що в 1С зветься «на підтримці» / «знято з підтримки», з
 * однією різницею — тут стан **не оголошується, а виводиться**: манифест
 * поставки (`app/.solution.json`) несе SHA-256 кожного файлу, і звірка з диском
 * дає відповідь. Оголошувати нічого не треба, тож не можна ані забути, ані
 * збрехати; правка одного файлу сама переводить установку в ручний режим — і
 * цим захищає саму себе від наступного автоматичного оновлення.
 *
 * Запуск:
 *   deno task solution:status
 *   deno task solution:status -- --verbose    # усі розбіжності поіменно
 */
import { join, resolve } from "@std/path";

import {
  frameworkPin,
  type InstalledSolution,
  sha256Hex,
  SOLUTION_MANIFEST_FILE,
  stripJsonComments,
  walkSolutionFiles,
} from "./export-solution.ts";

/** Розбіжність пінів фреймворку між установкою й теперішнім станом. */
export interface FrameworkDrift {
  pkg: string;
  installed: string;
  current: string;
}

export interface SolutionStatus {
  /**
   * `null` — манифесту немає взагалі: рішення розклали руками або інструментом
   * до появи цього механізму. Це НЕ «на підтримці»: невідомо не означає «не
   * чіпали», тому автоматичне оновлення в такому стані теж не робиться.
   */
  installed: InstalledSolution | null;
  /** Дерево збігається з поставкою. */
  supported: boolean;
  changed: string[];
  added: string[];
  removed: string[];
  /** Артефакти збірки (`dist/`, `_sqlpackage/`) старші за поточний фреймворк. */
  frameworkDrift: FrameworkDrift[];
}

/** Піни фреймворку з `deno.json` приймача. */
async function currentFrameworkPins(projectRoot: string): Promise<Record<string, string>> {
  const text = await Deno.readTextFile(join(projectRoot, "deno.json")).catch(() => null);
  if (!text) return {};

  const config = JSON.parse(stripJsonComments(text)) as { imports?: Record<string, string> };
  const imports = config.imports ?? {};
  const pins: Record<string, string> = {};

  for (const pkg of ["@altera/client", "@altera/server", "@altera/tools"]) {
    const pin = frameworkPin(imports, pkg);
    if (pin) pins[pkg] = pin;
  }
  return pins;
}

export async function readSolutionStatus(projectRootArg = "."): Promise<SolutionStatus> {
  const projectRoot = resolve(Deno.cwd(), projectRootArg);
  const appDir = join(projectRoot, "app");

  const manifestText = await Deno.readTextFile(join(appDir, SOLUTION_MANIFEST_FILE)).catch(() => null);
  if (!manifestText) {
    return { installed: null, supported: false, changed: [], added: [], removed: [], frameworkDrift: [] };
  }

  const installed = JSON.parse(manifestText) as InstalledSolution;
  const expected = new Map(installed.files.map((entry) => [entry.path, entry.sha256]));

  const changed: string[] = [];
  const added: string[] = [];
  const seen = new Set<string>();

  // Обхід той самий, що в експорті: інакше `.vite/` чи `_sqlpackage/` вважалися
  // б доданими файлами, і установка була б «знята з підтримки» одразу після
  // першої ж збірки.
  for await (const path of walkSolutionFiles(appDir, appDir)) {
    seen.add(path);
    const expectedHash = expected.get(path);
    if (expectedHash === undefined) {
      added.push(path);
      continue;
    }
    if (await sha256Hex(await Deno.readFile(join(appDir, path))) !== expectedHash) changed.push(path);
  }

  const removed = installed.files.map((entry) => entry.path).filter((path) => !seen.has(path));

  const current = await currentFrameworkPins(projectRoot);
  const frameworkDrift: FrameworkDrift[] = [];
  for (const [pkg, installedPin] of Object.entries(installed.installedFramework ?? {})) {
    const currentPin = current[pkg];
    if (currentPin && currentPin !== installedPin) {
      frameworkDrift.push({ pkg, installed: installedPin, current: currentPin });
    }
  }

  return {
    installed,
    supported: changed.length === 0 && added.length === 0 && removed.length === 0,
    changed: changed.sort(),
    added: added.sort(),
    removed: removed.sort(),
    frameworkDrift,
  };
}

/** Друкує стан людині. Повертає код виходу: 0 — на підтримці, 1 — ні. */
export function printSolutionStatus(status: SolutionStatus, verbose = false): number {
  if (!status.installed) {
    console.log("Стан підтримки: НЕВІДОМИЙ");
    console.log(
      `  У app/ немає ${SOLUTION_MANIFEST_FILE} — рішення розклали руками або інструментом до появи\n` +
        "  цього механізму. Невідомо не означає «не чіпали», тож автоматичне оновлення теж не робиться.\n" +
        "  Наступне завантаження пакета покладе манифест і зробить стан визначеним.",
    );
    return 1;
  }

  const { name, version, installedAt } = status.installed;
  console.log(`Рішення: ${name}@${version} (завантажено ${installedAt})`);

  if (status.supported) {
    console.log(`Стан підтримки: НА ПІДТРИМЦІ — ${status.installed.files.length} файлів збігаються з поставкою`);
  } else {
    const parts = [
      status.changed.length ? `змінено ${status.changed.length}` : null,
      status.added.length ? `додано ${status.added.length}` : null,
      status.removed.length ? `видалено ${status.removed.length}` : null,
    ].filter(Boolean);
    console.log(`Стан підтримки: ЗНЯТО З ПІДТРИМКИ — ${parts.join(", ")}`);

    const list = (title: string, paths: string[]) => {
      if (!paths.length) return;
      const shown = verbose ? paths : paths.slice(0, 10);
      console.log(`  ${title}:`);
      for (const path of shown) console.log(`    ${path}`);
      if (shown.length < paths.length) {
        console.log(`    … ще ${paths.length - shown.length} (--verbose покаже всі)`);
      }
    };
    list("змінені", status.changed);
    list("додані", status.added);
    list("видалені", status.removed);

    console.log(
      "\n  Автоматичне оновлення в цьому стані не застосовується: нова поставка розкладеться\n" +
        "  поруч, щоб правки не зникли. `--force` затирає їх свідомо.",
    );
  }

  if (status.frameworkDrift.length) {
    console.log("\n⚠ Артефакти збірки старші за фреймворк — потрібна перезбірка (build:front, sql:assemble):");
    for (const drift of status.frameworkDrift) {
      console.log(`    ${drift.pkg}: зібрано з ${drift.installed}, зараз ${drift.current}`);
    }
  }

  return status.supported ? 0 : 1;
}

if (import.meta.main) {
  const args = Deno.args.filter((arg) => !arg.startsWith("--"));
  const status = await readSolutionStatus(args[0] ?? ".");
  Deno.exit(printSolutionStatus(status, Deno.args.includes("--verbose")));
}
