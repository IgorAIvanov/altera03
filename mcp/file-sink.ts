/**
 * Куди лягає файл, забраний з бази.
 *
 * КАТАЛОГ НАЗИВАЄ ЛЮДИНА, А НЕ АГЕНТ. `ALTERA_DOWNLOAD_DIR` у конфізі хоста —
 * єдине джерело; аргумента «куди покласти» в інструментів немає. Причина
 * практична: дозвіл `--allow-write` видається один на процес, тож аргумент не
 * звужував би нічого, зате розкидав би файли по диску, а шукати їх потім
 * людині. Не задано — інструменти відмовляють і кажуть, що дописати; це рішення
 * власника машини, і вгадувати його за нього обгортка не буде.
 *
 * ІМ'Я ПРИХОДИТЬ ІЗ БАЗИ, ТОБТО ВІД ЛЮДИНИ. Його вводили у формі, і в ньому
 * буває будь-що — включно з `../`. Тому від імені лишається тільки базова
 * частина, а роздільники й службові символи гинуть: файл мусить лягти В
 * заданий каталог, а не поруч із ним.
 *
 * ФАЙЛИ НЕ ЗАТИРАЮТЬСЯ Й НЕ ПРИБИРАЮТЬСЯ. Збіг імен розводиться суфіксом
 * (`акт (2).pdf`) — «накладна.pdf» у базі не унікальна, а мовчазне затирання
 * попереднього вивантаження виглядало б як зникнення файлу. Прибирання старих
 * теж немає: каталог належить людині, і чистити чуже обгортка не має права.
 */

export interface SavedFile {
  /** Повний шлях — те, що обгортка віддає агенту замість байтів. */
  path: string;
  /** Ім'я, під яким файл справді ліг: могло змінитися через збіг. */
  name: string;
  size: number;
}

/** Роздільник беремо з самого каталогу — щоб шлях у відповіді читався звично. */
function separatorOf(dir: string): string {
  return dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
}

/**
 * Безпечне ім'я файлу: базова частина без роздільників і службових символів.
 *
 * Обмеження взяті за Windows (він найсуворіший): `\/:*?"<>|` заборонені, крапки
 * й пробіли в кінці імені він мовчки зрізає сам. Керівні символи прибираємо
 * скрізь — у Linux вони законні, але ім'я з `\n` не покажеш людині.
 */
export function safeFileName(name: string, fallback: string): string {
  const base = name.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const cleaned = base
    // deno-lint-ignore no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .trim();

  return cleaned || fallback;
}

function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    // Каталог є, але заглянути в нього не дають — це та сама розмова про
    // дозволи, що й нижче, і виводити з неї «файлу немає» не можна.
    throw error;
  }
}

/**
 * Записати файл у каталог вивантаження.
 *
 * Відмови ОС переказуються людською мовою з тієї ж причини, що й у читанні
 * файлу для `altera_attach`: `PermissionDenied` від Deno агент читає як «база
 * не працює» й починає лікувати не те. Тут різниця ще різкіша — дозвіл
 * `--allow-write` міняє тільки людина в конфізі хоста.
 */
export async function saveDownload(
  dir: string,
  name: string,
  bytes: Uint8Array,
  fallbackName: string,
): Promise<SavedFile> {
  const separator = separatorOf(dir);
  const safe = safeFileName(name, fallbackName);

  try {
    await Deno.mkdir(dir, { recursive: true });
  } catch (error) {
    throw describe(error, dir, `Не вдалося створити каталог ${dir}`);
  }

  try {
    const [stem, extension] = splitExtension(safe);
    let candidate = safe;
    for (let index = 2; await exists(`${dir}${separator}${candidate}`); index++) {
      candidate = `${stem} (${index})${extension}`;
    }

    const path = `${dir}${separator}${candidate}`;
    await Deno.writeFile(path, bytes);
    return { path, name: candidate, size: bytes.length };
  } catch (error) {
    throw describe(error, dir, `Не вдалося записати файл у ${dir}`);
  }
}

/**
 * Причина словами — і саме та, яку можна виправити.
 *
 * Відмов дві, і плутати їх не можна: `NotCapable` — це не виданий обгортці
 * `--allow-write` (виправляється в конфізі хоста), `PermissionDenied` — це вже
 * права самої ОС на каталог (виправляється в системі). Deno 2 розвів їх на
 * різні класи саме тому, що ліки різні.
 */
function describe(error: unknown, dir: string, prefix: string): Error {
  if (error instanceof Deno.errors.NotCapable) {
    return new Error(
      `Обгортці не дозволено писати на диск. Додай --allow-write=${dir} в args ` +
        `запису MCP-хоста й перезапусти його.`,
    );
  }
  if (error instanceof Deno.errors.PermissionDenied) {
    return new Error(`Операційна система не дає писати в ${dir}: перевір права на каталог.`);
  }
  return new Error(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
}
