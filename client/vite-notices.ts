// Нотиси на сторонні компоненти у продуктивній збірці фронтенду.
//
// Причина проста і не юридична за походженням: `dist/` — це не наш код. Туди
// фізично лягають lit і @lit-labs/signals (BSD-3-Clause, а вона вимагає
// відтворити copyright «in the documentation and/or other materials provided
// with the distribution»), signal-polyfill (Apache-2.0), файли гарнітур під
// OFL-1.1 і десяток пакетів під MIT. Кожна з цих ліцензій дозволяє все, що ми
// робимо, і кожна просить рівно одного — щоб її текст ішов разом із байтами.
//
// Робити це списком у документації не можна: список — це знімок дня, коли його
// написали. Тому перелік ВИВОДИТЬСЯ з того, що бандлер справді поклав у вихід,
// і робиться це на кожній збірці. Доданий пакет потрапляє в нотиси тим, що
// потрапив у бандл, — окремої дії для цього не існує, а отже й забути її ніде.
//
// Джерел два, і друге не зайве. Модулі видно в графі чанків; ШРИФТИ — ні:
// `app/styles/tailwind.css` тягне `@fontsource/roboto` директивою `@import`,
// яку Tailwind розгортає всередині CSS, тож у графі JS цього пакета немає
// взагалі, а `woff2` у `dist/` є. Тому CSS застосунку читається окремо.
//
// Межа охоплення названа свідомо: сюди входить те, що ЇДЕ в браузер, і не
// входить збіркова машинерія (vite, rollup, плагіни) — вона в дистрибутив не
// потрапляє й атрибуції не вимагає. Tailwind і daisyUI — межовий випадок
// (їхній вихід у `dist/` є, самі вони туди не їдуть), і вони перелічені:
// згенерований CSS — похідна робота від їхнього, а назвати зайве дешевше, ніж
// промовчати про потрібне.
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import type { Plugin } from "npm:vite@^8.2.0";
import { collectCssFiles } from "./vite-fs.ts";

const NOTICES_FILE = "THIRD-PARTY-NOTICES.md";

/**
 * Файли пакета, які треба відтворити: сама ліцензія і NOTICE.
 *
 * Взірцем, а не переліком імен: `LICENSE`, `LICENSE.md`, `LICENSE.txt`,
 * `LICENCE.md` (британське написання — саме так у decimal.js), `COPYING` —
 * домовленості тут немає, і будь-який закритий перелік рано чи пізно промахне
 * повз пакет, мовчки лишивши в нотисах голий рядок «MIT». NOTICE окремо, бо
 * Apache-2.0 вимагає відтворити і його — якщо він у пакеті є.
 */
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-.].*)?$/i;

/**
 * `@import "@fontsource/roboto/400.css"` і `@plugin "daisyui"` — беремо ім'я.
 *
 * `@plugin` тут не для повноти: daisyUI приходить саме ним, і без цієї гілки
 * пакет, чий CSS лежить у `dist/` цілком, у переліку не з'явився б узагалі.
 */
const CSS_DEPENDENCY = /@(?:import|plugin)\s+["']([^"']+)["']/g;

interface PackageNotice {
  readonly name: string;
  readonly version: string;
  readonly spdx: string;
  /** Текст ліцензії; порожній рядок — файлу в пакеті немає. */
  readonly text: string;
}

/**
 * Ім'я пакета зі шляху до його файлу.
 *
 * Береться ОСТАННЄ входження `node_modules`, а не перше: у вкладених установках
 * (`a/node_modules/b/node_modules/c`) перше назвало б `b` — тобто чужий пакет,
 * чия ліцензія до справи не стосується.
 */
function packageFromPath(id: string): string | undefined {
  const parts = id.replaceAll("\\", "/").split("/node_modules/");
  if (parts.length < 2) return undefined;

  const [scope, name] = parts[parts.length - 1]!.split("/");
  if (!scope) return undefined;

  return scope.startsWith("@") ? (name ? `${scope}/${name}` : undefined) : scope;
}

/** Ім'я пакета з голого специфікатора: `@fontsource/roboto/400.css` → `@fontsource/roboto`. */
function packageFromSpecifier(specifier: string): string | undefined {
  // Відносні шляхи, URL і аліаси фреймворку пакетами не є.
  if (/^[./]|^https?:|^@(app|client|shared)\b/.test(specifier)) return undefined;

  const [scope, name] = specifier.split("/");
  if (!scope) return undefined;

  return scope.startsWith("@") ? (name ? `${scope}/${name}` : undefined) : scope;
}

/**
 * Каталог установленого пакета.
 *
 * Шукається вгору від стартового каталогу, бо `node_modules` може лежати як у
 * корені застосунку, так і вище (робочі простори).
 */
function packageDir(name: string, from: string): string | undefined {
  let dir = from;

  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;

    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function readNotice(name: string, from: string): Promise<PackageNotice | undefined> {
  const dir = packageDir(name, from);
  if (!dir) return undefined;

  const meta = JSON.parse(await readFile(join(dir, "package.json"), "utf-8")) as {
    version?: string;
    license?: string;
    private?: boolean;
  };

  // Приватні пакети — це сам застосунок або його робочий простір, не стороннє.
  if (meta.private) return undefined;

  const files = (await readdir(dir)).filter((file) => LICENSE_FILE.test(file)).sort();

  const parts: string[] = [];
  for (const file of files) {
    const content = (await readFile(join(dir, file), "utf-8")).replaceAll("\r\n", "\n").trim();
    // Ім'я файлу лишається видимим: LICENSE і NOTICE — різні документи з різними
    // вимогами, і склеєні без підпису вони читаються як один суцільний текст.
    if (content) parts.push(files.length > 1 ? `--- ${file} ---\n\n${content}` : content);
  }

  return {
    name,
    version: meta.version ?? "?",
    spdx: meta.license ?? "не вказана",
    text: parts.join("\n\n"),
  };
}

/**
 * Складає документ.
 *
 * Однаковий текст ліцензії друкується ОДИН раз на групу пакетів: MIT з тим
 * самим copyright у трьох пакетах — це один текст, а не три, і три копії
 * поспіль ховали б власне перелік, заради якого файл і існує.
 */
function renderNotices(notices: PackageNotice[]): string {
  const groups = new Map<string, { spdx: string; names: string[] }>();

  for (const notice of [...notices].sort((a, b) => a.name.localeCompare(b.name))) {
    const key = `${notice.spdx}\n${notice.text}`;
    const group = groups.get(key) ?? { spdx: notice.spdx, names: [] };
    group.names.push(`- \`${notice.name}\` ${notice.version}`);
    groups.set(key, group);
  }

  const sections = [...groups].map(([key, group]) => {
    const text = key.slice(group.spdx.length + 1);
    const body = text
      ? `\`\`\`\n${text}\n\`\`\``
      : "_Файла ліцензії в пакеті немає; ліцензія вказана лише в його `package.json`._";

    return `## ${group.spdx}\n\n${group.names.join("\n")}\n\n${body}`;
  });

  return [
    "# Сторонні компоненти",
    "",
    "<!-- Генерується на кожній збірці фронтенду. Правити тут нічого: -->",
    "<!-- перелік виводиться з того, що бандлер поклав у dist/. -->",
    "",
    "Ці компоненти входять до складу зібраного застосунку — їхній код і дані",
    "лежать у файлах поруч із цим переліком. Нижче — їхні ліцензії, згруповані",
    "за текстом.",
    "",
    "Збіркові інструменти (bundler, транспілятор, плагіни) сюди не входять: у",
    "дистрибутив вони не потрапляють.",
    "",
    sections.join("\n\n"),
    "",
  ].join("\n");
}

/**
 * Плагін, який кладе `THIRD-PARTY-NOTICES.md` поруч із бандлом.
 *
 * @param appRoot корінь застосунку — звідти читається CSS і починається пошук
 *                `node_modules`.
 */
export function noticesPlugin(appRoot: string): Plugin {
  return {
    name: "vite-plugin-altera-notices",
    // Лише продуктивна збірка: у деві нічого не розповсюджується.
    apply: "build",

    async generateBundle(_options, bundle) {
      const names = new Set<string>();

      // 1. Модулі, що справді потрапили в чанки.
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const id of Object.keys(chunk.modules ?? {})) {
          const name = packageFromPath(id);
          if (name) names.add(name);
        }
      }

      // 2. Пакети, які CSS застосунку тягне `@import`-ом: гарнітури приходять
      //    саме так і в графі модулів не з'являються взагалі.
      for (const file of await collectCssFiles(appRoot)) {
        const css = await readFile(file, "utf-8");
        for (const match of css.matchAll(CSS_DEPENDENCY)) {
          const name = packageFromSpecifier(match[1]!);
          if (name) names.add(name);
        }
      }

      const notices: PackageNotice[] = [];
      for (const name of names) {
        const notice = await readNotice(name, appRoot);
        if (!notice) continue;

        // Пакет без тексту ліцензії — не привід валити збірку (виправити його
        // ми не можемо), але й мовчати не можна: зобов'язання лишається, просто
        // виконати його доведеться руками.
        if (!notice.text) {
          this.warn(
            `${notice.name} ${notice.version}: файла ліцензії в пакеті немає, ` +
              `у нотисах лишиться лише «${notice.spdx}»`,
          );
        }

        notices.push(notice);
      }

      this.emitFile({
        type: "asset",
        fileName: NOTICES_FILE,
        source: renderNotices(notices),
      });

      console.log(`[notices] ${notices.length} сторонніх компонентів → dist/${NOTICES_FILE}`);
    },
  };
}
