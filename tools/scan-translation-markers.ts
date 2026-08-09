// Пошук маркерів перекладу `@[ключ]` у джерелах, які виконує СЕРВЕР.
//
// Навіщо. Сервер тексту не перекладає — він його називає (`@[core.documentNotFound]`),
// а розгортає клієнт. Ціна домовленості одна: названий ключ, якого немає в
// локалях, доїжджає до екрана як `core.documentNotFound` — гірше, ніж
// неперекладений текст, бо це вже не мова, а внутрішнє ім'я. Побачити це можна
// лише відтворивши саме ту відмову, тобто найпізніше з можливого.
//
// Тому ключі звіряються пробою. Розбір навмисно текстовий: SQL тут не
// виконується й не парситься — маркер має ту саму форму в `raise exception`, у
// `jsonb_build_object`, у сіді меню та в TS-команді, і регулярка бачить усі
// чотири однаково.
import { join, relative, SEPARATOR } from "@std/path";

/** Маркер у джерелі: ключ і де його знайшли. */
export interface MarkerUse {
  key: string;
  /** Шлях відносно кореня сканування, завжди через `/`. */
  file: string;
  line: number;
}

/**
 * Ключ маркера — до першої `]`. Хвіст-JSON тут не розбирається: проба питає
 * «чи є такий ключ», а не «чи ті параметри». Параметри перевіряє той, хто
 * пише повідомлення, — підстановка, для якої немає значення, лишається
 * видимою в тексті (`{line}`), тобто мовчазною бути не може.
 */
const MARKER = /@\[([^\]\s]+)\]/g;

const SKIP_DIRS = new Set(["node_modules", "dist", ".vite", "_sqlpackage", "_generated", "vendor"]);

/** Розширення, у яких маркер має сенс: SQL моделей і TS-команди. */
const SCANNED = [".sql", ".ts"];

/**
 * Прибрати коментарі, лишивши позиції рядків недоторканими.
 *
 * Без цього проба ловить власну документацію: і в SQL, і в TS форма маркера
 * описана словами, і `@[ключ]` у поясненні не відрізнити від ужитку. Виходило
 * найгірше з можливого — проба, яка падає на тексті, що нічого не ламає, і яку
 * тому починають обходити.
 *
 * Розбір грубий і цього досить: маркер живе в рядковому літералі й ніколи не
 * містить ані `--`, ані `//`. Рядки не порожняться, а замінюються пробілами —
 * номер рядка в повідомленні має вказувати на справжнє місце.
 */
export function stripComments(text: string, sql: boolean): string {
  const lineComment = sql ? "--" : "//";
  let inBlock = false;

  return text.split("\n").map((line) => {
    let out = line;

    if (inBlock) {
      const end = out.indexOf("*/");
      if (end < 0) return "";
      out = " ".repeat(end + 2) + out.slice(end + 2);
      inBlock = false;
    }

    // Блоковий коментар у SQL теж буває, тож правило спільне.
    const blockStart = out.indexOf("/*");
    if (blockStart >= 0 && out.indexOf("*/", blockStart) < 0) {
      inBlock = true;
      out = out.slice(0, blockStart);
    }

    const at = out.indexOf(lineComment);
    return at >= 0 ? out.slice(0, at) : out;
  }).join("\n");
}

export function findMarkers(text: string, file: string): MarkerUse[] {
  const uses: MarkerUse[] = [];
  stripComments(text, file.endsWith(".sql")).split("\n").forEach((line, index) => {
    for (const match of line.matchAll(MARKER)) {
      uses.push({ key: match[1], file, line: index + 1 });
    }
  });
  return uses;
}

export async function scanMarkers(root: string): Promise<MarkerUse[]> {
  const uses: MarkerUse[] = [];

  async function walk(dir: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(path);
        continue;
      }
      if (!SCANNED.some((ext) => entry.name.endsWith(ext))) continue;
      // Проби й сам сканер маркерами не оперують — вони їх ЦИТУЮТЬ, і кожна
      // цитата виглядала б як ужиток неіснуючого ключа.
      if (entry.name.endsWith("_test.ts") || entry.name === "scan-translation-markers.ts") continue;

      const text = await Deno.readTextFile(path);
      if (!text.includes("@[")) continue;
      uses.push(...findMarkers(text, relative(root, path).replaceAll(SEPARATOR, "/")));
    }
  }

  await walk(root);
  return uses;
}

/** Ключі, яких немає в жодному зі словників. */
export function missingKeys(uses: MarkerUse[], known: Set<string>): MarkerUse[] {
  return uses.filter((use) => !known.has(use.key));
}

if (import.meta.main) {
  const root = Deno.args.find((arg) => !arg.startsWith("--"));
  if (!root) throw new Error("Вкажи каталог: scan-translation-markers <dir>");

  const uses = await scanMarkers(root);
  for (const use of uses) console.log(`${use.file}:${use.line}  @[${use.key}]`);
  console.log(`\n${uses.length} ужитк(ів), ${new Set(uses.map((u) => u.key)).size} унікальних ключів`);
}
