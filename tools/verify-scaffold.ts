// Перевірка шаблону scaffold: згенерувати застосунок у тимчасовий каталог,
// поставити залежності й перевірити типи та збірку.
//
// Навіщо окремий інструмент. Файли шаблону не можна перевірити на місці:
// `deno check create/template/app/main.ts` дає 36 помилок, бо в монорепо
// `@client/` — це аліас на каталог, а не пакет, і вкладений `deno.json`
// шаблону в цьому розкладі не працює. Тобто шаблон компілюється лише там, де
// він і має жити — у згенерованому застосунку.
//
// Два дефекти, знайдені саме так і вже після публікації `0.1.0`:
//   - коментар `"//@client"` УСЕРЕДИНІ `imports` — Deno вважає його адресою
//     («Invalid address … for the specifier key»), а не коментарем;
//   - `bus.request()` типізований узагальнено, тож `envelope.data` без явного
//     звуження не компілюється.
// Обидва видно лише на згенерованому застосунку. Звідси й ця перевірка.
import { join, relative, resolve, SEPARATOR, toFileUrl } from "@std/path";
import { normalizeEol } from "./normalize-eol.ts";

/** Пакети монорепо, на які шаблон посилається через jsr. */
const LOCAL_PACKAGES = ["client", "server", "tools", "skills"];

/**
 * Перевести залежності згенерованого застосунку на вихідники цього репозиторію.
 *
 * Без цього перевірка має сліпу пляму рівно там, де вона найпотрібніша. Шаблон
 * пінить пакети діапазоном (`jsr:@altera/client@^0.5.0`), тож перевіряється
 * завжди ОПУБЛІКОВАНА версія — а публікація на jsr незворотна. Поки в шаблоні
 * стоїть діапазон, якого в реєстрі ще немає, крок `deno install` падає на
 * нерозв'язному пінові й до збірки не доходить: дефект у самому шаблоні
 * лишається невидимим, поки його не опублікують назавжди.
 *
 * `links` (у Deno < 2.9 — `patch`) підміняє jsr-залежність каталогом на диску,
 * не чіпаючи карту імпортів: у `deno.json` лишається той самий діапазон, просто
 * резолвиться він локально.
 *
 * Чого цей режим НЕ покриває: пресет визначає каталог фреймворку по власному
 * `import.meta.url`, і з `links` той файловий — тобто йде монорепо-гілка
 * `resolveFrameworkDir()`, а не гілка `vendor/jsr.io/...`. Вендорений розклад
 * перевіряє лише звичайний прогін, уже після публікації.
 */
async function linkLocalPackages(appDir: string, repoRoot: string): Promise<string[]> {
  const configPath = join(appDir, "deno.json");
  const config = JSON.parse(await Deno.readTextFile(configPath));

  const links: string[] = [];
  for (const pkg of LOCAL_PACKAGES) {
    const dir = join(repoRoot, pkg);
    try {
      if ((await Deno.stat(dir)).isDirectory) links.push(toFileUrl(dir).href);
    } catch {
      // пакета немає — не біда, лінкуємо ті, що є
    }
  }

  config.links = links;
  await Deno.writeTextFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  // Той самий підмін, але для Tailwind. `links` віддає пакет каталогом ПОЗА
  // застосунком, тож `vendor/jsr.io/@altera` тут не з'являється зовсім, і
  // `@source` на нього не веде нікуди — а пресет це тепер вважає помилкою
  // збірки. І правильно вважає: у справжньому застосунку порожнє джерело
  // означає зниклі класи фреймворку при зеленій збірці. Тому не послаблюємо
  // перевірку, а наводимо шлях туди, куди в цьому режимі веде й усе інше.
  const cssPath = join(appDir, "app", "styles", "tailwind.css");
  const css = await Deno.readTextFile(cssPath);
  const patched = css.replace(
    /@source\s+"[^"]*vendor\/jsr\.io\/@altera[^"]*"/,
    `@source "${join(repoRoot, "client").replaceAll("\\", "/")}"`,
  );
  if (patched !== css) await Deno.writeTextFile(cssPath, patched);

  return links;
}

async function run(cmd: string[], cwd: string): Promise<{ ok: boolean; output: string }> {
  const command = new Deno.Command(Deno.execPath(), { args: cmd, cwd, stdout: "piped", stderr: "piped" });
  const { success, stdout, stderr } = await command.output();
  return {
    ok: success,
    output: new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr),
  };
}

/**
 * Згенерована мапа не розійшлася з деревом шаблону.
 *
 * Це не теоретична обережність: `@altera/create@0.1.4` пішов у реєстр саме
 * таким — у `create/template/deno.json` версії фреймворку вже підняли на
 * `^0.4.0`, а `scaffold:template` не перезапустили, тож у пакет поїхали старі
 * `^0.3.3`. Згенерований застосунок ставив попередній клієнт і не компілювався.
 * Збірка цього не бачить: вона працює з мапою, а не з деревом.
 */
async function checkTemplateFresh(): Promise<string[]> {
  const templateDir = resolve("create/template");
  const problems: string[] = [];

  let TEMPLATE: Record<string, string>;
  try {
    ({ TEMPLATE } = await import(`file://${resolve("create/template.generated.ts").replaceAll("\\", "/")}`));
  } catch {
    return ["не вдалося прочитати create/template.generated.ts"];
  }

  const onDisk = new Map<string, string>();
  async function walk(dir: string) {
    for await (const entry of Deno.readDir(dir)) {
      const full = join(dir, entry.name);
      if (entry.isDirectory) await walk(full);
      else if (entry.isFile) {
        onDisk.set(
          relative(templateDir, full).split(SEPARATOR).join("/"),
          normalizeEol(await Deno.readTextFile(full)),
        );
      }
    }
  }
  await walk(templateDir);

  for (const [key, body] of onDisk) {
    if (!(key in TEMPLATE)) problems.push(`${key}: немає в мапі`);
    else if (TEMPLATE[key] !== body) problems.push(`${key}: вміст розійшовся`);
  }
  for (const key of Object.keys(TEMPLATE)) {
    if (!onDisk.has(key)) problems.push(`${key}: є в мапі, але немає на диску`);
  }

  return problems;
}

/** `git` із порожнім рядком замість помилки: історії може не бути зовсім. */
async function git(args: string[]): Promise<string> {
  try {
    const { success, stdout } = await new Deno.Command("git", {
      args,
      cwd: Deno.cwd(),
      stdout: "piped",
      stderr: "null",
    }).output();
    return success ? new TextDecoder().decode(stdout).trim() : "";
  } catch {
    return "";
  }
}

/**
 * Пакет, який ЗМІНИВСЯ після того, як його номер пішов у реєстр.
 *
 * Це сліпа пляма `:local` за побудовою: він підміняє залежності ВИХІДНИКАМИ, де
 * усе завжди свіже, — тож правка, яка нікуди не поїхала, проходить зелено.
 * Застосункам реєстр при цьому віддає старий вміст, і побачити це можна лише
 * після публікації решти пакетів, тобто вже незворотно.
 *
 * Два випадки за один день, обидва ловляться саме цим:
 *
 *   • `client` дістав три експорти (`tab-url`, `ui-dialog`, `ui-remark`) і
 *     вжиток їх у шаблоні, а номер лишився `0.12.3` — кожен свіжий застосунок
 *     падав на `Unknown export './tabs/tab-url.ts' for '@altera/client@0.12.3'`;
 *   • `tools@0.13.12` пішов у реєстр із піном `@altera/server@^0.19.0`, а в
 *     репозиторії той самий номер уже пінив `^0.20.0`.
 *
 * Міряємо ІСТОРІЄЮ, а не байтами опублікованого. Байти не годяться: JSR
 * переписує специфікатори імпорту при публікації (`"lit"` → `"npm:lit@^3.3.1"`),
 * тож жоден вихідний файл із голим імпортом не збігається сам із собою — і
 * відтворювати те переписування локально означало б тримати другу його копію.
 *
 * Точка відліку — те, що ОПУБЛІКОВАНО, а не коміт, який поставив версію.
 * Різниця вистрелила першою ж версією цієї перевірки: реліз законно їде
 * ПОЇЗДОМ (бамп першим комітом, далі правки, пуш усього разом), публікується
 * head — і «коміти після бампа» були в реєстрі, а перевірка вважала їх
 * неопублікованими. Гірше, що вердикт мінявся з часом: до публікації вона
 * мовчала (версії ще немає в реєстрі), після — червоніла на тому самому дереві.
 *
 * Опублікований коміт береться з ТЕГА `jsr/<пакет>@<версія>` — його ставить
 * publish-workflow. Для версій, виданих до тегів, фолбек — час публікації з
 * реєстру: підозрілі лише коміти, вчинені ПІСЛЯ createdAt (із запасом на
 * годинники); усе, що встигло в пуш до публікації, опубліковане за побудовою.
 *
 * Проби з відповіді виключені: вони в пакет не їдуть (`publish.exclude`), тож
 * коміт, який чіпає лише їх, релізу не потребує.
 *
 * Мережі може не бути, а історія — куцою (у CI `actions/checkout` мусить брати
 * `fetch-depth: 0`). Обидва рази крок каже, що пропущений: мовчазний пропуск
 * тут гірший за відсутність перевірки.
 */
async function checkPublishedContent(): Promise<{ skipped: string | null; problems: string[] }> {
  const problems: string[] = [];
  const clockSlackMs = 10 * 60 * 1000;

  // create — теж пакет реєстру, хоч і не лінкується (він сам і є scaffold).
  for (const pkg of [...LOCAL_PACKAGES, "create"]) {
    let local: { version: string };
    try {
      local = JSON.parse(await Deno.readTextFile(resolve(pkg, "deno.json")));
    } catch {
      continue;
    }

    let latest: string;
    let publishedAt: number | null = null;
    try {
      const meta = await (await fetch(`https://jsr.io/@altera/${pkg}/meta.json`)).json();
      latest = meta.latest;
      if (local.version === latest) {
        const version = await (await fetch(`https://api.jsr.io/scopes/altera/packages/${pkg}/versions/${latest}`))
          .json();
        publishedAt = version.createdAt ? Date.parse(version.createdAt) : null;
      }
    } catch (error) {
      return { skipped: `${pkg}: ${error instanceof Error ? error.message : error}`, problems: [] };
    }
    if (local.version !== latest) continue; // бамп уже є — правки вільні

    // Точний шлях: тег публікації.
    const tagged = await git(["rev-parse", "-q", "--verify", `refs/tags/jsr/${pkg}@${latest}`]);
    let suspects: string[];

    if (tagged) {
      const since = await git([
        "log",
        "--format=%h %s",
        `${tagged}..HEAD`,
        "--",
        pkg,
        `:(exclude)${pkg}/**/*_test.ts`,
      ]);
      suspects = since.split("\n").filter(Boolean);
    } else {
      // Фолбек без тега: коміти в каталог пакета, ВЧИНЕНІ після публікації.
      if (publishedAt === null) {
        return { skipped: `${pkg}: реєстр не віддав createdAt для ${latest}`, problems: [] };
      }
      const log = await git([
        "log",
        "--format=%h%x09%cI%x09%s",
        "--",
        pkg,
        `:(exclude)${pkg}/**/*_test.ts`,
      ]);
      suspects = log.split("\n").filter(Boolean)
        .map((line) => line.split("\t"))
        .filter(([, committedAt]) => Date.parse(committedAt) > publishedAt + clockSlackMs)
        .map(([hash, , subject]) => `${hash} ${subject}`);
    }

    if (suspects.length) {
      const shown = suspects.slice(0, 6);
      problems.push(
        `@altera/${pkg}@${latest} уже в реєстрі, а пакет змінився після публікації — підніми версію` +
          `\n      ${shown.join("\n      ")}` +
          (suspects.length > shown.length ? `\n      … і ще ${suspects.length - shown.length}` : ""),
      );
    }
  }

  return { skipped: null, problems };
}

/**
 * Модуль фреймворку, відданий dev-сервером, справді транспільований.
 *
 * Порт нестандартний і `--strictPort`: якщо 5173 зайнятий робочим застосунком,
 * проба має впасти, а не мовчки перевірити чужий сервер.
 */
async function checkDevTransform(appDir: string): Promise<boolean> {
  const port = 51730;
  const base = `http://127.0.0.1:${port}`;

  const vite = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "npm:vite", "--configLoader", "native", "--port", String(port), "--strictPort"],
    cwd: appDir,
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  try {
    let entry: string | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const response = await fetch(`${base}/main.ts`);
        if (response.ok) {
          entry = await response.text();
          break;
        }
        await response.body?.cancel();
      } catch {
        // сервер ще не піднявся
      }
    }

    if (!entry) {
      console.error("✗ dev-сервер не відповів за 30 с — перевірити транспіляцію нічим");
      return false;
    }

    // Шлях до модуля фреймворку беремо з самого entry: у ньому вже стоять
    // переписані Vite специфікатори (/@fs/…/vendor/jsr.io/@altera/client/…).
    const moduleUrl = entry.match(/\/@fs\/[^"']*tabs\/tab-controller\.ts/)?.[0];
    if (!moduleUrl) {
      console.error("✗ у main.ts немає імпорту tab-controller — перевірка транспіляції втратила ціль");
      return false;
    }

    const code = await (await fetch(`${base}${moduleUrl}`)).text();

    if (/export\s+@/.test(code)) {
      console.error("✗ dev-сервер віддає незнижений декоратор (`export @…`) — сторінка впаде на Unexpected token 'export'");
      console.error("    причина завжди одна: tsconfig.json не покриває vendor/, і Oxc транспілює фреймворк без experimentalDecorators");
      return false;
    }
    if (!code.includes("decorate")) {
      console.error("✗ у модулі фреймворку немає знижченого декоратора — Lit-компоненти не транспільовані");
      return false;
    }

    console.log("✓ dev-транспіляція фреймворку (декоратори знижені)");
    return true;
  } finally {
    try {
      vite.kill();
    } catch {
      // уже завершився
    }
    await vite.status;
    await vite.stdout.cancel();
    await vite.stderr.cancel();
  }
}

export async function verifyScaffold(
  options: { createEntry: string; keep?: boolean; local?: boolean },
): Promise<boolean> {
  const target = await Deno.makeTempDir({ prefix: "altera-scaffold-" });
  const appDir = join(target, "probe");
  // Абсолютний: кроки виконуються з cwd у тимчасовому каталозі, і відносний
  // шлях до scaffold звідти вказував би в порожнечу.
  const createEntry = options.createEntry.startsWith("jsr:")
    ? options.createEntry
    : resolve(options.createEntry);
  let ok = true;

  console.log(`· каталог: ${appDir}`);

  const stale = await checkTemplateFresh();
  if (stale.length) {
    console.error("✗ template.generated.ts застарів — виконай `deno task scaffold:template`:");
    for (const problem of stale) console.error(`    ${problem}`);
    if (!options.keep) await Deno.remove(target, { recursive: true });
    return false;
  }
  console.log("✓ template.generated.ts свіжий");

  const content = await checkPublishedContent();
  if (content.problems.length) {
    console.error("✗ вміст пакета розійшовся з опублікованим під тим самим номером:");
    for (const problem of content.problems) console.error(`    ${problem}`);
    if (!options.keep) await Deno.remove(target, { recursive: true });
    return false;
  }
  console.log(
    content.skipped
      ? `— вміст проти реєстру: ПРОПУЩЕНО (${content.skipped})`
      : "✓ вміст пакетів або збігається з реєстром, або версія піднята",
  );

  // Scaffold — окремо від решти: між ним і `deno install` вклинюється підміна
  // залежностей на локальні, а вона працює лише з уже згенерованим deno.json.
  const scaffold = await run(["run", "-A", createEntry, appDir], target);
  console.log(`${scaffold.ok ? "✓" : "✗"} scaffold`);
  if (!scaffold.ok) {
    console.error(scaffold.output.trimEnd());
    if (!options.keep) await Deno.remove(target, { recursive: true });
    return false;
  }

  if (options.local) {
    const links = await linkLocalPackages(appDir, Deno.cwd());
    console.log(`✓ links → ${links.map((l) => l.split("/").at(-1)).join(", ")} (локальні вихідники)`);
  }

  const steps: Array<[string, string[], string]> = [
    // Свіжу версію фреймворку інакше не поставити: політика мінімального віку
    // залежності блокує все, опубліковане менш ніж 24 години тому.
    ["deno install", ["install", "--min-dep-age=0"], appDir],
    // Обидва composition root — і ВСІ файли застосунку. Екрани моделей у граф
    // від main.ts не входять: їх вантажить рантайм в'ю динамічно, за реєстром.
    // Тобто зламаний екран моделі раніше проходив перевірку типів наскрізь.
    // scripts/ — теж вихідники застосунку, і саме там ловиться забутий запис у
    // карті імпортів шаблону: у монорепо ці модулі резолвляться коренем
    // воркспейсу й мовчать, а в згенерованому застосунку карта своя.
    [
      "deno check",
      ["check", "--min-dep-age=0", "app/server.ts", "app/main.ts", "app/**/*.ts", "scripts/*.ts"],
      appDir,
    ],
    ["build:front", ["task", "build:front"], appDir],
  ];

  for (const [label, args, cwd] of steps) {
    const result = await run(args, cwd);
    console.log(`${result.ok ? "✓" : "✗"} ${label}`);
    if (!result.ok) {
      console.error(result.output.trimEnd());
      ok = false;
      break;
    }
    // Попередження про карту імпортів помилкою не вважається, але означає, що в
    // згенерованому deno.json лежить недопустимий ключ — саме той дефект 0.1.0.
    if (result.output.includes("Invalid address")) {
      console.error("✗ у згенерованому deno.json недопустимий ключ карти імпортів:");
      console.error(result.output.split("\n").filter((l) => l.includes("Invalid address")).join("\n"));
      ok = false;
      break;
    }
  }

  // Декоратори Lit ламаються не на збірці, а в браузері — «Unsupported decorator
  // location: field», біла сторінка при зелених типах і робочому API. Причина
  // завжди одна: транспілятор усередині Vite (з Vite 8 — Oxc, до того esbuild)
  // не бачить `experimentalDecorators`, бо
  // читає tsconfig.json, а не deno.json. Тут перевіряємо хоча б наявність.
  if (ok) {
    try {
      const tsconfig = JSON.parse(await Deno.readTextFile(join(appDir, "tsconfig.json")));
      const include: string[] = tsconfig.include ?? [];
      // Опції беруться з того tsconfig, чий include покриває файл, — а не з
      // «найближчого вгору». Вихідники фреймворку лежать у vendor/, і поки їх
      // там не було, вони транспілювалися без experimentalDecorators: застосунок
      // піднімався, а перший компонент фреймворку валив завантаження.
      const coversVendor = include.some((pattern) => pattern.startsWith("vendor/"));

      if (tsconfig.compilerOptions?.experimentalDecorators !== true) {
        console.error("✗ tsconfig.json без experimentalDecorators — декоратори Lit впадуть у рантаймі");
        ok = false;
      } else if (!coversVendor) {
        console.error("✗ tsconfig.json include не покриває vendor/ — фреймворк транспілюється без декораторів");
        ok = false;
      } else {
        console.log("✓ tsconfig experimentalDecorators (включно з vendor/)");
      }
    } catch {
      console.error("✗ у згенерованому застосунку немає tsconfig.json — Oxc не побачить experimentalDecorators");
      ok = false;
    }
  }

  // А тепер — сам dev-режим, а не декларація про нього.
  //
  // Перевірка `tsconfig` вище каже лише про наміри: файл є, опція стоїть,
  // vendor/ у include. Чи подіяло це на вендорені вихідники — видно тільки в
  // тому, що Vite реально віддає браузеру. І перевіряти треба саме DEV: збірка
  // (Rolldown) знижує декоратори й без tsconfig, а Oxc у dev-сервері — ні. Тому
  // «✓ build:front» нічого про цю поломку не каже, і вона доїхала до живого
  // застосунку: `Unexpected token 'export'` на першому ж компоненті фреймворку,
  // нескінченний повернення на екран входу і жодного сліду в збірці.
  if (ok) ok = await checkDevTransform(appDir);

  // Локалі застосунку — не модулі, а копійовані активи, тож бандлер про них
  // нічого не знає: покладені не туди, вони не валять ні збірку, ні типи.
  // Ламається лише сам застосунок і лише в браузері — замість назв лишаються
  // голі ключі (`bank.titleMany` у заголовках вкладок), бо `locale.ts` дістає
  // 404 і мовчки відкочується на ключ.
  //
  // Саме так і сталося на `vite-plugin-static-copy` 4: з цієї версії плагін
  // зберігає структуру каталогів, і `_locales/*` → `locales/app` почав класти
  // файли на рівень глибше. Тому перевіряємо не «збірка пройшла», а що файл
  // лежить рівно за тією адресою, яку запитує рантайм.
  if (ok) {
    try {
      const locales: string[] = [];
      for await (const entry of Deno.readDir(join(appDir, "app", "_locales"))) {
        if (entry.isFile && entry.name.endsWith(".json")) locales.push(entry.name);
      }

      const missing: string[] = [];
      for (const name of locales) {
        const path = join(appDir, "dist", "locales", "app", name);
        if (!(await Deno.stat(path).then(() => true).catch(() => false))) missing.push(name);
      }

      if (!locales.length) {
        console.error("✗ у шаблоні немає app/_locales/*.json — перевірити нічого");
        ok = false;
      } else if (missing.length) {
        console.error(`✗ локалі не потрапили в dist/locales/app/: ${missing.join(", ")}`);
        console.error("    застосунок покаже голі ключі замість назв — див. targets у client/vite.ts");
        ok = false;
      } else {
        console.log(`✓ локалі в dist/locales/app/ (${locales.join(", ")})`);
      }
    } catch (error) {
      console.error(`✗ не вдалося перевірити локалі: ${error instanceof Error ? error.message : error}`);
      ok = false;
    }
  }

  // Чанк в'ю мусить віддавати `tagName` — саме за ним оболонка створює елемент
  // форми. Це видно ЛИШЕ у продуктивній збірці: у деві в'ю приходять з Vite
  // вихідними модулями, де експорт на місці, а в зібраному чанку його може не
  // бути. Так і сталося: Vite для застосунку ставить `preserveEntrySignatures:
  // false` (входом вважається HTML), і наші в'ю-входи потрапляли під це правило
  // разом з усіма. Збірка зелена, типи зелені, а в застосунку кожна вкладка
  // падає з «модуль не експортує tagName» — і дізналися ми про це з живого
  // розгортання, бо перевіряти було нічим.
  if (ok) {
    try {
      const manifestPath = join(appDir, "dist", ".vite", "manifest.json");
      const manifest = JSON.parse(await Deno.readTextFile(manifestPath)) as Record<
        string,
        { file: string; isEntry?: boolean }
      >;

      // В'ю — входи, чиє джерело лежить у моделі: <family>/<model>/<View>.ts.
      // Ключі маніфесту рахуються від кореня Vite (каталог застосунку), тому
      // без префікса `app/`: поряд тут лише `index.html`.
      const viewChunks = Object.entries(manifest)
        .filter(([source, entry]) => entry.isEntry && /^[^/]+\/[^/]+\/[^/]+\.ts$/.test(source))
        .map(([, entry]) => entry.file);

      const withoutTagName: string[] = [];
      for (const file of viewChunks) {
        const text = await Deno.readTextFile(join(appDir, "dist", file));
        if (!/\bexport\s*\{[^}]*\btagName\b/.test(text)) withoutTagName.push(file);
      }

      if (!viewChunks.length) {
        console.error("✗ у dist/.vite/manifest.json немає жодного входу-в'ю — перевірити нічого");
        ok = false;
      } else if (withoutTagName.length) {
        console.error(`✗ чанк в'ю без експорту tagName: ${withoutTagName.join(", ")}`);
        console.error("    у застосунку кожна вкладка впаде — див. preserveEntrySignatures у client/vite.ts");
        ok = false;
      } else {
        console.log(`✓ чанки в'ю експортують tagName (${viewChunks.length})`);
      }
    } catch (error) {
      console.error(`✗ не вдалося перевірити чанки в'ю: ${error instanceof Error ? error.message : error}`);
      ok = false;
    }
  }

  // Скіли — не модулі й не активи збірки, тож ані типи, ані `build:front` про них
  // не знають: не розклалися — усе зелене, а агент у застосунку працює без них і
  // пише форми руками. Перевіряємо і сам факт розкладки, і наявність задачі, якою
  // їх оновлюють: без неї вони застигли б на версії, з якою створили застосунок.
  if (ok) {
    try {
      const skillsDir = join(appDir, ".claude", "skills");
      const names: string[] = [];
      for await (const entry of Deno.readDir(skillsDir)) {
        if (entry.isDirectory) names.push(entry.name);
      }

      const config = JSON.parse(await Deno.readTextFile(join(appDir, "deno.json")));
      const hasTask = typeof config.tasks?.["skills:sync"] === "string";

      if (!names.length) {
        console.error("✗ .claude/skills порожній — застосунок створено без скілів фреймворку");
        ok = false;
      } else if (!hasTask) {
        console.error("✗ у згенерованому deno.json немає задачі skills:sync — скіли нічим оновити");
        ok = false;
      } else {
        console.log(`✓ скіли розкладені (${names.length}) і є задача skills:sync`);
      }

      // А тепер те саме — З РЕЄСТРУ. Розкладка вище нічого не каже про
      // опублікований пакет: scaffold запускається з вихідників, і в монорепо
      // `@altera/skills` резолвиться воркспейсом. Тобто зламаний реліз скілів
      // проходив би повз усі перевірки, і побачив би його вперше той, хто
      // виконав `deno task skills:sync` у себе.
      //
      // Каталог перед прогоном зносимо: інакше «скіли на місці» довело б лише
      // те, що їх поклав scaffold хвилину тому.
      //
      // У режимі --local кроку немає: `links` підмінює пакет каталогом на
      // диску, тобто перевірявся б той самий вихідник удруге. Реєстр покриває
      // лише звичайний прогін — так само, як вендорений розклад.
      if (ok && !options.local) {
        const specifier = String(config.tasks["skills:sync"]).match(/jsr:@altera\/skills@\S+/)?.[0];

        if (!specifier) {
          console.error("✗ у задачі skills:sync немає jsr-специфікатора — нічого перевіряти проти реєстру");
          ok = false;
        } else {
          await Deno.remove(skillsDir, { recursive: true });

          // --min-dep-age=0 — з тієї ж причини, що й у `deno install` вище:
          // політика мінімального віку блокує щойно опубліковану версію, а
          // post-release прогін іде саме по ній.
          const sync = await run(["run", "-A", "--min-dep-age=0", specifier, "./"], appDir);

          const resynced: string[] = [];
          try {
            for await (const entry of Deno.readDir(skillsDir)) {
              if (entry.isDirectory) resynced.push(entry.name);
            }
          } catch {
            // каталог не з'явився — нижче це й буде помилкою
          }

          const marked = resynced.length > 0 &&
            (await Deno.readTextFile(join(skillsDir, resynced[0], "SKILL.md")))
              .includes("@altera/skills@");

          if (!sync.ok || !resynced.length || !marked) {
            console.error(`✗ skills:sync з реєстру (${specifier}) не розклав скіли`);
            console.error(sync.output.trimEnd());
            ok = false;
          } else {
            console.log(`✓ skills:sync з реєстру (${resynced.length} скілів)`);
          }
        }
      }
    } catch (error) {
      console.error(`✗ не вдалося перевірити скіли: ${error instanceof Error ? error.message : error}`);
      ok = false;
    }
  }

  // Збірка SQL — і версія ядра, з якої вона зроблена.
  //
  // Крок з'явився після дефекту, який пройшов повз УСІ попередні перевірки:
  // типи, збірка фронтенду й розкладка скілів були зелені, а застосунок на
  // чистій базі падав на вході — `column "must_change_password" does not
  // exist`. Причина: `@altera/tools` імпортував SQL ядра зі СВОГО
  // `@altera/server` (у карті імпортів пакета його не було взагалі, тож JSR
  // зафіксував ту версію, що стояла у воркспейсі при публікації tools), і в
  // базу їхала схема server@0.3.0, а читав її рантайм 0.5.0.
  //
  // Звідси дві перевірки. Перша — що збірка взагалі проходить у згенерованому
  // застосунку (вона тепер іде через обгортку в його `scripts/`). Друга —
  // інваріант: у графі застосунку рівно ОДНА версія `@altera/server`. Дві
  // означають, що хтось у ланцюжку носить власний сервер, — саме та картина,
  // що дала цей дефект.
  if (ok) {
    const assemble = await run(["task", "sql:assemble"], appDir);
    if (!assemble.ok) {
      console.error("✗ sql:assemble у згенерованому застосунку впав");
      console.error(assemble.output.trimEnd());
      ok = false;
    } else {
      try {
        const packageDir = join(appDir, "app", "_sqlpackage");
        let coreLanded = false;
        for await (const entry of Deno.readDir(packageDir)) {
          if (!entry.isFile || !entry.name.endsWith("struc_app.sql")) continue;
          coreLanded = (await Deno.readTextFile(join(packageDir, entry.name))).includes("app.users");
        }

        if (!coreLanded) {
          console.error("✗ у зібраному struc_app.sql немає таблиць ядра — @core/* не потрапив у пакет");
          ok = false;
        } else {
          console.log("✓ sql:assemble (SQL ядра в пакеті)");
        }
      } catch (error) {
        console.error(`✗ не вдалося прочитати _sqlpackage: ${error instanceof Error ? error.message : error}`);
        ok = false;
      }
    }
  }

  if (ok) {
    try {
      const lock = JSON.parse(await Deno.readTextFile(join(appDir, "deno.lock")));
      const servers = Object.keys(lock.jsr ?? {}).filter((key) => key.startsWith("@altera/server@"));

      // Нуль — це режим --local: `links` підмінив пакет каталогом, і в графі
      // його немає. Перевіряти там нічого, а от два — завжди дефект.
      if (servers.length > 1) {
        console.error(`✗ у графі застосунку ${servers.length} версії @altera/server: ${servers.join(", ")}`);
        console.error("    SQL ядра й рантайм розійдуться — оголоси ту саму версію в залежностях інструментів");
        ok = false;
      } else if (servers.length === 1) {
        console.log(`✓ одна версія сервера в графі (${servers[0]})`);
      }
    } catch (error) {
      console.error(`✗ не вдалося прочитати deno.lock: ${error instanceof Error ? error.message : error}`);
      ok = false;
    }
  }

  if (options.keep) {
    console.log(`\nкаталог лишено: ${appDir}`);
  } else {
    await Deno.remove(target, { recursive: true });
  }

  return ok;
}

if (import.meta.main) {
  const keep = Deno.args.includes("--keep");
  const local = Deno.args.includes("--local");
  const entry = Deno.args.find((a) => !a.startsWith("--")) ?? "./create/main.ts";
  const ok = await verifyScaffold({ createEntry: entry, keep, local });
  console.log(
    ok
      ? local
        ? "\n✅ шаблон scaffold цілий (проти локальних вихідників; вендорений розклад — звичайним прогоном після публікації)"
        : "\n✅ шаблон scaffold цілий"
      : "\n❌ шаблон scaffold зламаний",
  );
  if (!ok) Deno.exit(1);
}
