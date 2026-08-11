// Скіли фреймворку → `.claude/skills` застосунку.
//
//   deno run -A jsr:@altera/skills ./          (у застосунку — `deno task skills:sync`)
//
// Скіли описують ПУБЛІЧНУ поверхню пакетів (`ModelListBase`, контракт SQL-функції,
// $root, права команд), тож версіонуються разом з нею: оновив @altera/client —
// оновлюєш скіли тією ж дією. Тримати їх окремим репозиторієм означало б, що вони
// відстають від коду, який описують.
//
// Розкладені файли КОМІТЯТЬСЯ в застосунку — як згенерований CRUD-SQL: той, хто
// склонував репозиторій і ще нічого не запускав, має отримати робочі скіли. Тому в
// кожному лежить шапка «не редагувати»: правка на місці загубилася б при
// наступному оновленні, і мовчки.
import { CHANGELOG, SKILL_FILES, SKILLS_VERSION } from "./skills.generated.ts";

export { CHANGELOG, SKILL_FILES, SKILLS_VERSION };

/**
 * Куди лягає «що змінилося» — у КОРІНЬ застосунку, а не в `.claude/skills`.
 *
 * Скіли кажуть, як робити зараз; цей файл — що змінилося й що доведеться
 * поправити руками, і читає його людина, яка щойно оновила пакети. У теці
 * скілів вона його не побачить, а в корені він потрапляє і в дифф оновлення.
 */
const CHANGELOG_FILE = "FRAMEWORK-CHANGELOG.md";

/** За цим рядком sync упізнає СВОЇ файли — і лише їх прибирає. */
const MARK = "@altera/skills@";

const NOTICE = `<!-- ЗГЕНЕРОВАНО ${MARK}${SKILLS_VERSION} — не редагувати: ` +
  `правки загубляться при наступному \`deno task skills:sync\`. -->`;

/** Шапка ставиться ПІСЛЯ frontmatter: перед ним її не можна — блок мусить бути першим рядком. */
function withNotice(text: string): string {
  if (!text.startsWith("---\n")) return `${NOTICE}\n\n${text}`;

  const end = text.indexOf("\n---", 3);
  if (end < 0) return `${NOTICE}\n\n${text}`;

  const close = end + "\n---".length;
  return `${text.slice(0, close)}\n\n${NOTICE}${text.slice(close)}`;
}

/** Ім'я скіла — перший сегмент шляху в мапі. */
function skillName(key: string): string {
  return key.split("/")[0];
}

async function isOurs(dir: string): Promise<boolean> {
  try {
    return (await Deno.readTextFile(`${dir}/SKILL.md`)).includes(MARK);
  } catch {
    return false;
  }
}

export interface SyncResult {
  /** Шлях розкладеного «що змінилося» відносно targetDir. */
  changelog: string;
  /** Скіли, розкладені цим прогоном. */
  written: string[];
  /** Скіли попередніх версій, яких у пакеті вже немає, — прибрані. */
  removed: string[];
  /** Каталоги, зайняті чужим скілом з таким самим іменем, — не чіпали. */
  skipped: string[];
  targetDir: string;
}

/**
 * Розкласти скіли в `<targetDir>/.claude/skills`.
 *
 * Свої каталоги (з шапкою) переписуються цілком — інакше файл, прибраний у новій
 * версії скіла, лишався б назавжди. Чуже — скіл, написаний у застосунку руками, —
 * не чіпається взагалі й потрапляє у `skipped`.
 */
export async function syncSkills(
  options: { targetDir: string; verbose?: boolean },
): Promise<SyncResult> {
  const skillsDir = `${options.targetDir}/.claude/skills`;
  const incoming = new Set(Object.keys(SKILL_FILES).map(skillName));

  const written: string[] = [];
  const removed: string[] = [];
  const skipped: string[] = [];

  await Deno.mkdir(skillsDir, { recursive: true });

  // Прибирання — до запису: скіл, перейменований у новій версії, інакше лишився б
  // подвоєним, і агент отримав би два описи одного й того самого.
  for await (const entry of Deno.readDir(skillsDir)) {
    if (!entry.isDirectory) continue;
    const dir = `${skillsDir}/${entry.name}`;

    if (!await isOurs(dir)) {
      if (incoming.has(entry.name)) skipped.push(entry.name);
      continue;
    }

    await Deno.remove(dir, { recursive: true });
    if (!incoming.has(entry.name)) removed.push(entry.name);
  }

  for (const [key, body] of Object.entries(SKILL_FILES)) {
    const name = skillName(key);
    if (skipped.includes(name)) continue;

    const target = `${skillsDir}/${key}`;
    await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(target, key.endsWith(".md") ? withNotice(body) : body);

    if (!written.includes(name)) written.push(name);
  }

  await Deno.writeTextFile(`${options.targetDir}/${CHANGELOG_FILE}`, withNotice(CHANGELOG));

  if (options.verbose) {
    for (const name of written) console.log(`· ${name}`);
    for (const name of removed) console.log(`− ${name} (немає в цій версії)`);
    for (const name of skipped) console.log(`⚠ ${name}: свій скіл із таким іменем — не чіпав`);
  }

  return {
    written: written.sort(),
    removed: removed.sort(),
    skipped: skipped.sort(),
    changelog: CHANGELOG_FILE,
    targetDir: options.targetDir,
  };
}

async function main() {
  const verbose = !Deno.args.includes("--quiet");
  const targetDir = Deno.args.find((arg) => !arg.startsWith("--")) ?? ".";

  const result = await syncSkills({ targetDir, verbose });

  console.log(
    `✓ ${result.written.length} скілів → ${targetDir}/.claude/skills (@altera/skills@${SKILLS_VERSION})`,
  );
  console.log(`✓ що змінилося → ${targetDir}/${result.changelog} — прочитай перед роботою`);
  if (result.skipped.length) {
    console.log(
      `  ${result.skipped.length} пропущено: там свій скіл із тим самим іменем. ` +
        `Перейменуй його або видали, якщо хотів версію фреймворку.`,
    );
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`❌ ${error instanceof Error ? error.message : error}`);
    Deno.exit(1);
  });
}
