/**
 * Оновлення встановленого застосунку одним проходом.
 *
 * Це той «окремий застосунок», якого бракувало: **той, кого заміняють, не має
 * заміняти себе сам**. Раніше установку робила кнопка всередині сервера — і
 * впиралася в те, що переписати власний `app/` вона може, а перезапуститися
 * після цього ні. Заразом серверу доводилося давати `--allow-write` і
 * `--allow-run`, тобто право переписати свій код і запустити будь-що. Тепер ці
 * права потрібні рівно тут, разово, а обслуговуючий процес лишається з
 * `--allow-net --allow-read --allow-env`.
 *
 * Перезапуск інструмент **не робить**: у контейнері для цього потрібен доступ
 * до сокета Docker (фактично root на хості), під systemd — свої повноваження.
 * Це справа того, хто керує сервісом; ми лише кажемо, що час настав.
 *
 * Запуск:
 *   deno task solution:update -- ./erp-1.2.0.tar.gz            # оновити
 *   deno task solution:update -- ./erp-1.2.0.tar.gz --check    # лише подивитися
 *   deno task solution:update -- ./erp-1.2.0.tar.gz --force    # затерти правки
 */
import { resolve } from "@std/path";

import { importSolution } from "./import-solution.ts";
import { printSolutionStatus, readSolutionStatus } from "./solution-status.ts";

/**
 * Ланцюжок після розпакування.
 *
 * `sql:deploy --yes` замість `sql:publish`: перший однаково працює і з
 * локальною базою, і з керованою, тож один список покриває обидва розгортання.
 * Збірку фронтенду пропустити не можна — екрани нових моделей інакше не
 * існують: сервер віддає готові чанки з `dist/`.
 */
const DEFAULT_TASKS = ["sql:registry", "sql:deploy --yes", "build:front"];

export interface UpdateStep {
  title: string;
  ok: boolean;
  output: string;
}

export interface UpdateResult {
  /** Кроки, які встигли виконатися. */
  steps: UpdateStep[];
  ok: boolean;
  /** Чи змінився `app/` — і, отже, чи потрібен перезапуск. */
  applied: boolean;
}

async function runTask(projectRoot: string, task: string): Promise<UpdateStep> {
  const args = ["task", ...task.split(/\s+/).filter(Boolean)];

  try {
    const command = new Deno.Command(Deno.execPath(), {
      args,
      cwd: projectRoot,
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await command.output();
    const decoder = new TextDecoder();
    return {
      title: `deno task ${task}`,
      ok: code === 0,
      output: `${decoder.decode(stdout)}${decoder.decode(stderr)}`.trim(),
    };
  } catch (error) {
    // Найімовірніша причина — запуск без `--allow-run`. Кажемо прямо: інакше
    // видно лише «PermissionDenied» без підказки, що саме дозволяти.
    const message = error instanceof Error ? error.message : String(error);
    return {
      title: `deno task ${task}`,
      ok: false,
      output: `${message}\n\nІмовірно, команду запущено без --allow-run і --allow-write.`,
    };
  }
}

export interface UpdateOptions {
  check?: boolean;
  force?: boolean;
  verbose?: boolean;
  tasks?: string[];
}

export async function updateSolution(
  archivePath: string,
  targetDirArg = ".",
  options: UpdateOptions = {},
): Promise<UpdateResult> {
  const projectRoot = resolve(Deno.cwd(), targetDirArg);
  const steps: UpdateStep[] = [];

  const imported = await importSolution(archivePath, projectRoot, {
    check: options.check,
    force: options.force,
    verbose: options.verbose,
  });

  if (options.check) {
    return { steps, ok: true, applied: false };
  }

  // `aside` — рішення знято з підтримки, пакет ліг поруч, а `app/` не
  // змінився. Ганяти ланцюжок тут не можна: перезбирати й публікувати схему
  // ні до чого, а `build:front` ще й перезаписав би `dist/` тим самим, що вже
  // є. Людина спершу зводить правки.
  if (imported.mode === "aside") {
    return { steps, ok: true, applied: false };
  }

  for (const task of options.tasks ?? DEFAULT_TASKS) {
    console.log(`\n▶ deno task ${task}`);
    const step = await runTask(projectRoot, task);
    steps.push(step);

    if (step.output) console.log(step.output);
    if (!step.ok) {
      // Далі йти нема сенсу: публікувати схему після невдалого `sql:registry`
      // означало б покласти в базу те, що не відповідає реєстру.
      console.error(`\n❌ Крок «${step.title}» не виконався — зупиняюся.`);
      return { steps, ok: false, applied: true };
    }
  }

  return { steps, ok: true, applied: true };
}

if (import.meta.main) {
  const positional = Deno.args.filter((arg) => !arg.startsWith("--"));
  const archivePath = positional[0];
  const targetDir = positional[1] ?? ".";

  if (!archivePath) {
    console.error(
      "Використання: update-solution <пакет.tar.gz> [каталог] [--check] [--force] [--verbose]",
    );
    Deno.exit(1);
  }

  try {
    const result = await updateSolution(archivePath, targetDir, {
      check: Deno.args.includes("--check"),
      force: Deno.args.includes("--force"),
      verbose: Deno.args.includes("--verbose"),
    });

    if (!result.ok) Deno.exit(1);

    if (result.applied) {
      console.log("\n✅ Оновлення застосовано.");
      console.log(
        "   ПЕРЕЗАПУСТІТЬ застосунок: реєстр моделей імпортується статично, тож працюючий\n" +
          "   процес далі віддає попередні екрани.",
      );
    } else {
      console.log("\nЗмін у app/ не зроблено — ланцюжок збірки не запускався.");
      printSolutionStatus(await readSolutionStatus(targetDir));
    }
  } catch (error) {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
}
