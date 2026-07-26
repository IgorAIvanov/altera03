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
import { join, resolve } from "@std/path";

async function run(cmd: string[], cwd: string): Promise<{ ok: boolean; output: string }> {
  const command = new Deno.Command(Deno.execPath(), { args: cmd, cwd, stdout: "piped", stderr: "piped" });
  const { success, stdout, stderr } = await command.output();
  return {
    ok: success,
    output: new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr),
  };
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
