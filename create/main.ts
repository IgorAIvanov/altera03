// Scaffold застосунку на фреймворку Altera.
//
//   deno run -A jsr:@altera/create my-erp
//
// Кладе мінімальний, але цілий застосунок: три пакети приходять із jsr, а тут
// лишається тільки те, що належить застосунку — composition root клієнта й
// сервера, оболонка (шапка, меню, стартова вкладка, вхід), вхід збірки Tailwind
// і sql.json. Далі моделі додаються в app/<family>/<model>/.
import { TEMPLATE } from "./template.generated.ts";

const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

export interface ScaffoldOptions {
  /** Каталог, у який класти застосунок. Його ім'я стає іменем проєкту. */
  targetDir: string;
  /** Ім'я проєкту; за замовчуванням — ім'я каталогу. */
  name?: string;
  force?: boolean;
}

/** Порожній каталог або відсутній — обидва випадки годяться. */
async function isEmptyDir(path: string): Promise<boolean> {
  try {
    for await (const _ of Deno.readDir(path)) return false;
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return true;
    throw error;
  }
}

export async function scaffold(options: ScaffoldOptions): Promise<string[]> {
  const { targetDir, force = false } = options;
  const name = options.name ?? targetDir.split(/[\\/]/).filter(Boolean).pop() ?? "app";

  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Ім'я проєкту «${name}» не годиться: очікую малі латинські літери, цифри, "-" і "_", ` +
        `перший символ — літера. Воно йде в назву бази й у sql.json.`,
    );
  }

  if (!force && !await isEmptyDir(targetDir)) {
    throw new Error(`Каталог ${targetDir} не порожній. Вкажи інший або додай --force.`);
  }

  const written: string[] = [];

  for (const [relativePath, body] of Object.entries(TEMPLATE)) {
    const target = `${targetDir}/${relativePath}`;
    const dir = target.slice(0, target.lastIndexOf("/"));

    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(target, body.replaceAll("{{name}}", name));
    written.push(relativePath);
  }

  return written.sort();
}

function usage(): never {
  console.error(
    [
      "Створити застосунок на фреймворку Altera:",
      "",
      "  deno run -A jsr:@altera/create <каталог> [--name <ім'я>] [--force]",
      "",
      "  <каталог>   куди класти; його ім'я стає іменем проєкту",
      "  --name      інше ім'я проєкту (бази, sql.json, заголовків)",
      "  --force     писати навіть у непорожній каталог",
    ].join("\n"),
  );
  Deno.exit(1);
}

async function main() {
  const args = Deno.args;
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) usage();

  const targetDir = args.find((arg) => !arg.startsWith("--"));
  if (!targetDir) usage();

  const nameIndex = args.indexOf("--name");
  const name = nameIndex >= 0 ? args[nameIndex + 1] : undefined;

  const written = await scaffold({ targetDir, name, force: args.includes("--force") });

  console.log(`✓ ${written.length} файлів у ${targetDir}\n`);
  console.log("Далі:");
  console.log(`  cd ${targetDir}`);
  console.log("  cp .env.example .env      # і заповни пароль бази");
  console.log("  deno task startdb");
  console.log("  deno install              # ОБОВ'ЯЗКОВО до першої збірки: наповнює vendor/");
  console.log("  deno task sql:registry && deno task sql:assemble && deno task sql:publish");
  console.log("  deno task dev");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`❌ ${error instanceof Error ? error.message : error}`);
    Deno.exit(1);
  });
}
