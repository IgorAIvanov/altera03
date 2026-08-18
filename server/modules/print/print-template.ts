// Нейтральний блочний формат шаблону друку (`schemaVersion: 2`).
//
// Один формат живить обидва рендерери: прев'ю в редакторі (HTML) і фінальний PDF
// на сервері. Тут — тільки типи, нормалізація «сирого» JSON із БД/файлу та
// резолвінг значень (числа з рядків, шляхи в даних). Жодного рендеру.
//
// Файл лежить в `app/shared/`, бо ним користуються і фронтенд-редактор, і
// TS-команда `printPdf` — напрямок залежностей `app → client/server` збережено.

import { normalizeBarcodeSymbology } from "./barcode/symbology.ts";
import type { BarcodeSymbology } from "./barcode/symbology.ts";
import { amountInWords } from "./money/money-in-words.ts";

export type { BarcodeSymbology } from "./barcode/symbology.ts";

export type PrintTemplateTargetModel = string;
export type PrintTemplatePaperSize = "A4";
export type PrintTemplateOrientation = "portrait" | "landscape";
export type PrintTemplateColumnAlign = "left" | "center" | "right";
export type PrintTemplateFontWeight = "normal" | "bold";
/**
 * Як блок знаходить своє місце по вертикалі.
 *
 * `absolute` — за координатою `yPercent`; так стоїть шапка затвердженого бланка,
 * і інакше не можна: вона відповідає формі до міліметра.
 *
 * `flow` — під ПОПЕРЕДНІМ блоком списку, хай де той скінчився. Потрібне нижче
 * шапки, де висота відома лише після рендера: скільки рядків займе шапка
 * таблиці з дев'ятнадцяти колонок, на скільки рядків розсипався опис товару,
 * де саме скінчилася перша таблиця. Без цього застосунок мусив ПЕРЕДБАЧИТИ те,
 * що ядро порахує пізніше, і записати передбачення числом — а робилося це
 * єдиним способом: відрендерити, розібрати готовий PDF, посунути, повторити.
 *
 * Змішувати можна й треба: шапка на координатах, усе від першої таблиці й
 * нижче — стосом.
 */
export type PrintTemplateBlockPlacementMode = "absolute" | "flow";
export type PrintTemplateBlockType =
  | "text"
  | "field-list"
  | "table"
  | "image"
  | "barcode"
  | "char-cells"
  | "horizontal-line"
  | "vertical-line";
export type PrintTemplateTextStyle = "title" | "section" | "body";

/**
 * Поворот тексту: `"0"` — звичайний, `"90"` — знизу вгору.
 *
 * ЧОМУ ЛИШЕ ДВА ЗНАЧЕННЯ. У вузькій колонці регламентованої форми
 * горизонтальний заголовок не вміщується взагалі, і поворот там — єдиний спосіб
 * надрукувати бланк таким, яким його затвердили. Але кут потрібен рівно один:
 * серед 1590 макетів джерела (BAS Бухгалтерія УКР) `textOrientation` стоїть у
 * 27, і скрізь це 900 — тобто 90°. Довільний кут дав би поле, яким ніхто не
 * користується, і арифметику розкладки, яку нічим перевірити.
 *
 * Порожнє означає `"0"`, тож наявні шаблони чинні без міграції.
 */
export type PrintTemplateTextOrientation = "0" | "90";
export type PrintTemplateLineStyle = "solid" | "dashed" | "dotted" | "double";

/**
 * Місце блока на аркуші — у відсотках ОБЛАСТІ ДРУКУ (аркуш мінус поля), від її
 * лівого верхнього кута.
 *
 * **`yPercent` — це ВЕРХ блока, для всіх типів однаково.** Вміст стоїть під цією
 * межею: рамка з клітинок висить під нею, картинка й таблиця починаються з неї,
 * текст відсунутий від неї вниз на висоту літери. Правило варте окремого
 * абзацу, бо колись воно було не таке: у тексту `y` означала базову лінію
 * першого рядка, тобто літери стирчали НАД рамкою, і два блоки з однаковою
 * `yPercent` опинялися по різні боки однієї координати. Підпис поруч із
 * клітинками через це підганяли на око, у кожному бланку заново.
 *
 * **Відсотки по двох осях рахуються від різних сторін** — ширина від ширини
 * області друку (515.28 pt на книжковій A4), висота від висоти (761.89 pt).
 * Один і той самий квадрат через це записується двома різними числами; там, де
 * квадрат саме й потрібен — у полі по клітинках, — його дає порожня висота
 * (див. `PrintTemplateCharCellsBlock`).
 */
export interface PrintTemplateBlockPlacement {
  mode: PrintTemplateBlockPlacementMode;
  xPercent: string;
  yPercent: string;
  widthPercent: string;
  heightPercent: string;
  /**
   * Проміжок над блоком у пунктах — читається лише в режимі `flow`.
   *
   * В абсолютному режимі його заміняє сама координата, тож поле там мовчить, а
   * не сперечається з `yPercent`.
   */
  gapPt: string;
}

export interface PrintTemplateBlockTextOptions {
  fontSize: string;
  align: PrintTemplateColumnAlign;
  fontWeight: PrintTemplateFontWeight;
  color: string;
}

/**
 * Умова показу — шлях у даних друку. Порожній означає «видно завжди», тож усі
 * наявні шаблони лишаються чинними без міграції.
 *
 * ЧОМУ ШЛЯХ, А НЕ ВИРАЗ. Шаблон редагує бухгалтер, а не програміст, і вираз
 * (`amount > 0 && hasVat`) — це мова всередині форми, яку доведеться і
 * розбирати, і пояснювати. Рішення лишається в SQL: команда даних рахує
 * `hasVat`, `hasDiscount`, `hasPackaging`, а бланк лише показує, чим воно
 * керує. Дані від цього не стають поданням — прапорець це факт про документ,
 * а не про розкладку.
 *
 * ЩО ВВАЖАЄТЬСЯ ХИБОЮ: `false`, `0`, порожній рядок, порожній масив, `null` —
 * і текстові написання `"false"` / `"0"`. Останнє не поступка, а fail-closed:
 * команда даних, що віддає все рядками (`(total > 0)::text`), інакше показувала
 * б блок завжди, і побачити це можна було б лише на папері. Помилятися тут
 * безпечніше в бік «сховано».
 */
export type PrintTemplateVisibleWhen = string;

interface PrintTemplateBlockBase {
  key: string;
  placement: PrintTemplateBlockPlacement;
  text: PrintTemplateBlockTextOptions;
  /**
   * Умова показу блока — БУДЬ-ЯКОГО, включно з лініями, картинкою й
   * штрих-кодом. Лежить у базі, а не в типах окремих блоків: підвал із
   * факсиміле це рамка плюс картинка плюс лінія, і сховати з них два з трьох
   * означало б лишити на бланку висячу риску.
   */
  visibleWhen: PrintTemplateVisibleWhen;
  /**
   * «Не відривати від наступного» — тримає блок і той, що йде за ним, на ОДНІЙ
   * сторінці. Читається лише в режимі `flow`: в абсолютному місце блока названо
   * координатою, і переносити його нікуди.
   *
   * Позначені підряд блоки утворюють нерозривну групу — саме так виражається
   * «підпис не відривати від твердження, під яким він стоїть». Доти те саме
   * робив поріг у 64 pt під підвалом: він вгадував, що підпис не можна лишати
   * самого, і вгадував по відстані між блоками, а не по їхньому змісту.
   *
   * Таблиця цього не слухає: вона розривається сама, по записах, і вимога
   * «цілком на одній сторінці» для неї означала б бланк, який не друкується.
   */
  keepTogether: boolean;
}

/**
 * Формат значення поля. Порожній — значення йде як є (правило «рендерер не
 * форматує» лишається чинним за умовчанням).
 *
 * `amountInWords` — виняток, зроблений свідомо: сума прописом потрібна на
 * регламентованих бланках, і правило її написання належить МОВІ, а не
 * застосунку. Тримати перетворення тут, а не в команді даних, правильніше з
 * двох причин: шаблон уже знає мову (на кожну мову свій бланк), а команда даних
 * лишається без подання — те саме число друкується і цифрами, і словами, не
 * знаючи про це.
 *
 * Перелік закритий навмисно: «дата прописом», «кількість прописом» і решта
 * сюди не додаються — одна поступка тут тягне за собою п'ять.
 */
export type PrintTemplateValueFormat = "" | "amountInWords";

export interface PrintTemplateFieldListItem {
  key: string;
  label: string;
  path: string;
  format: PrintTemplateValueFormat;
  /** Умова показу рядка. Шлях резолвиться від кореня даних, як і `path` поруч. */
  visibleWhen: PrintTemplateVisibleWhen;
}

/**
 * Колонка таблиці — це лише вертикаль сітки: ключ і ширина.
 *
 * Заголовки й прив'язки живуть у комірках секцій, бо одна колонка може мати над
 * собою кілька рівнів заголовків, а один запис — друкуватися кількома рядками.
 */
export interface PrintTemplateTableColumn {
  key: string;
  widthPercent: string;
  /**
   * Умова показу колонки (від кореня даних: колонка або є на весь бланк, або
   * її немає). Схована колонка **віддає свою ширину сусідам** пропорційно —
   * інакше таблиця з'їхала б убік і лишила порожню смугу.
   */
  visibleWhen: PrintTemplateVisibleWhen;
}

/**
 * Комірка секції. Або статичний `text`, або значення за `path`
 * (у секції `row` — від запису, у `header`/`footer` — від кореня даних).
 * Порожні `fontSize`/`color` означають «успадкувати від блока».
 */
export interface PrintTemplateTableCell {
  key: string;
  text: string;
  path: string;
  format: PrintTemplateValueFormat;
  colSpan: number;
  rowSpan: number;
  align: PrintTemplateColumnAlign;
  fontWeight: PrintTemplateFontWeight;
  fontSize: string;
  color: string;
  /**
   * Поворот тексту комірки. Повернута комірка **не переноситься по словах**:
   * її текст іде одним рядком, а висоту рядка таблиці визначає довжина цього
   * тексту. Інакше вийшла б рекурсія — щоб перенести, треба знати висоту, а
   * висота якраз і залежить від переносу.
   *
   * Заради цього поворот і потрібен: у вузькій колонці («Ставка ПДВ» у 6 %)
   * горизонтальний заголовок або лізе на сусідню колонку, або розсипається на
   * стовпчик літер.
   */
  textOrientation: PrintTemplateTextOrientation;
}

export interface PrintTemplateTableRow {
  key: string;
  cells: PrintTemplateTableCell[];
  /**
   * Умова показу рядка. Шлях резолвиться з ТОГО САМОГО кореня, що й `path`
   * комірок поруч: у `header`/`footer` — від даних друку («Разом ПДВ»), у
   * `row` — від конкретного запису (додатковий рядок під позицією).
   */
  visibleWhen: PrintTemplateVisibleWhen;
}

/** Секції необов'язкові: таблиця може бути без шапки або без підвалу. */
export interface PrintTemplateTableSections {
  header: PrintTemplateTableRow[];
  row: PrintTemplateTableRow[];
  footer: PrintTemplateTableRow[];
}

export type PrintTemplateTableSectionName = keyof PrintTemplateTableSections;

export const PRINT_TEMPLATE_TABLE_SECTIONS: PrintTemplateTableSectionName[] = ["header", "row", "footer"];

/**
 * Стара форма колонки: заголовок і прив'язка прямо в колонці, без секцій.
 * Лишається лише для підняття давніх шаблонів — див. `sectionsFromLegacyColumns`.
 */
interface LegacyPrintTemplateTableColumn {
  key: string;
  // Сучасна колонка — це ключ, ширина й умова показу; решта полів тут потрібна
  // лише для підйому давніх шаблонів, але шлях нормалізації в них один.
  visibleWhen: string;
  title: string;
  path: string;
  widthPercent: string;
  headerAlign: PrintTemplateColumnAlign;
  headerFontWeight: PrintTemplateFontWeight;
  headerFontSize: string;
  headerColor: string;
  valueAlign: PrintTemplateColumnAlign;
  valueFontWeight: PrintTemplateFontWeight;
  valueFontSize: string;
  valueColor: string;
}

/**
 * Рядок тексту. Значення береться так само, як у штрих-коді й комірці таблиці:
 * статичний `value` перекриває прив'язку `path`. Одне правило на весь формат —
 * щоб не доводилось пам'ятати, де саме пріоритет інший.
 *
 * Прив'язки тут спершу не було, і це виявилося дірою в самій СЕРЕДИНІ формату:
 * динамічний рядок БЕЗ підпису надрукувати не було чим. Заголовок бланка
 * («Рахунок на оплату № 12 від 02.02.2026»), підсумок, «Надруковано …» — усе це
 * значення без підпису, а `field-list` завжди друкував «підпис: значення».
 * Виходило, що текст або статичний, або з підписом, і третього не дано.
 *
 * Гірший бік був тихий: шаблони писали `path` у текстовий блок, наче він
 * працює, нормалізація його мовчки викидала, і на бланку лишався «-». Тобто
 * відсутність механізму виглядала як заповнений бланк, і помітити це можна було
 * тільки поглядом на папір.
 */
export interface PrintTemplateTextBlock extends PrintTemplateBlockBase {
  type: "text";
  style: PrintTemplateTextStyle;
  /** Статичний текст. Непорожній — перекриває прив'язку. */
  value: string;
  /** Шлях у даних друку (від того самого кореня, що й у списку полів). */
  path: string;
  format: PrintTemplateValueFormat;
  /**
   * Поворот. У повернутого блока **висота рамки починає діяти на друк**: вона
   * задає довжину, на якій текст переноситься, — те, чим у звичайного блока є
   * ширина. Не задана — текст іде одним рядком на всю свою довжину.
   *
   * Так друкується заголовок авансового звіту: він стоїть уздовж лівого краю
   * аркуша, і горизонтально його нема куди подіти.
   */
  textOrientation: PrintTemplateTextOrientation;
}

export interface PrintTemplateFieldListBlock extends PrintTemplateBlockBase {
  type: "field-list";
  items: PrintTemplateFieldListItem[];
}

export interface PrintTemplateTableBlock extends PrintTemplateBlockBase {
  type: "table";
  title: string;
  source: string;
  columns: PrintTemplateTableColumn[];
  sections: PrintTemplateTableSections;
}

/**
 * Картинка. Значення береться за тим самим правилом, що в тексті, комірці й
 * штрих-коді: статичний `src` перекриває прив'язку `path`.
 *
 * Прив'язка тут не зручність, а умова правильності документа: логотип, печатка
 * й факсимільний підпис належать ОРГАНІЗАЦІЇ, від імені якої друкують, а
 * організацій у базі кілька. Статичний `src` означав би одну печатку на всі —
 * тобто не спрощений бланк, а неправильний.
 *
 * За шляхом очікується `data:`-URI рядком — так само, як застосунок віддає все
 * інше. Нічим іншим воно й не могло б приїхати: блок читає дані друку, а не
 * файлову систему.
 */
export interface PrintTemplateImageBlock extends PrintTemplateBlockBase {
  type: "image";
  /** Статичне зображення (`data:`-URI). Непорожнє — перекриває прив'язку. */
  src: string;
  /** Шлях у даних друку (від того самого кореня, що й у списку полів). */
  path: string;
  alt: string;
}

/**
 * Штрих-код.
 *
 * Значення береться так само, як у комірці таблиці: статичний `value` перекриває
 * прив'язку `path`. Одне правило на весь формат — щоб не доводилось пам'ятати,
 * де саме пріоритет інший.
 *
 * Кольору тут немає навмисно: штрих-код мусить бути чорним на білому, інакше
 * сканер його не візьме. Дати таке поле означало б дати спосіб зіпсувати
 * документ, який виглядатиме цілком нормально на екрані.
 */
export interface PrintTemplateBarcodeBlock extends PrintTemplateBlockBase {
  type: "barcode";
  symbology: BarcodeSymbology;
  /** Статичне значення. Порожнє — беремо за `path`. */
  value: string;
  /** Шлях у даних друку (від того самого кореня, що й у списку полів). */
  path: string;
  /** Чи друкувати значення текстом під кодом. */
  showText: boolean;
}

/**
 * Поле, розкладене ПО КЛІТИНКАХ: одна літера — одна клітинка з рамкою.
 *
 * ЧОМУ ЦЕ ОКРЕМИЙ ТИП, А НЕ ТАБЛИЦЯ. Українська регламентована звітність
 * побудована на таких полях: ІПН і ЄДРПОУ, РНОКПП, дата складання, порядковий
 * номер декларації. У затвердженій формі це рамка з квадратиків, і бланк без
 * неї формально інший — у клітинки податкова вписує цифри від руки. Таблицею це
 * не виражається: там рядки ДАНИХ, а тут ОДНЕ значення, розрізане на символи, і
 * стоїть воно в шапці бланка поруч із підписами.
 *
 * Значення береться за тим самим правилом, що всюди у форматі: статичний `value`
 * перекриває прив'язку `path`.
 *
 * **Геометрія — з рамки блока**: ширина клітинки це ширина рамки, поділена на
 * `count`. Окремого «розміру клітинки в міліметрах» немає навмисно — він завів
 * би другу систему координат поруч із розкладкою, і полотно редактора почало б
 * показувати не те, що піде на папір. Натомість **порожня висота означає
 * КВАДРАТ** — клітинку заввишки в саму себе завширшки, тобто те, що стоїть на
 * затверджених формах. Це не зручність, а єдиний спосіб дістати квадрат не
 * рахуючи: відсотки по двох осях рахуються від різних сторін аркуша, і той
 * самий квадратик записується двома різними числами (12 клітинок по 13 pt —
 * 30.3 % завширшки й 1.71 % заввишки). Задана висота сильніша: клітинка
 * затвердженої форми буває й видовженою.
 *
 * **Розкладає рендерер, а форматує команда даних.** Блок ріже рядок таким, яким
 * його дали: `22.06.2026` у восьми клітинках дасть `2 2 . 0 6 . 2 0` — крапки
 * теж символи. Дату під клітинки команда даних віддає окремим полем
 * (`to_char(d, 'DDMMYYYY')`), як і все інше в друку: рендерер не форматує.
 */
export interface PrintTemplateCharCellsBlock extends PrintTemplateBlockBase {
  type: "char-cells";
  /** Статичне значення. Непорожнє — перекриває прив'язку. */
  value: string;
  /** Шлях у даних друку (від того самого кореня, що й у списку полів). */
  path: string;
  /**
   * Скільки клітинок малювати. Береться із ЗАТВЕРДЖЕНОЇ форми (ІПН — 12,
   * РНОКПП — 10, дата — 8), а не з довжини значення: порожні клітинки на бланку
   * лишаються порожніми, і це нормальний його вигляд.
   */
  count: string;
  /** Колір рамки клітинок. Колір самих символів — у `text`, як у решти блоків. */
  borderColor: string;
  lineWidth: string;
}

export interface PrintTemplateHorizontalLineBlock extends PrintTemplateBlockBase {
  type: "horizontal-line";
  color: string;
  lineStyle: PrintTemplateLineStyle;
  lineWidth: string;
}

export interface PrintTemplateVerticalLineBlock extends PrintTemplateBlockBase {
  type: "vertical-line";
  color: string;
  lineStyle: PrintTemplateLineStyle;
  lineWidth: string;
}

export type PrintTemplateBlock =
  | PrintTemplateTextBlock
  | PrintTemplateFieldListBlock
  | PrintTemplateTableBlock
  | PrintTemplateImageBlock
  | PrintTemplateBarcodeBlock
  | PrintTemplateCharCellsBlock
  | PrintTemplateHorizontalLineBlock
  | PrintTemplateVerticalLineBlock;

export interface PrintTemplateSchema {
  schemaVersion: 2;
  /**
   * Мова бланка й валюта, у якій він виписаний, — від них залежить формат
   * `amountInWords`.
   *
   * Живуть у самому шаблоні, а не в колонці таблиці: регламентована форма
   * заводиться окремим шаблоном на кожну мову, тож мова — властивість бланка,
   * а не запису про нього. Порожні означають умовчання (`uk`, `UAH`), тож
   * шаблони, зроблені до появи формату, лишаються чинними без міграції.
   */
  locale: string;
  currency: string;
  blocks: PrintTemplateBlock[];
}

export interface ResolvedPrintTemplateBlockPlacement {
  mode: PrintTemplateBlockPlacementMode;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  gapPt: number;
}

export interface ResolvedPrintTemplateBlockTextOptions {
  fontSize: number;
  align: PrintTemplateColumnAlign;
  fontWeight: PrintTemplateFontWeight;
  color: string;
}

export interface ResolvedPrintTemplateLineOptions {
  color: string;
  lineStyle: PrintTemplateLineStyle;
  lineWidth: number;
}

/** Рамка поля по клітинках: скільки їх і чим вони обведені. */
export interface ResolvedPrintTemplateCharCellsOptions {
  count: number;
  borderColor: string;
  lineWidth: number;
}

export interface RenderablePrintTemplateTableColumn extends PrintTemplateTableColumn {
  widthWeight: number;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTextStyle(value: unknown): PrintTemplateTextStyle {
  return value === "title" || value === "section" || value === "body" ? value : "body";
}

function normalizeColumnAlign(value: unknown): PrintTemplateColumnAlign {
  return value === "right" || value === "center" || value === "left" ? value : "left";
}

/** Невідомий формат — це «як є», а не помилка: шаблон міг приїхати з новішої версії. */
function normalizeValueFormat(value: unknown): PrintTemplateValueFormat {
  return value === "amountInWords" ? value : "";
}

function normalizeFontWeight(value: unknown): PrintTemplateFontWeight {
  return value === "bold" ? "bold" : "normal";
}

/**
 * Приймає і рядок, і число (`90` так само, як `"90"`): шаблон пишуть руками, а
 * у форматі числа зберігаються рядками — розбіжність написання не має мовчки
 * випрямляти повернутий заголовок.
 */
function normalizeTextOrientation(value: unknown): PrintTemplateTextOrientation {
  return String(value ?? "").trim() === "90" ? "90" : "0";
}

function normalizeLineStyle(value: unknown): PrintTemplateLineStyle {
  return value === "solid" || value === "dashed" || value === "dotted" || value === "double"
    ? value
    : "solid";
}

function normalizeColor(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function createDefaultBlockPlacement(): PrintTemplateBlockPlacement {
  return {
    mode: "absolute",
    xPercent: "0",
    yPercent: "0",
    widthPercent: "100",
    heightPercent: "0",
    gapPt: "",
  };
}

function createDefaultBlockTextOptions(options?: Partial<PrintTemplateBlockTextOptions>): PrintTemplateBlockTextOptions {
  return {
    fontSize: options?.fontSize ?? "10",
    align: options?.align ?? "left",
    fontWeight: options?.fontWeight ?? "normal",
    color: options?.color ?? "#262626",
  };
}

function getDefaultBlockTextOptions(type: PrintTemplateBlockType, textStyle?: PrintTemplateTextStyle): PrintTemplateBlockTextOptions {
  if (type === "text") {
    if (textStyle === "title") {
      return createDefaultBlockTextOptions({ fontSize: "16", align: "center", fontWeight: "bold" });
    }

    if (textStyle === "section") {
      return createDefaultBlockTextOptions({ fontSize: "12", align: "left", fontWeight: "bold" });
    }

    return createDefaultBlockTextOptions({ fontSize: "10", align: "left", fontWeight: "normal" });
  }

  // Підпис під штрих-кодом — дрібний і по центру: він допоміжний, а вирівнювати
  // його інакше, ніж по коду, сенсу немає.
  if (type === "barcode") {
    return createDefaultBlockTextOptions({ fontSize: "8", align: "center", fontWeight: "normal" });
  }

  return createDefaultBlockTextOptions({ fontSize: "10", align: "left", fontWeight: type === "table" ? "normal" : "normal" });
}

function normalizeBlockPlacement(value: unknown): PrintTemplateBlockPlacement {
  if (!isRecord(value)) {
    return createDefaultBlockPlacement();
  }

  return {
    // Невідомий режим — абсолютний, а не відмова: шаблон із майбутнього поля
    // мусить лишитися друкованим, і координата в ньому є завжди.
    mode: value.mode === "flow" ? "flow" : "absolute",
    xPercent: normalizeString(value.xPercent) || "0",
    yPercent: normalizeString(value.yPercent) || "0",
    widthPercent: normalizeString(value.widthPercent) || "100",
    heightPercent: normalizeString(value.heightPercent) || "0",
    gapPt: normalizeString(value.gapPt),
  };
}

function normalizeBlockTextOptions(value: unknown, defaults: PrintTemplateBlockTextOptions): PrintTemplateBlockTextOptions {
  if (!isRecord(value)) {
    return defaults;
  }

  return {
    fontSize: normalizeString(value.fontSize) || defaults.fontSize,
    align: normalizeColumnAlign(value.align ?? defaults.align),
    fontWeight: normalizeFontWeight(value.fontWeight ?? defaults.fontWeight),
    color: normalizeColor(value.color, defaults.color),
  };
}

function normalizeLineWidth(value: unknown, fallback = "2") {
  const normalized = normalizeString(value);
  if (!normalized) {
    return fallback;
  }

  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? normalized : fallback;
}

function normalizeFieldListItem(value: unknown): PrintTemplateFieldListItem | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    key: normalizeString(value.key),
    label: normalizeString(value.label),
    path: normalizeString(value.path),
    format: normalizeValueFormat(value.format),
    visibleWhen: normalizeString(value.visibleWhen),
  };
}

function normalizeLegacyTableColumn(value: unknown): LegacyPrintTemplateTableColumn | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    key: normalizeString(value.key),
    visibleWhen: normalizeString(value.visibleWhen),
    title: normalizeString(value.title),
    path: normalizeString(value.path),
    widthPercent: normalizeString(value.widthPercent),
    headerAlign: normalizeColumnAlign(value.headerAlign ?? value.align),
    headerFontWeight: normalizeFontWeight(value.headerFontWeight ?? value.fontWeight),
    headerFontSize: normalizeString(value.headerFontSize ?? value.fontSize),
    headerColor: normalizeColor(value.headerColor, ""),
    valueAlign: normalizeColumnAlign(value.valueAlign ?? value.align),
    valueFontWeight: normalizeFontWeight(value.valueFontWeight ?? value.fontWeight),
    valueFontSize: normalizeString(value.valueFontSize ?? value.fontSize),
    valueColor: normalizeColor(value.valueColor, ""),
  };
}

function normalizeSpan(value: unknown) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeTableCell(value: unknown): PrintTemplateTableCell | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    key: normalizeString(value.key) || crypto.randomUUID(),
    text: normalizeString(value.text),
    path: normalizeString(value.path),
    format: normalizeValueFormat(value.format),
    colSpan: normalizeSpan(value.colSpan),
    rowSpan: normalizeSpan(value.rowSpan),
    align: normalizeColumnAlign(value.align),
    fontWeight: normalizeFontWeight(value.fontWeight),
    fontSize: normalizeString(value.fontSize),
    color: normalizeColor(value.color, ""),
    textOrientation: normalizeTextOrientation(value.textOrientation),
  };
}

function normalizeTableRows(value: unknown): PrintTemplateTableRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((row) => {
    if (!isRecord(row)) return [];

    const cells = Array.isArray(row.cells)
      ? row.cells.map(normalizeTableCell).filter((cell): cell is PrintTemplateTableCell => Boolean(cell))
      : [];

    return cells.length
      ? [{
        key: normalizeString(row.key) || crypto.randomUUID(),
        cells,
        visibleWhen: normalizeString(row.visibleWhen),
      }]
      : [];
  });
}

function createTableCell(patch: Partial<PrintTemplateTableCell>): PrintTemplateTableCell {
  return {
    key: crypto.randomUUID(),
    text: "",
    path: "",
    format: "",
    colSpan: 1,
    rowSpan: 1,
    align: "left",
    fontWeight: "normal",
    fontSize: "",
    color: "",
    textOrientation: "0",
    ...patch,
  };
}

/**
 * Підйом давнього шаблону: колонки з `title`/`path` перетворюються на секції —
 * один рядок шапки із заголовків і один рядок даних із прив'язок.
 *
 * Так шаблони, збережені до появи секцій, і далі друкуються без міграції даних.
 */
function sectionsFromLegacyColumns(columns: LegacyPrintTemplateTableColumn[]): PrintTemplateTableSections {
  return {
    header: [{
      key: crypto.randomUUID(),
      visibleWhen: "",
      cells: columns.map((column) => createTableCell({
        text: column.title,
        align: column.headerAlign,
        fontWeight: column.headerFontWeight,
        fontSize: column.headerFontSize,
        color: column.headerColor,
      })),
    }],
    row: [{
      key: crypto.randomUUID(),
      visibleWhen: "",
      cells: columns.map((column) => createTableCell({
        path: column.path,
        align: column.valueAlign,
        fontWeight: column.valueFontWeight,
        fontSize: column.valueFontSize,
        color: column.valueColor,
      })),
    }],
    footer: [],
  };
}

function normalizeTableSections(value: unknown, legacyColumns: LegacyPrintTemplateTableColumn[]): PrintTemplateTableSections {
  if (!isRecord(value)) {
    return sectionsFromLegacyColumns(legacyColumns);
  }

  const sections: PrintTemplateTableSections = {
    header: normalizeTableRows(isRecord(value.header) ? value.header.rows : value.header),
    row: normalizeTableRows(isRecord(value.row) ? value.row.rows : value.row),
    footer: normalizeTableRows(isRecord(value.footer) ? value.footer.rows : value.footer),
  };

  // Секції є, але всі порожні — вважаємо, що їх не описали, і беремо колонки.
  const hasAnyRow = PRINT_TEMPLATE_TABLE_SECTIONS.some((name) => sections[name].length > 0);
  return hasAnyRow ? sections : sectionsFromLegacyColumns(legacyColumns);
}

function normalizeBlock(value: unknown): PrintTemplateBlock | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = value.type;
  const key = normalizeString(value.key);

  if (type === "text") {
    const textStyle = normalizeTextStyle(value.style);
    return {
      key,
      type,
      style: textStyle,
      value: normalizeString(value.value),
      path: normalizeString(value.path),
      format: normalizeValueFormat(value.format),
      textOrientation: normalizeTextOrientation(value.textOrientation),
      visibleWhen: normalizeString(value.visibleWhen),
      keepTogether: value.keepTogether === true,
      placement: normalizeBlockPlacement(value.placement),
      text: normalizeBlockTextOptions(value.text, getDefaultBlockTextOptions(type, textStyle)),
    };
  }

  if (type === "field-list") {
    return {
      key,
      type,
      items: Array.isArray(value.items)
        ? value.items.map((item) => normalizeFieldListItem(item)).filter((item): item is PrintTemplateFieldListItem => Boolean(item))
        : [],
      visibleWhen: normalizeString(value.visibleWhen),
      keepTogether: value.keepTogether === true,
      placement: normalizeBlockPlacement(value.placement),
      text: normalizeBlockTextOptions(value.text, getDefaultBlockTextOptions(type)),
    };
  }

  if (type === "table") {
    const legacyColumns = Array.isArray(value.columns)
      ? value.columns
        .map((column) => normalizeLegacyTableColumn(column))
        .filter((column): column is LegacyPrintTemplateTableColumn => Boolean(column))
      : [];

    return {
      key,
      type,
      title: normalizeString(value.title),
      source: normalizeString(value.source),
      columns: legacyColumns.map((column) => ({
        key: column.key,
        widthPercent: column.widthPercent,
        visibleWhen: column.visibleWhen,
      })),
      sections: normalizeTableSections(value.sections, legacyColumns),
      visibleWhen: normalizeString(value.visibleWhen),
      keepTogether: value.keepTogether === true,
      placement: normalizeBlockPlacement(value.placement),
      text: normalizeBlockTextOptions(value.text, getDefaultBlockTextOptions(type)),
    };
  }

  if (type === "image") {
    return {
      key,
      type,
      src: normalizeString(value.src),
      path: normalizeString(value.path),
      alt: normalizeString(value.alt),
      visibleWhen: normalizeString(value.visibleWhen),
      keepTogether: value.keepTogether === true,
      placement: normalizeBlockPlacement(value.placement),
      text: normalizeBlockTextOptions(value.text, getDefaultBlockTextOptions(type)),
    };
  }

  if (type === "barcode") {
    return {
      key,
      type,
      symbology: normalizeBarcodeSymbology(value.symbology),
      value: normalizeString(value.value),
      path: normalizeString(value.path),
      // Підпис під кодом за замовчуванням увімкнений: він потрібен людині, коли
      // сканера немає під рукою, і саме його очікують у EAN-13.
      showText: value.showText !== false,
      visibleWhen: normalizeString(value.visibleWhen),
      keepTogether: value.keepTogether === true,
      placement: normalizeBlockPlacement(value.placement),
      text: normalizeBlockTextOptions(value.text, getDefaultBlockTextOptions(type)),
    };
  }

  if (type === "char-cells") {
    return {
      key,
      type,
      value: normalizeString(value.value),
      path: normalizeString(value.path),
      count: normalizeString(value.count) || "1",
      // Рамка клітинок темніша за лінію-роздільник: це частина поля, а не
      // оформлення аркуша, і на затвердженій формі вона чорна.
      borderColor: normalizeColor(value.borderColor, "#262626"),
      lineWidth: normalizeLineWidth(value.lineWidth, "1"),
      visibleWhen: normalizeString(value.visibleWhen),
      keepTogether: value.keepTogether === true,
      placement: normalizeBlockPlacement(value.placement),
      text: normalizeBlockTextOptions(value.text, getDefaultBlockTextOptions(type)),
    };
  }

  if (type === "horizontal-line" || type === "vertical-line") {
    return {
      key,
      type,
      visibleWhen: normalizeString(value.visibleWhen),
      keepTogether: value.keepTogether === true,
      placement: normalizeBlockPlacement(value.placement),
      text: normalizeBlockTextOptions(value.text, getDefaultBlockTextOptions(type)),
      color: normalizeColor(value.color, "#595959"),
      lineStyle: normalizeLineStyle(value.lineStyle),
      lineWidth: normalizeLineWidth(value.lineWidth),
    };
  }

  return null;
}

export function normalizePrintTemplateSchema(schema: unknown): PrintTemplateSchema | null {
  if (!isRecord(schema) || schema.schemaVersion !== 2 || !Array.isArray(schema.blocks)) {
    return null;
  }

  const blocks = schema.blocks
    .map((block) => normalizeBlock(block))
    .filter((block): block is PrintTemplateBlock => Boolean(block));

  if (!blocks.length) {
    return null;
  }

  return {
    schemaVersion: 2,
    locale: normalizeString(schema.locale) || "uk",
    currency: (normalizeString(schema.currency) || "UAH").toUpperCase(),
    blocks,
  };
}

export function getRenderablePrintTemplateBlocks(schema: PrintTemplateSchema): PrintTemplateBlock[] {
  return schema.blocks.filter((block) => block.key);
}

export function sanitizePrintTemplateBlocks(blocks: PrintTemplateBlock[]): PrintTemplateBlock[] {
  return normalizePrintTemplateSchema({ schemaVersion: 2, blocks })?.blocks ?? [];
}

export function resolvePrintTemplatePath(source: unknown, path: string): unknown {
  const normalizedPath = normalizeString(path);
  if (!normalizedPath) {
    return null;
  }

  return normalizedPath.split(".").reduce<unknown>((current, segment) => {
    if (!segment) {
      return current;
    }

    if (current && typeof current === "object" && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment];
    }

    return null;
  }, source);
}

/**
 * Чи показувати елемент. Порожня умова — так; далі значення за шляхом.
 *
 * Правило істинності одне на всі рівні (блок, рядок, колонка, поле списку) —
 * див. `PrintTemplateVisibleWhen`. `scope` тут той самий корінь, від якого
 * рахується `path` поруч: для блока й колонки це дані друку, для рядка секції
 * `row` — конкретний запис.
 */
export function isPrintTemplateElementVisible(scope: unknown, visibleWhen: PrintTemplateVisibleWhen): boolean {
  const path = normalizeString(visibleWhen);
  if (!path) {
    return true;
  }

  const value = resolvePrintTemplatePath(scope, path);

  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (Array.isArray(value)) return value.length > 0;

  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    // `"false"`/`"0"` — це команда даних, яка віддає все рядками. Непорожній
    // рядок сам собою істинний, але саме ці два написання означають «ні» для
    // будь-якої людини, і мовчки показаний блок гірший за мовчки схований.
    return text !== "" && text !== "false" && text !== "0";
  }

  // Об'єкт: значення є, і це не «нічого».
  return true;
}

/** Позиція комірки в сітці колонок. */
export interface PrintTemplateGridCell<Cell> {
  cell: Cell;
  rowIndex: number;
  columnIndex: number;
  /** Уже обрізаний по краю таблиці. */
  colSpan: number;
  rowSpan: number;
}

/**
 * Розкладка комірок по сітці колонок — зліва направо, з пропуском клітинок,
 * зайнятих `rowSpan` попередніх рядків (так само, як це робить HTML-таблиця).
 *
 * Живе тут, а не в рендерері, бо обхід потрібен ДВОМ: рендерер розставляє за
 * ним комірки, а план рендеру — вирішує, які з них викинути разом зі схованою
 * колонкою. Дві копії цього циклу розійшлися б на першому ж `rowSpan`, і
 * розходження виглядало б як з'їхала таблиця, а не як помилка в коді.
 */
export function layoutPrintTemplateGrid<Cell extends { colSpan: number; rowSpan: number }>(
  rows: readonly { cells: readonly Cell[] }[],
  columnCount: number,
): PrintTemplateGridCell<Cell>[] {
  const occupied = new Set<string>();
  const placed: PrintTemplateGridCell<Cell>[] = [];

  rows.forEach((row, rowIndex) => {
    let columnIndex = 0;

    for (const cell of row.cells) {
      while (occupied.has(`${rowIndex}:${columnIndex}`)) columnIndex += 1;
      // Комірки, для яких не лишилось колонок, просто не друкуються: краще
      // втратити зайву комірку, ніж поламати сітку.
      if (columnIndex >= columnCount) break;

      const colSpan = Math.min(cell.colSpan, columnCount - columnIndex);
      const rowSpan = Math.min(cell.rowSpan, rows.length - rowIndex);

      for (let r = 0; r < rowSpan; r += 1) {
        for (let c = 0; c < colSpan; c += 1) {
          occupied.add(`${rowIndex + r}:${columnIndex + c}`);
        }
      }

      placed.push({ cell, rowIndex, columnIndex, colSpan, rowSpan });
      columnIndex += colSpan;
    }
  });

  return placed;
}

/** Мова й валюта бланка — усе, що формат значення знає про оточення. */
export interface PrintTemplateValueContext {
  locale?: string;
  currency?: string;
}

/**
 * Значення → текст бланка.
 *
 * **Порожнє друкується порожнім.** Раніше тут стояв прочерк, і це було
 * втручанням ядра в бланк: «нічого» на регламентованій формі виглядає
 * по-різному — десь порожньо, десь прочерк, десь «б/н», — і вирішує це той, хто
 * форму робить, а не той, хто пише рендерер. Кому потрібен прочерк, ставить
 * його в команді даних (`coalesce(x, '-')`), де відомо, чи поле «не заповнене»,
 * чи «не застосовне».
 *
 * Ціна старого рішення була видна в кожній таблиці: у рядка-послуги немає
 * одиниці виміру, і колонка «Од.» друкувалася прочерком на кожному такому
 * рядку — ядро вирішувало за бланк, а виправити це шаблоном не було чим.
 *
 * Непридатне значення (об'єкт, масив) теж дає порожнє, а не позначку: прочерк
 * діагностикою однаково не був — помилку прив'язки видно з того, що на папері
 * немає значення, і однаково лише поглядом на папір.
 */
export function stringifyPrintTemplateValue(
  value: unknown,
  format: PrintTemplateValueFormat = "",
  context: PrintTemplateValueContext = {},
): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return "";
  }

  if (format === "amountInWords") {
    try {
      return amountInWords(typeof value === "boolean" ? String(value) : value, {
        locale: context.locale,
        currency: context.currency,
      });
    } catch {
      // Те саме рішення, що в штрих-кода поруч: помилкове значення друкується
      // текстом, а не валить увесь документ. Друк — остання ланка, і людина,
      // яка натиснула «Друк», однаково не полагодить ні валюту, ні число.
      return String(value);
    }
  }

  return String(value);
}

/**
 * Сітка колонок для рендеру. Колонка без ширини важить 1 — тоді таблиця без
 * заданих ширин ділиться нарівно, а не зникає.
 */
export function getRenderablePrintTemplateTableColumns(columns: PrintTemplateTableColumn[]): RenderablePrintTemplateTableColumn[] {
  return columns.map((column) => ({
    ...column,
    widthWeight: Number(column.widthPercent) > 0 ? Number(column.widthPercent) : 1,
  }));
}

function parseTemplateNumber(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolvePrintTemplateBlockPlacement(placement: PrintTemplateBlockPlacement): ResolvedPrintTemplateBlockPlacement {
  return {
    mode: placement.mode,
    xPercent: clampNumber(parseTemplateNumber(placement.xPercent, 0), 0, 100),
    yPercent: clampNumber(parseTemplateNumber(placement.yPercent, 0), 0, 100),
    widthPercent: clampNumber(parseTemplateNumber(placement.widthPercent, 100), 1, 100),
    heightPercent: clampNumber(parseTemplateNumber(placement.heightPercent, 0), 0, 100),
    // Проміжок за умовчанням — не нуль: блок, поставлений упритул до
    // попереднього, на папері читається як його продовження. Верхня межа є, бо
    // проміжок у півсторінки — це вже не проміжок, а порожня сторінка.
    gapPt: clampNumber(parseTemplateNumber(placement.gapPt, PRINT_TEMPLATE_DEFAULT_GAP_PT), 0, 200),
  };
}

export function resolvePrintTemplateBlockTextOptions(text: PrintTemplateBlockTextOptions): ResolvedPrintTemplateBlockTextOptions {
  return {
    fontSize: clampNumber(parseTemplateNumber(text.fontSize, 10), 6, 72),
    align: text.align,
    fontWeight: text.fontWeight,
    color: normalizeColor(text.color, "#262626"),
  };
}

/**
 * Проміжок над блоком у режимі `flow`, коли його не назвали.
 *
 * Не нуль: блок, поставлений упритул, на папері читається як продовження
 * попереднього. 6 pt — приблизно міжрядковий інтервал бланка, тобто відстань,
 * яку око вже бачить як «наступний блок», але яка ще не розриває розділ.
 */
export const PRINT_TEMPLATE_DEFAULT_GAP_PT = 6;

/**
 * Стеля кількості клітинок. Взята з запасом до найдовшого регламентованого поля
 * (ІПН — 12): рамка з півсотні клітинок на аркуші A4 вже нечитна, а верхня межа
 * тут потрібна, щоб описка в шаблоні не малювала мільйон прямокутників.
 */
export const PRINT_TEMPLATE_CHAR_CELLS_MAX = 64;

export function resolvePrintTemplateCharCellCount(count: string): number {
  return Math.trunc(clampNumber(parseTemplateNumber(count, 1), 1, PRINT_TEMPLATE_CHAR_CELLS_MAX));
}

export function resolvePrintTemplateCharCellsOptions(block: PrintTemplateCharCellsBlock): ResolvedPrintTemplateCharCellsOptions {
  return {
    count: resolvePrintTemplateCharCellCount(block.count),
    borderColor: normalizeColor(block.borderColor, "#262626"),
    // Рамка тонша за лінію-роздільник: 1pt — це те, що на затвердженій формі
    // виглядає як клітинка, а не як обведення таблиці.
    lineWidth: clampNumber(parseTemplateNumber(block.lineWidth, 1), 0.25, 6),
  };
}

/**
 * Значення → клітинки. Довжина результату завжди дорівнює `count`; клітинка без
 * символу лишається порожньою.
 *
 * `align` каже, ДЕ саме значення сидить у рамці, а не як воно виглядає всередині
 * клітинки: символ у своїй клітинці завжди центрований — так надруковані всі
 * затверджені форми. Виходить одне правило на два нових блоки: вирівнювання
 * діє вздовж напрямку читання.
 *
 * Значення, довше за рамку, обрізається — покласти зайві символи нікуди, а
 * розтягнути рамку рендерер не має права: кількість клітинок задана
 * ЗАТВЕРДЖЕНОЮ формою. Обрізається при цьому той бік, який вирівнювання назвало
 * неважливим: при `left` лишається початок, при `right` — хвіст.
 */
export function distributePrintTemplateCharCells(
  value: string,
  count: number,
  align: PrintTemplateColumnAlign = "left",
): string[] {
  // Посимвольно за кодовими точками, а не по `charAt`: сурогатна пара — один
  // знак, і різати її навпіл означало б надрукувати дві порожні рамки.
  const characters = [...value];
  const cells = new Array<string>(count).fill("");

  const offset = align === "right"
    ? count - characters.length
    : align === "center"
    ? Math.floor((count - characters.length) / 2)
    : 0;

  characters.forEach((character, index) => {
    const cell = offset + index;
    if (cell >= 0 && cell < count) cells[cell] = character;
  });

  return cells;
}

export function resolvePrintTemplateLineOptions(block: PrintTemplateHorizontalLineBlock | PrintTemplateVerticalLineBlock): ResolvedPrintTemplateLineOptions {
  return {
    color: normalizeColor(block.color, "#595959"),
    lineStyle: normalizeLineStyle(block.lineStyle),
    lineWidth: clampNumber(parseTemplateNumber(block.lineWidth, 2), 1, 12),
  };
}
