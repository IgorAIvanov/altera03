import { Injectable } from "@danet/core";
import { join } from "@std/path";

import { getServerConfig } from "../../config/server-config.ts";

/**
 * Манифест поставки, який кладе `@altera/tools/import-solution`.
 *
 * Ім'я файлу продубльоване тут навмисно, а не імпортоване: напрямок
 * залежностей у проєкті `tools → server`, і зворотний імпорт замкнув би цикл.
 * Це рядок формату, а не логіка — розійтися він може лише разом зі зміною
 * самого формату, яку однаково супроводжує `formatVersion`.
 */
const SOLUTION_MANIFEST_FILE = ".solution.json";

interface SolutionFileEntry {
  path: string;
  size: number;
  sha256: string;
}

interface InstalledSolution {
  formatVersion: number;
  name: string;
  version: string;
  installedAt: string;
  files: SolutionFileEntry[];
}

/** Те, що застосунок показує про своє рішення. */
export interface SolutionState {
  /** `null` — манифесту немає: рішення розклали руками або старим інструментом. */
  solution: { name: string; version: string; installedAt: string; files: number } | null;
  /**
   * `true` — дерево `app/` збігається з поставкою; `false` — його змінювали;
   * `null` — невідомо (немає манифесту). Три стани, а не два: «невідомо» — не
   * те саме, що «змінювали», і плутати їх не можна.
   */
  supported: boolean | null;
  /** Скільки файлів розійшлося з поставкою. Поіменний перелік — у `solution:status`. */
  divergent: number;
}

/** Каталоги, які лежать усередині `app/`, але рішенням не є. */
const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".vite", "_sqlpackage"]);
const EXCLUDED_ROOT_FILES = new Set(["deno.json", "deno.jsonc", "deno.lock", SOLUTION_MANIFEST_FILE]);

/**
 * Стан підтримки прикладного рішення — **тільки читання**.
 *
 * Установкою рішення займається окремий інструмент
 * (`deno task solution:update`), і це не питання зручності: **той, кого
 * заміняють, не має заміняти себе сам**. Кнопка всередині сервера впиралася в
 * те, що переписати власний `app/` вона може, а перезапуститися після цього
 * ні; заразом серверу доводилося давати `--allow-write` і `--allow-run` —
 * право переписати свій код і запустити будь-що.
 *
 * Тут лишилося рівно те, для чого особливих прав не треба: прочитати манифест
 * поставки й звірити суми. Ніяких змін на диску, ніяких підпроцесів.
 */
@Injectable()
export class SolutionService {
  private get appDir(): string {
    return join(getServerConfig().views.projectRoot, "app");
  }

  async readState(): Promise<SolutionState> {
    const manifestText = await Deno.readTextFile(join(this.appDir, SOLUTION_MANIFEST_FILE))
      .catch(() => null);

    if (!manifestText) {
      return { solution: null, supported: null, divergent: 0 };
    }

    const installed = JSON.parse(manifestText) as InstalledSolution;
    const expected = new Map(installed.files.map((entry) => [entry.path, entry.sha256]));

    let divergent = 0;
    const seen = new Set<string>();

    for await (const path of walkSolutionFiles(this.appDir, this.appDir)) {
      seen.add(path);
      const expectedHash = expected.get(path);
      if (expectedHash === undefined) {
        divergent++;
        continue;
      }
      const bytes = await Deno.readFile(join(this.appDir, path));
      if (await sha256Hex(bytes) !== expectedHash) divergent++;
    }

    for (const entry of installed.files) {
      if (!seen.has(entry.path)) divergent++;
    }

    return {
      solution: {
        name: installed.name,
        version: installed.version,
        installedAt: installed.installedAt,
        files: installed.files.length,
      },
      supported: divergent === 0,
      divergent,
    };
  }
}

/**
 * Обхід той самий, що в експорті рішення: інакше `_sqlpackage/` і `.vite/`
 * рахувалися б доданими файлами, і застосунок повідомляв би про зняття з
 * підтримки одразу після першої ж збірки.
 */
async function* walkSolutionFiles(dir: string, base: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      yield* walkSolutionFiles(path, base);
    } else if (entry.isFile) {
      if (dir === base && EXCLUDED_ROOT_FILES.has(entry.name)) continue;
      yield path.slice(base.length + 1).replaceAll("\\", "/");
    }
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
