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
import { join, relative, resolve, SEPARATOR } from "@std/path";
import { normalizeEol } from "./normalize-eol.ts";

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

export async function verifyScaffold(options: { createEntry: string; keep?: boolean }): Promise<boolean> {
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

  const steps: Array<[string, string[], string]> = [
    ["scaffold", ["run", "-A", createEntry, appDir], target],
    // Свіжу версію фреймворку інакше не поставити: політика мінімального віку
    // залежності блокує все, опубліковане менш ніж 24 години тому.
    ["deno install", ["install", "--min-dep-age=0"], appDir],
    ["deno check", ["check", "--min-dep-age=0", "app/server.ts", "app/main.ts"], appDir],
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
  // завжди одна: esbuild усередині Vite не бачить `experimentalDecorators`, бо
  // читає tsconfig.json, а не deno.json. Тут перевіряємо хоча б наявність.
  if (ok) {
    try {
      const tsconfig = JSON.parse(await Deno.readTextFile(join(appDir, "tsconfig.json")));
      if (tsconfig.compilerOptions?.experimentalDecorators !== true) {
        console.error("✗ tsconfig.json без experimentalDecorators — декоратори Lit впадуть у рантаймі");
        ok = false;
      } else {
        console.log("✓ tsconfig experimentalDecorators");
      }
    } catch {
      console.error("✗ у згенерованому застосунку немає tsconfig.json — esbuild не побачить experimentalDecorators");
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
  const entry = Deno.args.find((a) => !a.startsWith("--")) ?? "./create/main.ts";
  const ok = await verifyScaffold({ createEntry: entry, keep });
  console.log(ok ? "\n✅ шаблон scaffold цілий" : "\n❌ шаблон scaffold зламаний");
  if (!ok) Deno.exit(1);
}
