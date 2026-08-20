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
 * Джерелом може бути файл, URL або реліз GitHub — форми розбирає
 * `resolve-solution-source.ts`. Приватний репозиторій потребує `GITHUB_TOKEN`;
 * задача передає `--env-file`, тож достатньо рядка в `.env` установки.
 *
 * Запуск:
 *   deno task solution:update -- ./erp-1.2.0.tar.gz            # оновити
 *   deno task solution:update -- ./erp-1.2.0.tar.gz --check    # лише подивитися
 *   deno task solution:update -- ./erp-1.2.0.tar.gz --force    # затерти правки
 *   deno task solution:update -- IgorAIvanov/altera-buh@1.2.0  # реліз GitHub
 *   deno task solution:update -- IgorAIvanov/altera-buh@latest # останній реліз
 */
import { resolve } from "@std/path";

import { importSolution, readPackageManifest } from "./import-solution.ts";
import { resolveSolutionSource } from "./resolve-solution-source.ts";
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

async function runDeno(projectRoot: string, title: string, args: string[]): Promise<UpdateStep> {
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
      title,
      ok: code === 0,
      output: `${decoder.decode(stdout)}${decoder.decode(stderr)}`.trim(),
    };
  } catch (error) {
    // Найімовірніша причина — запуск без `--allow-run`. Кажемо прямо: інакше
    // видно лише «PermissionDenied» без підказки, що саме дозволяти.
    const message = error instanceof Error ? error.message : String(error);
    return {
      title,
      ok: false,
      output: `${message}\n\nІмовірно, команду запущено без --allow-run і --allow-write.`,
    };
  }
}

function runTask(projectRoot: string, task: string): Promise<UpdateStep> {
  return runDeno(projectRoot, `deno task ${task}`, ["task", ...task.split(/\s+/).filter(Boolean)]);
}

/**
 * Установка залежностей — ПЕРШИЙ крок, і до розпакування.
 *
 * Доти інструмент друкував правильний порядок («deno install», далі задачі), а
 * виконував його з другого рядка. На свіжій установці це означало `sql:registry`
 * без залежностей — а він у такому стані не падав, а мовчки випускав порожні
 * схеми інструментів агента (див. `agent-tool-schemas.ts`). Тобто крок,
 * надрукований як обов'язковий, був єдиним, якого ніхто не робив.
 *
 * До розпакування, а не між ним і ланцюжком: якщо залежності поставити не
 * вдалося, установка мусить лишитися ЦІЛОЮ. Поставка заміняє тільки `app/`, а
 * піни живуть у `deno.json` каркаса — тобто нічого «з нового пакета» тут не
 * ставиться, і порядок нічого не ламає.
 */
async function installDependencies(projectRoot: string): Promise<UpdateStep> {
  const step = await runDeno(projectRoot, "deno install", ["install"]);
  if (step.ok) return step;

  // Політика мінімального віку залежності. На щойно розгорнутій установці
  // `deno.lock` ще немає, тож піни резолвляться з реєстру — і свіжий реліз
  // фреймворку (молодший за добу) впирається в неї. Знімати політику за
  // адміністратора не можна: це означало б мовчки поставити щойно опублікований
  // пакет. Тому кажемо, чим це лікується, а вибір лишаємо йому.
  if (/min-dep-age|minimum.{0,24}age|dependency age/i.test(step.output)) {
    step.output += `\n\nЗалежність молодша за добу — спрацювала політика supply-chain.\n` +
      `   Якщо джерелу довіряєте, поставте залежності явно й повторіть оновлення:\n` +
      `   deno install --min-dep-age=0`;
  }
  return step;
}

export interface UpdateOptions {
  check?: boolean;
  force?: boolean;
  verbose?: boolean;
  tasks?: string[];
  /**
   * Ставити залежності перед оновленням. Умовчання — так; `false` лишили для
   * проб, яким не потрібна мережа.
   */
  install?: boolean;
  /** Ім'я ассета, якщо в релізі кілька пакетів (див. `resolve-solution-source.ts`). */
  asset?: string;
}

export async function updateSolution(
  sourceSpec: string,
  targetDirArg = ".",
  options: UpdateOptions = {},
): Promise<UpdateResult> {
  const projectRoot = resolve(Deno.cwd(), targetDirArg);
  const steps: UpdateStep[] = [];

  // Джерело резолвиться ТУТ, а не всередині кожного кроку: пакет читається
  // двічі — спершу манифест, потім усе дерево, — і завантажувати його двічі
  // означало б і подвійний трафік, і ризик узяти два різні пакети, якщо реліз
  // між читаннями перезаписали.
  const source = await resolveSolutionSource(sourceSpec, { asset: options.asset });
  try {
    return await runUpdate(source.path, projectRoot, steps, options);
  } finally {
    await source.cleanup();
  }
}

async function runUpdate(
  archivePath: string,
  projectRoot: string,
  steps: UpdateStep[],
  options: UpdateOptions,
): Promise<UpdateResult> {
  // Частковий пакет — інструмент розробника, а не поставка: він не описує
  // рішення цілком, тож поняття «оновити установку до нього» не існує. Беремо
  // це до розпакування, бо манифест лежить першим записом і читається дешево.
  const incoming = await readPackageManifest(archivePath);
  if ((incoming.kind ?? "full") === "partial") {
    throw new Error(
      "Це частковий пакет (набір моделей), а не поставка рішення — оновлювати установку ним не можна.\n" +
        "   Додати моделі в наявне рішення: deno task solution:import -- <пакет>",
    );
  }

  // Залежності — до розпакування (чому саме так, див. `installDependencies`).
  // У режимі `--check` не ставимо: він нічого не змінює й нічого не запускає.
  if (!options.check && options.install !== false) {
    console.log("\n▶ deno install");
    const step = await installDependencies(projectRoot);
    steps.push(step);
    if (step.output) console.log(step.output);
    if (!step.ok) {
      console.error(
        "\n❌ Залежності не встановилися — оновлення НЕ починалося, установка лишилася як була.",
      );
      return { steps, ok: false, applied: false };
    }
  }

  const imported = await importSolution(archivePath, projectRoot, {
    check: options.check,
    force: options.force,
    verbose: options.verbose,
    // Ланцюжок жену я — друкувати його ще й інструкцією означало б показати
    // адміністраторові список, який він виконувати не мусить.
    runsChain: !options.check,
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
  // `--asset <ім'я>` витягується ПЕРШИМ: його значення не має префікса, тож у
  // позиційних воно виглядало б каталогом установки.
  const rest = [...Deno.args];
  const assetIndex = rest.indexOf("--asset");
  const asset = assetIndex === -1 ? undefined : rest.splice(assetIndex, 2)[1];

  const positional = rest.filter((arg) => !arg.startsWith("--"));
  const source = positional[0];
  const targetDir = positional[1] ?? ".";

  if (!source) {
    console.error(
      "Використання: update-solution <пакет.tar.gz | URL | власник/репозиторій@тег> [каталог]\n" +
        "              [--check] [--force] [--verbose] [--asset <ім'я>]",
    );
    Deno.exit(1);
  }

  try {
    const result = await updateSolution(source, targetDir, {
      check: rest.includes("--check"),
      force: rest.includes("--force"),
      verbose: rest.includes("--verbose"),
      asset,
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
