/**
 * Якір блока по вертикалі — те, з чого починається кожна розкладка бланка.
 *
 * `yPercent` означає ВЕРХ блока, і однаково для всіх типів: рамка з клітинок
 * висить під цією межею, текст стоїть під нею ж. Доти текст був винятком —
 * базова лінія лежала рівно на `y`, тобто літери стирчали НАД рамкою, — і два
 * блоки з ОДНАКОВОЮ `yPercent` опинялися по різні боки однієї координати.
 * Видно це було лише з паперу: підпис поруч із клітинками доводилось підганяти
 * на око, у кожному бланку заново.
 *
 * Тому проба міряє САМЕ КООРДИНАТИ готового PDF, а не план рендеру: розходження
 * жило нижче за план, у малюванні. Ціна — розбір стисненого потоку сторінки, і
 * вона свідома: іншого способу побачити те, що побачить друкар, немає.
 */
import { assert, assertAlmostEquals } from "@std/assert";
import { normalizePrintTemplateSchema } from "./print-template.ts";
import { renderPrintPdf } from "./print-pdf.renderer.ts";

const FONT_SIZE = 10;
/** Та сама частка кегля над базовою лінією, що й у рендерері. */
const ASCENT_RATIO = 0.75;

function place(xPercent: string, yPercent: string, widthPercent: string, heightPercent: string) {
  return { mode: "absolute", xPercent, yPercent, widthPercent, heightPercent };
}

function textOptions() {
  return { fontSize: String(FONT_SIZE), align: "left", fontWeight: "normal", color: "#000000" };
}

/** Перше входження зразка в байтах, починаючи з `from`. */
function indexOfBytes(haystack: Uint8Array, needle: string, from: number): number {
  const pattern = [...needle].map((character) => character.charCodeAt(0));

  outer: for (let start = from; start <= haystack.length - pattern.length; start += 1) {
    for (let offset = 0; offset < pattern.length; offset += 1) {
      if (haystack[start + offset] !== pattern[offset]) continue outer;
    }
    return start;
  }

  return -1;
}

/**
 * Потоки сторінки, розпаковані в текст операторів малювання.
 *
 * Шукається по БАЙТАХ, а не по декодованому рядку: `TextDecoder("latin1")` — це
 * за стандартом windows-1252, тобто байти 0x80–0x9F він перекладає в інші
 * кодові точки, і зворотної дороги в байт уже немає. Стиснений потік такого
 * перекладу не переживає, а виглядало б це як «жодного потоку не знайдено».
 */
async function contentStreams(pdfBytes: Uint8Array): Promise<string> {
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  for (let cursor = 0;;) {
    const marker = indexOfBytes(pdfBytes, "stream", cursor);
    if (marker < 0) break;
    cursor = marker + 6;

    // Слово «endstream» містить у собі «stream» — свій же кінець за початок не
    // беремо.
    if (indexOfBytes(pdfBytes, "endstream", marker - 3) === marker - 3) continue;

    const start = pdfBytes[cursor] === 0x0d ? cursor + 2 : cursor + 1;
    const end = indexOfBytes(pdfBytes, "endstream", start);
    if (end < 0) break;

    // Хвостовий перенос рядка НЕ належить даним: `DecompressionStream` падає
    // цілим потоком на зайвому байті, а не відкидає його.
    const tail = pdfBytes[end - 2] === 0x0d ? 2 : 1;
    const body = pdfBytes.slice(start, end - tail);

    try {
      const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream("deflate"));
      chunks.push(decoder.decode(await new Response(stream).arrayBuffer()));
    } catch {
      // Потік, стиснений інакше або не стиснений зовсім (шрифт), — не наша справа.
    }
  }

  return chunks.join("\n");
}

/** Базова лінія першого рядка тексту: матриця перед видачею рядка. */
function textBaseline(content: string): number {
  const match = content.match(/1 0 0 1 [\d.]+ ([\d.]+) Tm/);
  assert(match, "у потоці немає рядка тексту");
  return Number(match[1]);
}

/** Низ рамки клітинок: зсув системи координат перед контуром прямокутника. */
function cellsBottom(content: string): number {
  const match = content.match(/1 0 0 1 [\d.]+ ([\d.]+) cm/);
  assert(match, "у потоці немає рамки клітинок");
  return Number(match[1]);
}

/** Висота рамки клітинок: вертикальний бік її контуру. */
function cellsHeight(content: string): number {
  const match = content.match(/0 0 m\s+0 ([\d.]+) l/);
  assert(match, "у потоці немає контуру рамки");
  return Number(match[1]);
}

async function render(blocks: unknown[]): Promise<string> {
  const schema = normalizePrintTemplateSchema({ schemaVersion: 2, blocks });
  assert(schema, "шаблон не пройшов нормалізацію");

  const bytes = await renderPrintPdf({
    code: "probe",
    name: "проба",
    targetModel: "probe",
    dataCommand: "print",
    orientation: "portrait",
    schema,
  }, {});

  return await contentStreams(bytes);
}

function charCellsBlock(count: string, heightPercent: string) {
  return {
    key: "cells",
    type: "char-cells",
    value: "12",
    count,
    borderColor: "#000000",
    lineWidth: "1",
    placement: place("40", "20", "10", heightPercent),
    text: textOptions(),
  };
}

Deno.test("якір: текст і клітинки на одній yPercent стоять по один бік координати", async () => {
  const content = await render([
    {
      key: "caption",
      type: "text",
      value: "ABC",
      placement: place("5", "20", "20", "3"),
      text: textOptions(),
    },
    charCellsBlock("2", "3"),
  ]);

  // Верх рамки клітинок — це і є `yPercent`. Текст на тій самій `yPercent`
  // мусить стояти ПІД нею, відсунутий рівно на висоту літери.
  const frameTop = cellsBottom(content) + cellsHeight(content);
  assertAlmostEquals(textBaseline(content), frameTop - FONT_SIZE * ASCENT_RATIO, 0.01);
});

Deno.test("клітинка: порожня висота дає квадрат, а не смугу", async () => {
  // 10 % ширини області друку на дві клітинки: 515.28 / 10 / 2 = 25.764 pt.
  const content = await render([charCellsBlock("2", "0")]);
  assertAlmostEquals(cellsHeight(content), 25.764, 0.01);
});

Deno.test("клітинка: задана висота сильніша за квадрат", async () => {
  // 3 % висоти області друку (761.89 pt) — клітинка затвердженої форми буває
  // й видовженою, і сказане в шаблоні важить більше за умовчання.
  const content = await render([charCellsBlock("2", "3")]);
  assertAlmostEquals(cellsHeight(content), 22.857, 0.01);
});
