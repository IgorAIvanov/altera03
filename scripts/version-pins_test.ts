// Піни версій не розійшлися з версіями самих пакетів.
//
// Версія фреймворку живе в `<пакет>/deno.json`, але повторюється ще десятьма
// пінами — у шаблоні scaffold, у `@altera/create` і в залежностях `@altera/tools`.
// Забутий пін не видно ніде: збірка зелена, типи зелені, а застосунок отримує
// стару версію з реєстру. Саме так у застосунок приїхав `tools@0.3.0` замість
// `0.3.3`, а з ним і чужий SQL ядра.
//
// Проба звіряє кожен пін із версією пакета, на який він указує, і окремо —
// npm-піни шаблону з кореневими: `vite`, `tailwindcss` і `daisyui` мусять бути
// ті самі, з якими зібрано `client`, інакше в застосунку опиняються два
// екземпляри збирача (див. коментар `//vite` у шаблоні).
import { assertEquals } from "jsr:@std/assert@^1.0.15";
import { parse as parseJsonc } from "jsr:@std/jsonc@^1";

const ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Пакети фреймворку — джерело істини для власних пінів. */
const PACKAGES = ["server", "client", "tools", "skills", "mcp"] as const;

/**
 * Файли, у яких піни повторюються (і в `imports`, і в рядках задач).
 *
 * Проба сканує їх ТЕКСТОМ, а не структурою, — саме тому сюди входять `Dockerfile`
 * і `docker-compose.yml`. Доти перевірялися лише `deno.json`, і піни в докерних
 * файлах тихо застрягли на `@altera/tools@^0.5.x` при поточних `0.11.x`: каретка
 * на `0.x` не пускає далі наступного мінора, тобто контейнерний `solution:update`
 * ішов інструментом піврічної давнини проти свіжого сервера. Це та сама
 * розбіжність версій, через яку вже був фікс-реліз, лише в місці, куди ніхто
 * не дивився.
 */
const PIN_FILES = [
  "create/template/deno.json",
  "create/deno.json",
  "create/template/Dockerfile",
  "create/template/docker-compose.yml",
  "tools/deno.json",
  // Запис MCP-сервера в конфізі хоста: обгортка береться з реєстру, тож пін
  // тут такий самий контракт, як у задачах шаблону.
  ".mcp.json",
];

async function readJsonc(path: string): Promise<Record<string, unknown>> {
  return parseJsonc(await Deno.readTextFile(`${ROOT}${path}`)) as Record<string, unknown>;
}

async function packageVersions(): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  for (const name of PACKAGES) {
    const manifest = await readJsonc(`${name}/deno.json`);
    versions.set(name, String(manifest.version));
  }
  return versions;
}

Deno.test("піни @altera/* збігаються з версіями пакетів", async () => {
  const versions = await packageVersions();
  const problems: string[] = [];

  for (const file of PIN_FILES) {
    const text = await Deno.readTextFile(`${ROOT}${file}`);
    const lines = text.split("\n");

    for (let index = 0; index < lines.length; index++) {
      for (const match of lines[index].matchAll(/@altera\/(server|client|tools|skills)@\^?(\d+\.\d+\.\d+)/g)) {
        const [, name, pinned] = match;
        const actual = versions.get(name)!;
        if (pinned !== actual) {
          problems.push(
            `${file}:${index + 1}  @altera/${name}@${pinned} — у пакеті ${actual}`,
          );
        }
      }
    }
  }

  assertEquals(
    problems,
    [],
    "пін розійшовся з версією пакета — підніми його разом із версією " +
      "(порядок публікації й правила — skill framework-release)",
  );
});

Deno.test("npm-піни шаблону збігаються з кореневими", async () => {
  const root = (await readJsonc("deno.json")).imports as Record<string, string>;
  const template = (await readJsonc("create/template/deno.json")).imports as Record<string, string>;

  const problems: string[] = [];
  for (const [key, specifier] of Object.entries(template)) {
    if (!specifier.startsWith("npm:")) continue;
    const rootSpecifier = root[key];
    // Ключа немає в корені — не помилка: у застосунку є свої залежності
    // (наприклад, шрифти), яких репозиторій фреймворку не тримає.
    if (rootSpecifier && rootSpecifier !== specifier) {
      problems.push(`${key}: шаблон ${specifier}, корінь ${rootSpecifier}`);
    }
  }

  assertEquals(
    problems,
    [],
    "npm-залежність шаблону розійшлася з тією, на якій зібрано client — " +
      "у застосунку буде два екземпляри збирача",
  );
});
