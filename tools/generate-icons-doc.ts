/**
 * Перелік гліфів `client/ui-kit/icons.ts` як файл скіла:
 * `deno run -A tools/generate-icons-doc.ts <icons.ts> <out.md>`.
 *
 * Навіщо. Прикладник пише екран у ВСТАНОВЛЕНОМУ застосунку, де фреймворк лежить
 * у `vendor/`, і взяти перелік іконок йому нізвідки — а `screen-design-rules`
 * вимагає ставити іконку на кожну кнопку тулбара й брати її саме зі спільного
 * набору. Тож перелік їде до нього разом зі скілом.
 *
 * Чому генерацією, а не рукописним списком у самому скілі: список — копія, а
 * копії тут розходяться мовчки (та сама причина, з якої `.claude/skills` —
 * симлінк, а не друга тека). Розходження гірше за відсутність: агент або
 * вигадає власний SVG для іконки, яка вже є, або пошлеться на `icons.foo`,
 * якої немає. Проба `tools/generate-icons-doc_test.ts` валить збірку на першому
 * розходженні — як `client/assets_test.ts` для теми.
 *
 * Чому не інструмент агента: у застосунку це означало б MCP-сервер, який треба
 * покласти, налаштувати й тримати запущеним заради одного списку; до того ж у
 * контекст на початку задачі приїжджає скіл, а щоб покликати інструмент, про
 * нього треба спершу знати.
 */

/** Один запис набору: ім'я, розділ і те, що гліф означає. */
export interface IconEntry {
  section: string;
  name: string;
  description: string;
}

const SECTION = /^\s*\/\/\s*──\s*(.+?)\s*─+\s*$/;
const ENTRY = /^ {2}([a-zA-Z][a-zA-Z0-9]*):/;

/**
 * Розбір набору. Свій, а не через TS-AST: файл — об'єктний літерал зі сталою
 * формою, а тягнути парсер заради трьох правил дорожче, ніж їх написати.
 *
 * Опис береться з коментаря НАД записом — саме він і потрібен читачеві: з імен
 * `save` / `data` / `clear` не видно, чи є в наборі потрібний гліф.
 */
export function parseIcons(source: string): IconEntry[] {
  const body = source.slice(source.indexOf("export const icons"));
  const entries: IconEntry[] = [];
  let section = "";
  let comment: string[] = [];
  let inBlock = false;

  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();

    const head = SECTION.exec(line);
    if (head) {
      section = head[1];
      comment = [];
      continue;
    }

    // Однорядковий `/** … */`, багаторядковий блок і звичайний `//` — усі три
    // форми в наборі вже вжиті.
    const oneLine = /^\s*\/\*\*\s*(.*?)\s*\*\/\s*$/.exec(line);
    if (oneLine) {
      comment = [oneLine[1]];
      continue;
    }
    const blockStart = /^\s*\/\*\*\s*(.*)$/.exec(line);
    if (blockStart) {
      inBlock = true;
      // Текст після `/**` у тому ж рядку — найчастіша форма в наборі
      // («/** Галочка — …» і далі продовження). Без цього перше речення, тобто
      // саме те, що йде в перелік, губилося б цілком.
      comment = blockStart[1].trim() ? [blockStart[1].trim()] : [];
      continue;
    }
    if (inBlock) {
      if (/\*\//.test(line)) inBlock = false;
      else {
        const text = line.replace(/^\s*\*\s?/, "").trim();
        if (text) comment.push(text);
      }
      continue;
    }
    if (/^\s*\/\//.test(line)) {
      comment.push(line.replace(/^\s*\/\/\s?/, "").trim());
      continue;
    }

    const entry = ENTRY.exec(line);
    if (entry) {
      // Лише ПЕРШЕ речення: далі в коментарях іде обґрунтування вибору
      // («не кругові, бо це refresh»), і воно потрібне тому, хто править набір,
      // а не тому, хто вибирає з нього іконку.
      const first = comment.length ? comment.join(" ").split(/(?<=[.!?])\s/)[0].trim() : "";
      entries.push({ section, name: entry[1], description: first });
      comment = [];
      continue;
    }

    // Порожній рядок відв'язує коментар від запису — інакше опис «прилипав» би
    // до наступного через абзац.
    if (line === "") comment = [];
  }

  return entries;
}

/** Файл скіла. Кадр англійською, описи — як у джерелі, без перекладу. */
export function buildIconsDoc(source: string): string {
  const entries = parseIcons(source);
  const sections = [...new Set(entries.map((e) => e.section))];

  const lines = [
    "<!-- ⚠ ЗГЕНЕРОВАНО `deno task skills:build` — НЕ РЕДАГУВАТИ.",
    "     Джерело: client/ui-kit/icons.ts -->",
    "",
    "# Icon set",
    "",
    "Every glyph the framework ships, by name. Import once and use by key:",
    "",
    "```ts",
    'import { icons } from "@client/ui-kit/icons.ts";',
    "…",
    "html`<button class=\"btn btn-sm\">${icons.print} ${t(\"common.print\")}</button>`",
    "```",
    "",
    "Do not hand-write an `<svg>` in a screen when the meaning is already here — a copy",
    "stops following the set, and the size token `--icon-size` no longer reaches it.",
    "Sizes come from the theme inside a control and from the glyph's own attributes",
    "outside one; never from Tailwind classes (they may not be generated in shadow DOM).",
    "",
    "Descriptions are quoted from the source as they are written there.",
    "",
  ];

  for (const section of sections) {
    lines.push(`## ${section}`, "", "| Key | Meaning |", "|---|---|");
    for (const entry of entries.filter((e) => e.section === section)) {
      lines.push(`| \`icons.${entry.name}\` | ${entry.description} |`);
    }
    lines.push("");
  }

  lines.push(
    "## Menu icons are a different set",
    "",
    "Navigation icons live in the application's own `app/menu/icons.ts` (Material Design,",
    "filled — a different family from the outlined glyphs above). The database stores only",
    "the key; an administrator picks them visually in the menu editor. Read that file when",
    "you need the keys for a seed.",
    "",
  );

  return lines.join("\n");
}

if (import.meta.main) {
  const [iconsPath, outPath] = Deno.args.filter((a) => !a.startsWith("--"));
  if (!iconsPath || !outPath) {
    console.error("Використання: generate-icons-doc.ts <icons.ts> <out.md>");
    Deno.exit(2);
  }

  const source = await Deno.readTextFile(iconsPath);
  const entries = parseIcons(source);

  // Fail-closed, як з аудиторією скіла: гліф без опису потрапляє в перелік
  // самим лише іменем, а з імені не видно, що він малює. Мовчазний пропуск
  // побачив би тільки той, хто читає вивід збірки.
  const undocumented = entries.filter((e) => !e.description);
  for (const entry of undocumented) {
    console.warn(`⚠ ${entry.name}: немає опису — додай коментар над записом у icons.ts`);
  }

  await Deno.writeTextFile(outPath, buildIconsDoc(source));
  console.log(`✓ ${entries.length} гліфів → ${outPath}`);
  if (undocumented.length) Deno.exit(1);
}
