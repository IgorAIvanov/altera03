// Згенерований `skills.generated.ts` не розійшовся зі `skills/src/**`.
//
// Та сама проба, що й у core-sql_test.ts, і потрібна вона тут з тієї ж причини:
// збірка пакета працює з мапою, а не з деревом, тож правка скіла без
// `deno task skills:build` поїхала б у застосунки старим текстом — мовчки.
//
// Заразом ловиться забуте `metadata.audience`: скіл без нього в пакет не їде
// (fail-closed у генераторі), і без проби це було б видно лише тому, хто читає
// рядок `⚠` у виводі збірки.
import { assertEquals } from "@std/assert";
import { join, relative, SEPARATOR } from "@std/path";
import { CHANGELOG, SKILL_FILES } from "./skills.generated.ts";

const SRC_DIR = join(import.meta.dirname!, "src");

/** Мусить збігатися з readAudience() у tools/generate-skills.ts. */
function audienceOf(text: string): string | null {
  const normalized = text.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) return null;
  const end = normalized.indexOf("\n---", 3);
  if (end < 0) return null;
  return normalized.slice(4, end).match(/^\s+audience:\s*(\S+)\s*$/m)?.[1] ?? null;
}

async function collect(dir: string, out: Map<string, string>) {
  for await (const entry of Deno.readDir(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory) {
      await collect(full, out);
    } else if (entry.isFile && entry.name !== ".DS_Store") {
      // Та сама нормалізація, що й у генераторі: інакше проба падала б на машині
      // з core.autocrlf=true після звичайного чекауту.
      out.set(
        relative(SRC_DIR, full).split(SEPARATOR).join("/"),
        (await Deno.readTextFile(full)).replaceAll("\r\n", "\n"),
      );
    }
  }
}

async function readAppSkillsFromDisk(): Promise<{ files: Map<string, string>; undeclared: string[] }> {
  const files = new Map<string, string>();
  const undeclared: string[] = [];

  for await (const entry of Deno.readDir(SRC_DIR)) {
    if (!entry.isDirectory) continue;

    let audience: string | null = null;
    try {
      audience = audienceOf(await Deno.readTextFile(join(SRC_DIR, entry.name, "SKILL.md")));
    } catch {
      // Каталог без SKILL.md — скілом не є.
    }

    // `bootstrap` не їде в пакет із тієї ж причини, що й `framework`, але з
    // іншим змістом: скіл про створення застосунку в самому застосунку марний.
    if (audience === "app") await collect(join(SRC_DIR, entry.name), files);
    else if (audience !== "framework" && audience !== "bootstrap") undeclared.push(entry.name);
  }

  return { files, undeclared };
}

Deno.test("skills.generated.ts збігається зі skills/src на диску", async (t) => {
  const { files: onDisk, undeclared } = await readAppSkillsFromDisk();

  await t.step("кожен скіл оголосив аудиторію", () => {
    assertEquals(
      undeclared,
      [],
      "скіл без metadata.audience у пакет не поїде — додай `audience: app`, `framework` або `bootstrap`",
    );
  });

  await t.step("склад файлів той самий", () => {
    assertEquals(
      Object.keys(SKILL_FILES).sort(),
      [...onDisk.keys()].sort(),
      "склад скілів змінився — виконай `deno task skills:build`",
    );
  });

  await t.step("текст кожного файлу той самий", () => {
    for (const [key, body] of onDisk) {
      assertEquals(
        SKILL_FILES[key],
        body,
        `${key} змінився після генерації — виконай \`deno task skills:build\``,
      );
    }
  });
});

Deno.test("CHANGELOG у пакеті збігається з CHANGELOG.md на диску", async () => {
  // Той самий довід, що вище: файл їде в застосунок ВБУДОВАНИМ, тож правка без
  // `deno task skills:build` дійшла б до прикладників старим текстом — і саме
  // там, де він розповідає, що зламалося при оновленні.
  const disk = (await Deno.readTextFile(join(import.meta.dirname!, "..", "CHANGELOG.md")))
    .replaceAll("\r\n", "\n");

  assertEquals(CHANGELOG, disk);
});
