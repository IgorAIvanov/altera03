// Вбудовування прикладних скілів у TS-модуль.
//
// Причина та сама, що й у generate-scaffold-template.ts: `@altera/skills`
// ставиться як пакет, а пакет може віддати лише модулі — довільних файлів JSR не
// роздає. Тому джерело лишається деревом справжніх файлів (`skills/src/**`, на
// нього ж дивиться `.claude/skills` цього репозиторію), а в пакет їде мапа
// «шлях → текст».
//
// Що саме їде, вирішує сам скіл — `metadata.audience` у frontmatter:
//
//   audience: app         — про написання застосунку на фреймворку → у пакет;
//   audience: framework   — про внутрішнє життя цього репозиторію → лишається тут;
//   audience: bootstrap   — про створення застосунку з нуля → лишається тут, але
//                           з іншої причини: у згенерованому застосунку такий
//                           скіл марний (застосунок уже є), а потрібен він у
//                           порожній теці, куди його кладуть окремо, до scaffold.
//
// Умовчання fail-closed: скіл без оголошення НЕ їде і друкується рядком `⚠`.
// Навпаки було б гірше — чужий або внутрішній скіл поїхав би в чужі застосунки
// мовчки, і побачили б це вже після публікації.
import { join, relative, SEPARATOR } from "@std/path";

const HEADER = `// ЗГЕНЕРОВАНО \`deno task skills:build\` зі skills/src/** — не редагувати.
//
// Їдуть лише скіли з \`metadata.audience: app\`. Чому вбудовані, а не читаються з
// диска — у tools/generate-skills.ts.
`;

/** Файли, які в пакеті не потрібні. */
const IGNORED = new Set([".DS_Store"]);

/** `metadata.audience` з frontmatter; null — блоку немає або поле не оголошене. */
export function readAudience(text: string): string | null {
  const normalized = text.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) return null;

  const end = normalized.indexOf("\n---", 3);
  if (end < 0) return null;

  return normalized.slice(4, end).match(/^\s+audience:\s*(\S+)\s*$/m)?.[1] ?? null;
}

async function collect(dir: string, root: string, out: Map<string, string>) {
  for await (const entry of Deno.readDir(dir)) {
    const full = join(dir, entry.name);

    if (entry.isDirectory) {
      await collect(full, root, out);
      continue;
    }

    if (!entry.isFile || IGNORED.has(entry.name)) continue;

    const key = relative(root, full).split(SEPARATOR).join("/");
    // LF — щоб артефакт не залежав від core.autocrlf (див. generate-core-sql.ts).
    out.set(key, (await Deno.readTextFile(full)).replaceAll("\r\n", "\n"));
  }
}

export interface SkillsBuildResult {
  /** Імена скілів, що поїхали в пакет. */
  shipped: string[];
  /** Імена скілів із `audience: framework` або `bootstrap` — лишаються тут. */
  kept: string[];
  /** Імена скілів без оголошеної аудиторії — не поїхали. */
  undeclared: string[];
  files: number;
}

export async function generateSkills(
  options: {
    srcDir: string;
    outFile: string;
    version: string;
    /**
     * Файл «що змінилося», який їде в застосунок разом зі скілами.
     *
     * Скіли кажуть, ЯК робити зараз, і не кажуть, що змінилося й що доведеться
     * поправити руками. Без цього каналу таке знання лишалося б у цьому
     * репозиторії — у CLAUDE.md і docs/, куди прикладник не дивиться взагалі.
     */
    changelogFile: string;
    verbose?: boolean;
  },
): Promise<SkillsBuildResult> {
  const shipped: string[] = [];
  const kept: string[] = [];
  const undeclared: string[] = [];
  const files = new Map<string, string>();

  const names: string[] = [];
  for await (const entry of Deno.readDir(options.srcDir)) {
    if (entry.isDirectory) names.push(entry.name);
  }
  names.sort();

  for (const name of names) {
    const skillFile = join(options.srcDir, name, "SKILL.md");
    let text: string;
    try {
      text = await Deno.readTextFile(skillFile);
    } catch {
      undeclared.push(name);
      continue;
    }

    const audience = readAudience(text);
    if (audience === "app") {
      shipped.push(name);
      await collect(join(options.srcDir, name), options.srcDir, files);
    } else if (audience === "framework" || audience === "bootstrap") {
      kept.push(`${name} (${audience})`);
    } else {
      undeclared.push(name);
    }
  }

  const keys = [...files.keys()].sort();
  const entries = keys.map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(files.get(key))},`);

  // LF — з тієї ж причини, що й у скілах: артефакт не має залежати від autocrlf.
  const changelog = (await Deno.readTextFile(options.changelogFile)).replaceAll("\r\n", "\n");

  await Deno.writeTextFile(
    options.outFile,
    `${HEADER}\nexport const SKILLS_VERSION = ${JSON.stringify(options.version)};\n\n` +
      `export const SKILL_FILES: Record<string, string> = {\n${entries.join("\n")}\n};\n\n` +
      `export const CHANGELOG: string = ${JSON.stringify(changelog)};\n`,
  );

  if (options.verbose) {
    for (const name of shipped) console.log(`· ${name}`);
    for (const name of kept) console.log(`— ${name} — лишається в репозиторії`);
  }

  return { shipped, kept, undeclared, files: keys.length };
}

async function main() {
  const verbose = Deno.args.includes("--verbose");
  const [srcDir, outFile, changelogFile] = Deno.args.filter((arg) => !arg.startsWith("--"));

  if (!srcDir || !outFile || !changelogFile) {
    throw new Error("Вжиток: generate-skills <srcDir> <outFile> <changelogFile> [--verbose]");
  }

  const manifestPath = join(outFile, "..", "deno.json");
  const version = JSON.parse(await Deno.readTextFile(manifestPath)).version as string;

  const result = await generateSkills({ srcDir, outFile, version, changelogFile, verbose });

  for (const name of result.undeclared) {
    console.warn(
      `⚠ ${name}: не оголошено metadata.audience — скіл НЕ поїде в @altera/skills. ` +
        `Додай у frontmatter "metadata: { audience: app }" (про написання застосунку), ` +
        `"framework" (про внутрішнє життя репозиторію) або "bootstrap" (про створення ` +
        `застосунку з нуля).`,
    );
  }

  console.log(
    `✓ ${result.shipped.length} скілів (${result.files} файлів) → ${outFile}` +
      (result.kept.length ? `; лишилися тут: ${result.kept.join(", ")}` : ""),
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("❌ Збірка скілів впала:", error);
    Deno.exit(1);
  });
}
