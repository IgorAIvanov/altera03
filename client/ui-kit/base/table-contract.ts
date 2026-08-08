/**
 * Спільний контракт табличних екранів: опис колонки, форма `$root` і дрібні
 * помічники розмітки комірки. Ані DOM-класу, ані стану — самі лише типи й
 * чисті функції.
 *
 * Модуль існує заради ГРАФА ІМПОРТІВ, а не заради охайності. Усе це лежало в
 * `model-list-base.ts`, і `ModelPickerBase` імпортував звідти `listRootSchema`,
 * `alignClass` і `cellStyle` — імпортом ЗНАЧЕНЬ, тобто справжнім ребром часу
 * виконання (типи стираються, значення — ні). Через це чанк діалогу підбору
 * (6.8 kB) тягнув за собою чанк списку (28.8 kB) з побічно підключеним
 * `<ui-group-tree>` і статичним `xlsx` (7.4 kB) — ~36 kB, з яких пікер не
 * використовує нічого: ні тулбара, ні ієрархії, ні вивантаження.
 *
 * Та сама пастка, що вже описана в CLAUDE.md двічі: розділення
 * `model-registry` / `ts-commands` і структурний `FormSection` у `BaseUI`.
 * Правило спільне — спільним модулем робиться те, що НЕ тягне за собою поведінку.
 *
 * Тому сюди не переїжджає нічого, що імпортує компонент чи побічний ефект: як
 * тільки тут з'явиться `import "../components/…"`, зв'язок відновиться мовчки.
 */
import { html, type TemplateResult } from "lit";
import {
  type TArray,
  type TObject,
  type TRecord,
  type TString,
  type TUnknown,
  Type,
} from "@sinclair/typebox";
import { QuerySchema, TotalsSchema, type Query, type Totals } from "@client/shared/schema.ts";

export type SortDir = "asc" | "desc";

/**
 * Форма `$root` списку: службові `$query` і `$filters` + дані `rows`/`totals`.
 *
 * `$filters` — значення передвизначених фільтрів бічної панелі, окремо від
 * `$query`: `$query` має сталу схему (пошук, сторінка, сортування), а набір
 * фільтрів свій у кожного екрана. `$`-префікс за контрактом `$root` означає
 * службовий стан — його не бачить ані відстеження змін форми, ані вивантаження.
 *
 * Двонаправлений так само, як `$query`: клієнт шле фільтр у payload (ключ
 * `filters`), SQL його розбирає і може повернути ефективний варіант ключем
 * `$filters` — `assign()` віддзеркалить його назад у панель.
 */
export type ListRoot<Row> = {
  $query: Query;
  $filters: Record<string, unknown>;
  rows: Row[];
  totals: Totals;
};

/**
 * Опису фільтрів тут немає навмисно.
 *
 * Спроба оголошувати їх декларативно, як колонки (`kind: "select" | "check" |
 * "text"`), не витримала першої ж перевірки реальністю: найчастіші фільтри
 * облікового списку — це дата й період, тобто саме `<ui-date>` і `<ui-period>`,
 * а вбудувати їх у перелік видів означало б затягти обидва компоненти в основу
 * табличних екранів — і в кожен список, і в кожен діалог підбору.
 *
 * Набір фільтрів свій у кожної форми, тож розмітку дає форма: будь-які
 * контроли, ручна розмітка, свої обробники. Основа дає лише панель і
 * зв'язування зі станом (`$root.$filters` + `setFilter`/`bindFilter`) —
 * див. `QueryTableBase.renderFilters()`.
 */

/**
 * Generic root-схема списку/пікера для `Value.Create`: форма рядка важлива лише
 * на рівні TS-типу (`Row`), а для ініціалізації достатньо порожнього `rows`.
 * Тож підкласам не потрібен власний конструктор чи `<Model>RootSchema`.
 * Спільна для `ModelListBase` та `ModelPickerBase`.
 */
export const listRootSchema: TObject<{
  $query: typeof QuerySchema;
  $filters: TRecord<TString, TUnknown>;
  rows: TArray<TUnknown>;
  totals: typeof TotalsSchema;
}> = Type.Object({
  $query:   QuerySchema,
  // Форма вільна: набір фільтрів свій у кожного екрана, а спільного в них лише
  // те, що це пари «ключ payload → значення».
  $filters: Type.Record(Type.String(), Type.Unknown(), { default: {} }),
  rows:     Type.Array(Type.Unknown()),
  totals:   TotalsSchema,
});

/** Описание однієї колонки списку. */
export interface ListColumn<Row> {
  /** Ключ поля у рядку та значення sortBy для сервера. */
  key: string;
  /** Заголовок колонки — ключ локалізації або літерал (проходить через t()). */
  title: string;
  /** Ширина CSS, напр. "8rem". Без значення — гнучка колонка. */
  width?: string;
  align?: "left" | "right" | "center";
  /**
   * Поведінка тексту в комірці:
   *  - "wrap" (за замовч.) — переноситься на кілька рядків;
   *  - "nowrap" — один рядок без переносу;
   *  - "ellipsis" — один рядок, обрізається з "…" (потребує `width`).
   */
  overflow?: "wrap" | "nowrap" | "ellipsis";
  /** Приглушений текст (вторинні дані: коди, дати). */
  muted?: boolean;
  /**
   * Шаблон дати/часу для комірки — значення з БД приходить в ISO, а показати
   * треба по-людськи. Приклади: `dateFormat.date` ("DD.MM.YY"),
   * `dateFormat.dateTime`, `"MM.YYYY"`. Див. `client/shared/datetime.ts`.
   * Ігнорується, якщо задано `render`.
   */
  format?: string;
  sortable?: boolean;
  /** Нативний tooltip комірки (атрибут title). */
  tooltip?: (row: Row) => string;
  /**
   * Текст комірки для вивантаження в Excel. Потрібен колонкам, де `render`
   * малює не текст (посилання, бейдж, вкладений об'єкт): у файл піде рядок,
   * а не розмітка. Без нього береться `row[key]`, якщо це скаляр.
   */
  exportText?: (row: Row) => string;
  /**
   * `false` — колонку не вивантажувати. Колонка без заголовка (кнопки дій) і
   * так не потрапляє у файл: заголовок — ознака того, що колонка з даними.
   */
  export?: boolean;
  /**
   * Кастомний рендер комірки. За замовчуванням — row[key].
   * Сюди можна повернути кнопки, бейджі, дворядковий вміст тощо.
   * Для кнопок гортай обробник через `stopRow(...)`, щоб клік не виділяв рядок.
   */
  render?: (row: Row) => TemplateResult | string;
}

/**
 * Підсумки сторінки списку.
 *
 * У самому репозиторії не вживається жодного разу — фактичні підсумки їдуть
 * типом `Totals` зі `shared/schema.ts`. Лишається тут як опублікована
 * поверхня `@altera/client`: прибирати його треба окремо й свідомо, разом із
 * підняттям мінорної версії, а не побічним ефектом переїзду файлів.
 */
export interface ListTotals {
  count: number;
  page: number;
  pageSize: number;
}

/** CSS-клас вирівнювання для th/td. */
export function alignClass(align?: string): string {
  return align === "right" ? "text-right" : align === "center" ? "text-center" : "";
}

/** Inline-стиль комірки: перенос/обрізка тексту + max-width для ellipsis. */
export function cellStyle<Row>(col: ListColumn<Row>): string {
  const parts: string[] = [];
  if (col.overflow === "nowrap") parts.push("white-space:nowrap");
  if (col.overflow === "ellipsis") {
    parts.push("white-space:nowrap", "overflow:hidden", "text-overflow:ellipsis");
    if (col.width) parts.push(`max-width:${col.width}`);
  }
  return parts.join(";");
}

/**
 * Обгортка обробника події в комірці, що зупиняє спливання —
 * клік по кнопці в рядку не виділяє/не активує рядок.
 * Приклад: `@click=${stopRow(() => this.openEdit(row.id))}`
 */
export function stopRow(fn: (e: Event) => void): (e: Event) => void {
  return (e: Event) => { e.stopPropagation(); fn(e); };
}

/** Дворядкова комірка: основний текст + приглушений другий рядок. */
export function twoLine(primary: unknown, secondary?: unknown): TemplateResult {
  return html`
    <div class="leading-tight">
      <div>${primary}</div>
      ${secondary != null && secondary !== ""
        ? html`<div class="text-xs text-muted">${secondary}</div>`
        : ""}
    </div>
  `;
}
