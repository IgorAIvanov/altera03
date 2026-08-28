/**
 * Мініатюра зображення для агента.
 *
 * НАВІЩО ВОНА ПОТРІБНА, ЯКЩО ФАЙЛ УЖЕ НА ДИСКУ. Шлях відповідає на питання «де
 * файл», але не на питання «що це». Агент, який щойно забрав три вкладення
 * накладної, без прев'ю не відрізнить скан акта від фотографії пломби — він
 * бачить лише імена, а імена в базі бувають `IMG_20240517.jpg`. Мініатюра
 * коштує ~10 КБ у контексті й закриває саме цей розрив.
 *
 * ЧОМУ САМЕ МІНІАТЮРА, А НЕ САМ ФАЙЛ. Скан А4 у 300 dpi — це 700 КБ, тобто
 * майже мегабайт base64 у розмові, за який платять щоразу, коли до неї
 * повертаються. Ужате до 512 px те саме зображення важить 8–12 КБ і впізнається
 * так само добре: питання «це накладна чи пломба» вирішується на мініатюрі.
 *
 * ЧОМУ ЛИШЕ ЗОБРАЖЕННЯ. PDF довелося б рендерити, тобто тягти в обгортку
 * рендерер — а він уже є в сервері (`server/modules/print`) і працює в іншому
 * напрямку. Обгортка малювати не вміє й не мусить: для PDF відповідь — шлях,
 * ім'я та розмір, і цього досить.
 *
 * ЗАЛЕЖНІСТЬ ВАНТАЖИТЬСЯ НА ВИМОГУ. `jimp` — чистий JS без нативних частин, але
 * важить помітно; статичним імпортом за нього платив би кожен запуск обгортки,
 * включно з тими, де жодної картинки не буде. Тому `import()` усередині функції,
 * і невдача завантаження — не помилка інструмента: файл на диску, шлях віддано,
 * прев'ю просто немає.
 */

/** Найбільша сторона мініатюри. 512 — межа, за якою впізнаваність не росте. */
const MAX_SIDE = 512;

/**
 * Запасний, менший розмір — для того, що не вкладається в межу нижче.
 *
 * Знімок екрана з дрібним текстом стискається погано: там, де скан документа
 * дає 8 КБ, він дає 50. Другий підхід меншим боком тримає обіцянку «мініатюра
 * коштує десятки кілобайтів», а не сотні.
 */
const FALLBACK_SIDE = 320;

/** Стеля мініатюри в байтах JPEG. Перевищив — переробляємо меншим боком. */
const MAX_PREVIEW_BYTES = 120_000;

/** Типи, які вміє прочитати jimp. WebP серед них немає — це не наш недогляд. */
const PREVIEWABLE = new Set([
  "image/png",
  "image/jpeg",
  "image/bmp",
  "image/tiff",
  "image/gif",
]);

export interface ImagePreview {
  /** base64 JPEG — те, що йде в MCP-блок `image`. */
  data: string;
  mimeType: string;
}

export function isPreviewable(mime: string): boolean {
  return PREVIEWABLE.has(mime.toLowerCase().split(";")[0].trim());
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/**
 * Мініатюра або `null`, якщо зробити її не вдалося.
 *
 * `null` тут — робочий стан, а не збій: тип не той, файл битий, бібліотека не
 * завантажилася. Валити виклик через прев'ю було б підміною мети — по файл
 * прийшли, файл уже лежить на диску.
 */
export async function imagePreview(
  bytes: Uint8Array,
  mime: string,
): Promise<ImagePreview | null> {
  if (!isPreviewable(mime)) return null;

  try {
    const { Jimp } = await import("jimp");
    const image = await Jimp.fromBuffer(bytes.slice().buffer as ArrayBuffer);

    // `scaleToFit` вписує в квадрат, зберігаючи пропорції: у сканів вони
    // далекі від квадрата, і жорсткий розмір перетворив би сторінку А4 на
    // нечитабельну смугу.
    image.scaleToFit({ w: MAX_SIDE, h: MAX_SIDE });

    let jpeg = new Uint8Array(await image.getBuffer("image/jpeg", { quality: 70 }));
    if (jpeg.length > MAX_PREVIEW_BYTES) {
      image.scaleToFit({ w: FALLBACK_SIDE, h: FALLBACK_SIDE });
      jpeg = new Uint8Array(await image.getBuffer("image/jpeg", { quality: 60 }));
    }

    return { data: toBase64(jpeg), mimeType: "image/jpeg" };
  } catch (error) {
    // У stderr, не в stdout: там протокол. І не мовчки — коли прев'ю немає
    // раз за разом, причина має бути видима хоч десь.
    console.error(
      `[altera] мініатюру не зроблено: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
