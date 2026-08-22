/**
 * Ширини колонок таблиці бланка: колонка оголошує НАМІР, а число рахує ядро.
 *
 * ЧОМУ ЦЕ ТУТ, А НЕ В ЗАСТОСУНКУ. Щоб проставити відсотки руками, застосунок
 * мусив проробити роботу рендерера: зміряти найдовше слово кожного значення,
 * рознести підписи шапки по РЕАЛЬНИХ колонках (ділячи об'єднані комірки на їх
 * `colSpan`), повторити перенос по словах, щоб дізнатися висоту шапки, і
 * роздати лишок тим колонкам, які цю висоту тримають. На бланку з дев'ятнадцяти
 * колонок сума «потрібного» склала 970.5 pt при аркуші 761.9 — і без
 * перерозподілу шапка розганялася на 11 рядків замість 6. Тобто місця вистачало
 * з самого початку, бракувало РОЗПОДІЛУ.
 *
 * Цей код не про бухгалтерію — він про те, як ядро переносить текст. Кожен
 * застосунок написав би його заново і по-своєму, а числа в шаблонах застарівали
 * б від першої зміни складу колонок.
 *
 * ЩО ОГОЛОШУЄ КОЛОНКА:
 *   `fit`      — рівно стільки, щоб значення не переносилося (числа, коди);
 *   `auto`     — забирає лишок (опис товару, назва);
 *   `12%`      — фіксована частка ширини блока, як було завжди.
 *
 * РІВНО ТРИ КРОКИ, і кожен наступний працює з тим, що лишив попередній:
 *
 *   1. відсотки забирають свою частку;
 *   2. якщо решті вистачає на «не переноситися» — кожен дістає рівно стільки,
 *      а лишок іде колонкам `auto`;
 *   3. якщо не вистачає — кожен дістає свій мінімум (найдовше СЛОВО), а
 *      надлишок роздається за правилом висоти (нижче).
 *
 * ПРАВИЛО ВИСОТИ прислали прикладники, і воно взяте як є: крок ширини йде тій
 * колонці, чия висота ЗАРАЗ найбільша. Вибір без перебору тут не примха —
 * пошук «кому вигідніше дати» коштував би на кожному кроці обходу всіх колонок
 * по всіх рядках, а таблиця на 500 записів це тисячі комірок.
 *
 * РЯДКИ РАХУЮТЬСЯ АРИФМЕТИКОЮ по заздалегідь зміряних словах, а не повторним
 * викликом переносу: інакше роздача коштувала б сотень тисяч звернень до
 * шрифту. Це не наближення — ширина рядка в pdf-lib є сумою ширин його частин
 * (кернінг не застосовується), тож підрахунок збігається з тим, що зробить
 * справжній перенос. Єдине місце, де він оцінює, — слово, ширше за комірку:
 * скільки шматків із нього вийде, тут вважається діленням. Малює все одно
 * `wrapPrintText`, тобто на папір іде справжній перенос, а не цей рахунок.
 */
import { type PrintTextMeasurer } from "./print-text-metrics.ts";

/** Намір колонки: чим вона хоче бути, а не скільки в ній пунктів. */
export type PrintColumnSizing =
  | { kind: "percent"; percent: number }
  | { kind: "fit" }
  | { kind: "auto" };

export interface PrintColumnSizingInput {
  sizing: PrintColumnSizing;
  /** Нижня межа в пунктах (`minPt` колонки); 0 — немає. */
  minPt: number;
}

/** Комірка, вже розставлена по сітці: рахівникові потрібні лише ці поля. */
export interface PrintSizedCell {
  columnIndex: number;
  colSpan: number;
  value: string;
  fontSize: number;
  bold: boolean;
  /**
   * Повернутий текст росте ВГОРУ: ширини йому треба на один рядок, а висоту
   * задає довжина напису. Тому він ставить нижню межу ширини й не бере участі в
   * правилі висоти — розширення такої колонки її висоти не змінює.
   */
  rotated: boolean;
}

export interface PrintColumnWidthOptions {
  measure: PrintTextMeasurer;
  /** Внутрішній відступ комірки з кожного боку. */
  cellPadding: number;
  /** Висота одного рядка тексту — нею вимірюється «висота колонки». */
  lineStep: (fontSize: number) => number;
}

/** Скільки кроків роздачі робимо щонайбільше — запобіжник, а не налаштування. */
const MAX_STEPS = 4000;

/** Найвужча колонка, яку взагалі має сенс малювати. */
const MIN_COLUMN_WIDTH = 8;

interface CellModel {
  columnIndex: number;
  colSpan: number;
  /** Слова по абзацах (явний `\n` розриває абзац): ширини в пунктах. */
  paragraphs: number[][];
  spaceWidth: number;
  lineStep: number;
  /** Ширина без жодного переносу разом із відступами. */
  natural: number;
  /** Ширина найдовшого слова разом із відступами. */
  min: number;
  rotated: boolean;
}

function buildCellModel(cell: PrintSizedCell, options: PrintColumnWidthOptions): CellModel {
  const pad = options.cellPadding * 2;
  const lineStep = options.lineStep(cell.fontSize);

  if (cell.rotated) {
    // Один рядок тексту завширшки — більше повернутій комірці й не треба.
    const width = cell.fontSize + pad;
    return {
      columnIndex: cell.columnIndex,
      colSpan: cell.colSpan,
      paragraphs: [],
      spaceWidth: 0,
      lineStep,
      natural: width,
      min: width,
      rotated: true,
    };
  }

  const spaceWidth = options.measure(" ", cell.fontSize, cell.bold);
  const paragraphs: number[][] = [];
  let natural = 0;
  let longestWord = 0;

  for (const paragraph of String(cell.value ?? "").split(/\r?\n/)) {
    const words = paragraph.split(/[ \t]+/).filter(Boolean);
    const widths = words.map((word) => options.measure(word, cell.fontSize, cell.bold));
    paragraphs.push(widths);

    // Абзац без переносу: слова плюс пробіли між ними.
    const line = widths.reduce((sum, width) => sum + width, 0) +
      Math.max(widths.length - 1, 0) * spaceWidth;
    natural = Math.max(natural, line);
    for (const width of widths) longestWord = Math.max(longestWord, width);
  }

  return {
    columnIndex: cell.columnIndex,
    colSpan: cell.colSpan,
    paragraphs,
    spaceWidth,
    lineStep,
    natural: natural + pad,
    min: longestWord + pad,
    rotated: false,
  };
}

/**
 * Скільки рядків займе комірка при цій ширині.
 *
 * Той самий жадібний перенос, що в `wrapPrintText`, лише на числах. Слово,
 * ширше за доступну ширину, ріжеться — тут це рахується діленням, бо точна
 * кількість шматків залежить від того, де саме ляжуть межі символів, а для
 * ВИБОРУ ширини ця точність нічого не міняє.
 */
function lineCount(cell: CellModel, width: number, cellPadding: number): number {
  const usable = Math.max(width - cellPadding * 2, 1);
  let lines = 0;

  for (const words of cell.paragraphs) {
    if (!words.length) {
      lines += 1;
      continue;
    }

    let current = -1; // -1 означає «рядок ще порожній»
    for (const word of words) {
      const candidate = current < 0 ? word : current + cell.spaceWidth + word;
      if (candidate <= usable) {
        current = candidate;
        continue;
      }
      if (current >= 0) lines += 1;
      if (word > usable) {
        const pieces = Math.ceil(word / usable);
        lines += pieces - 1;
        current = word - (pieces - 1) * usable;
        continue;
      }
      current = word;
    }
    if (current >= 0) lines += 1;
  }

  return Math.max(lines, 1);
}

/**
 * Розкидати вимогу об'єднаної комірки по її колонках.
 *
 * Об'єднана комірка нічого не каже про КОЖНУ свою колонку окремо — вона каже
 * лише про їхню суму. Тому спершу свою вимогу ставлять одиночні комірки, а
 * об'єднана лише добирає різницю, і добирає порівну: іншого правила з її даних
 * не виводиться. Саме цього не вміє позиційна прикидка на боці застосунку — на
 * тризначній шапці з `rowSpan` вона показує чужі числа.
 */
function spreadSpans(cells: CellModel[], columnCount: number, pick: (cell: CellModel) => number): number[] {
  const demand = new Array(columnCount).fill(0);

  for (const cell of cells) {
    if (cell.colSpan !== 1) continue;
    const index = cell.columnIndex;
    if (index >= 0 && index < columnCount) demand[index] = Math.max(demand[index]!, pick(cell));
  }

  for (const cell of cells) {
    if (cell.colSpan <= 1) continue;
    const from = Math.max(cell.columnIndex, 0);
    const to = Math.min(cell.columnIndex + cell.colSpan, columnCount);
    if (to <= from) continue;

    let covered = 0;
    for (let index = from; index < to; index += 1) covered += demand[index]!;

    const deficit = pick(cell) - covered;
    if (deficit <= 0) continue;

    const share = deficit / (to - from);
    for (let index = from; index < to; index += 1) demand[index] = demand[index]! + share;
  }

  return demand;
}

/** Розкласти `total` між елементами пропорційно вагам (нульові ваги — порівну). */
function shareProportionally(indexes: number[], weights: number[], total: number): Map<number, number> {
  const result = new Map<number, number>();
  if (!indexes.length || total <= 0) return result;

  const sum = indexes.reduce((acc, index) => acc + Math.max(weights[index] ?? 0, 0), 0);
  for (const index of indexes) {
    const weight = sum > 0 ? Math.max(weights[index] ?? 0, 0) / sum : 1 / indexes.length;
    result.set(index, total * weight);
  }
  return result;
}

/**
 * Що дісталося одній колонці — рядок звіту про ширини.
 *
 * Потрібен тому, що `minPt` — єдине число, яке лишається за прикладником, і
 * вибирати його доводилося перебором ПОВНИХ прогонів PDF, міряючи висоту
 * таблиці як непрямий показник «комусь стало тісно». Причому крива не
 * монотонна, тож «підняти й подивитися» не працює — треба сітка значень, а
 * висота однаково не каже, КОМУ саме забракло.
 *
 * Тут це сказано прямо, і числа беруться з того самого прогону, який малює:
 * `naturalPt` — скільки треба, щоб колонка не переносилася взагалі (тобто
 * стеля, вище за яку піднімати `minPt` немає сенсу), `minPt` — підлога, нижче
 * якої вона не стиснеться (найдовше СЛОВО або оголошений мінімум), `atMin` —
 * що вона дістала рівно підлогу, тобто переноситься по максимуму.
 */
export interface PrintResolvedColumn {
  index: number;
  /** Намір, оголошений колонкою. */
  sizing: PrintColumnSizing["kind"];
  /** Вирішена ширина в пунктах — те, чим колонка малюється. */
  widthPt: number;
  /** Підлога: найдовше слово, `minPt` колонки й абсолютний мінімум — найбільше з трьох. */
  minPt: number;
  /** Скільки треба, щоб текст не переносився взагалі. */
  naturalPt: number;
  /** Колонка дістала рівно підлогу, хоча хотіла більше. */
  atMin: boolean;
}

export interface PrintColumnWidthResolution {
  widths: number[];
  columns: PrintResolvedColumn[];
}

/**
 * Порахувати ширини колонок під задану загальну ширину.
 *
 * Повертає рівно `columns.length` чисел, сума яких дорівнює `totalWidth`:
 * таблиця мусить заповнити відведене місце, і залишити її вужчою означало б
 * порожню смугу праворуч.
 */
export function resolvePrintColumnWidths(
  columns: PrintColumnSizingInput[],
  cells: PrintSizedCell[],
  totalWidth: number,
  options: PrintColumnWidthOptions,
): number[] {
  return resolvePrintColumnWidthsDetailed(columns, cells, totalWidth, options).widths;
}

/**
 * Те саме, але зі звітом про кожну колонку.
 *
 * Окремою назвою, а не зміною тієї: ширини потрібні на кожному малюванні
 * таблиці, а звіт — тому, хто добирає `minPt`, тобто зрідка. Рахунок при цьому
 * той самий і одноразовий — звіт складається з чисел, які алгоритм і так має.
 */
export function resolvePrintColumnWidthsDetailed(
  columns: PrintColumnSizingInput[],
  cells: PrintSizedCell[],
  totalWidth: number,
  options: PrintColumnWidthOptions,
): PrintColumnWidthResolution {
  const count = columns.length;
  if (!count) return { widths: [], columns: [] };

  const models = cells
    .filter((cell) => cell.columnIndex >= 0 && cell.columnIndex < count)
    .map((cell) => buildCellModel(cell, options));

  const naturalByColumn = spreadSpans(models, count, (cell) => cell.natural);
  const minByColumn = spreadSpans(models, count, (cell) => cell.min);

  const floors = columns.map((column, index) =>
    Math.max(MIN_COLUMN_WIDTH, column.minPt || 0, minByColumn[index] ?? 0)
  );
  const naturals = columns.map((column, index) =>
    Math.max(floors[index]!, naturalByColumn[index] ?? 0)
  );

  /**
   * Спільний вихід усіх гілок: нормалізація до загальної ширини плюс звіт.
   *
   * Один на всі `return` навмисно — гілок нижче чотири, і звіт, зібраний у
   * кожній окремо, розійшовся б рівно в тій, куди рідше заходять.
   */
  const finish = (raw: number[]): PrintColumnWidthResolution => {
    const widths = normalizeToTotal(raw, totalWidth);
    return {
      widths,
      columns: columns.map((column, index) => {
        const widthPt = widths[index] ?? 0;
        const minPt = floors[index] ?? 0;
        const naturalPt = naturals[index] ?? 0;
        return {
          index,
          sizing: column.sizing.kind,
          widthPt,
          minPt,
          naturalPt,
          // Допуск у півпункта: нормалізація до загальної ширини зсуває всі
          // числа на частки, і точне порівняння називало б «уперлася» то так,
          // то інакше від складу сусідів.
          atMin: naturalPt > minPt + 0.5 && widthPt <= minPt + 0.5,
        };
      }),
    };
  };

  const widths = new Array<number>(count).fill(0);
  const flexible: number[] = [];
  let fixedTotal = 0;

  for (let index = 0; index < count; index += 1) {
    const sizing = columns[index]!.sizing;
    if (sizing.kind === "percent") {
      widths[index] = Math.max(totalWidth * (sizing.percent / 100), MIN_COLUMN_WIDTH);
      fixedTotal += widths[index]!;
      continue;
    }
    flexible.push(index);
  }

  // Відсотки, що не влазять, стискаються пропорційно: інакше гнучким колонкам
  // не лишилося б нічого, і таблиця вилізла б за аркуш.
  if (fixedTotal > totalWidth && fixedTotal > 0) {
    const scale = totalWidth / fixedTotal;
    for (let index = 0; index < count; index += 1) {
      if (columns[index]!.sizing.kind === "percent") widths[index] = widths[index]! * scale;
    }
    fixedTotal = totalWidth;
  }

  if (!flexible.length) return finish(widths);

  const budget = Math.max(totalWidth - fixedTotal, 0);
  const floorTotal = flexible.reduce((sum, index) => sum + floors[index]!, 0);
  const naturalTotal = flexible.reduce((sum, index) => sum + naturals[index]!, 0);

  if (naturalTotal <= budget) {
    // Вистачає на «не переноситися» — і ще лишається. Лишок беруть `auto`; якщо
    // жодної `auto` немає, він ділиться між усіма гнучкими, бо таблиця однаково
    // мусить заповнити свою ширину.
    for (const index of flexible) widths[index] = naturals[index]!;
    const autos = flexible.filter((index) => columns[index]!.sizing.kind === "auto");
    const takers = autos.length ? autos : flexible;
    const extra = shareProportionally(takers, naturals, budget - naturalTotal);
    for (const [index, value] of extra) widths[index] = widths[index]! + value;
    return finish(widths);
  }

  if (floorTotal >= budget) {
    // Навіть найдовші слова не влазять. Стискаємо пропорційно й покладаємося на
    // розрив слова в самому переносі: він некрасивий, але лишає текст у межах
    // комірки, а вихід за межі не має жодного правильного прочитання.
    const scale = floorTotal > 0 ? budget / floorTotal : 0;
    for (const index of flexible) widths[index] = floors[index]! * scale;
    return finish(widths);
  }

  for (const index of flexible) widths[index] = floors[index]!;
  distributeByHeight(widths, flexible, naturals, models, budget - floorTotal, options.cellPadding);
  return finish(widths);
}

/**
 * Роздати надлишок ширини за правилом висоти.
 *
 * Крок іде колонці, чия висота зараз найбільша, — доки надлишок не вичерпано
 * або доки всім не вистачить на «не переноситися». Об'єднана комірка рахується
 * в КОЖНІЙ своїй колонці: ширина в неї спільна, тож розширення будь-якої з них
 * їй допомагає, і саме тому висока шапка з об'єднаннями розсовується сама.
 */
function distributeByHeight(
  widths: number[],
  flexible: number[],
  naturals: number[],
  models: CellModel[],
  surplus: number,
  cellPadding: number,
): void {
  const growable = new Set(flexible.filter((index) => widths[index]! < naturals[index]!));
  if (!growable.size || surplus <= 0) {
    if (surplus > 0) {
      const share = surplus / flexible.length;
      for (const index of flexible) widths[index] = widths[index]! + share;
    }
    return;
  }

  // Комірки по колонках: повернуті не беруть участі — їхня висота від ширини не
  // залежить, і крок, відданий такій колонці, нічого б не змінив.
  const cellsByColumn: CellModel[][] = Array.from({ length: widths.length }, () => []);
  for (const cell of models) {
    if (cell.rotated) continue;
    const to = Math.min(cell.columnIndex + cell.colSpan, widths.length);
    for (let index = Math.max(cell.columnIndex, 0); index < to; index += 1) cellsByColumn[index]!.push(cell);
  }

  const spanWidth = (cell: CellModel) => {
    let sum = 0;
    const to = Math.min(cell.columnIndex + cell.colSpan, widths.length);
    for (let index = Math.max(cell.columnIndex, 0); index < to; index += 1) sum += widths[index]!;
    return sum;
  };

  const heightOf = (column: number) =>
    cellsByColumn[column]!.reduce((sum, cell) => sum + lineCount(cell, spanWidth(cell), cellPadding) * cell.lineStep, 0);

  const heights = new Map<number, number>();
  for (const index of growable) heights.set(index, heightOf(index));

  const step = Math.max(surplus / 400, 0.25);
  let left = surplus;

  for (let iteration = 0; iteration < MAX_STEPS && left > 0 && growable.size; iteration += 1) {
    let target = -1;
    let tallest = -1;
    for (const index of growable) {
      const height = heights.get(index)!;
      if (height > tallest) {
        tallest = height;
        target = index;
      }
    }
    if (target < 0) break;

    const room = naturals[target]! - widths[target]!;
    const give = Math.min(step, left, room);
    widths[target] = widths[target]! + give;
    left -= give;

    if (widths[target]! >= naturals[target]! - 1e-9) growable.delete(target);

    // Перерахувати треба не лише цільову колонку: об'єднана комірка, що її
    // торкається, стала ширшою і для своїх сусідів теж.
    const touched = new Set<number>([target]);
    for (const cell of cellsByColumn[target]!) {
      const to = Math.min(cell.columnIndex + cell.colSpan, widths.length);
      for (let index = Math.max(cell.columnIndex, 0); index < to; index += 1) touched.add(index);
    }
    for (const index of touched) {
      if (growable.has(index)) heights.set(index, heightOf(index));
    }
  }

  // Ніхто вже не росте, а місце лишилося — віддаємо гнучким порівну.
  if (left > 0) {
    const share = left / flexible.length;
    for (const index of flexible) widths[index] = widths[index]! + share;
  }
}

/**
 * Підігнати суму рівно під ширину блока.
 *
 * Дрібні втрати на округленнях у кроках роздачі інакше лишили б праворуч смугу
 * в частку пункта — невидиму на екрані й видиму на папері як зсунуту рамку.
 */
function normalizeToTotal(widths: number[], totalWidth: number): number[] {
  const sum = widths.reduce((acc, width) => acc + width, 0);
  if (sum <= 0) return widths.map(() => totalWidth / widths.length);
  const scale = totalWidth / sum;
  return widths.map((width) => width * scale);
}
