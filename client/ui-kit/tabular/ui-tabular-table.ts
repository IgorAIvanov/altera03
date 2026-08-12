/**
 * Таблична частина документа — ПОДАННЯ таблиці (логіка — tabular-section.ts).
 *
 * Самодостатній компонент: приймає секцію властивістю `.section` і малює
 * table-tabular за її конфігурацією колонок. Можна не використовувати —
 * намалювати таблицю руками, секція про це не дізнається.
 *
 * Клавіатура (операторський ввід, як в 1С):
 *  - Enter — наступна редагована комірка; в останній комірці останнього
 *    рядка — новий рядок;
 *  - ↑/↓ — та сама колонка сусіднього рядка (не перехоплюються в ui-picker:
 *    його випадний список сам живе на клавіатурі);
 *  - Insert — новий рядок; Ctrl+Delete — видалити поточний.
 * Tab лишається нативним: delegatesFocus у cell-контролів веде його сам.
 *
 * Слухаємо keydown/focusin на контейнері: обидві події composed, тож
 * долітають із shadow DOM контролів уже ретаргетнуті на їхні host-елементи.
 */
import { css, type CSSResultGroup, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { GlobalStyledLitElement } from "../base/gsle.ts";
import { tw } from "../../shared/styles.ts";
import { t } from "../../locale.ts";
import { dec, type TabularColumn, type TabularSection } from "./tabular-section.ts";
import "../components/ui-picker.ts";
import "../components/ui-decimal.ts";
import "../components/ui-date.ts";
import "../components/ui-select.ts";
import { icons } from "../icons.ts";

type PickEvent = CustomEvent<{ value: Record<string, unknown> | null }>;
type ValueEvent = CustomEvent<{ value: string }>;

/** Селектор редагованого контрола всередині комірки. */
const CELL_CONTROL = "ui-picker, ui-decimal, ui-date, input, select";

// Рядки читаються з `$root` форми через сигнали — без SignalWatcher
// компонент не дізнавався б про зміни (секція чужого стану не тримає).
const Base: typeof GlobalStyledLitElement = SignalWatcher(GlobalStyledLitElement);

export const tagName = "ui-tabular-table";

@customElement(tagName)
export class UiTabularTable extends Base {
  static override styles: CSSResultGroup = [tw, css`
    tr.current td { background: #eef4fb; }
    /* Невалідна комірка. У комірці рамки немає взагалі (.cell-control її
       знімає — межу малює сама таблиця), тому сигнал інший: заливка й
       внутрішній контур. Правило нижче за "tr.current td" навмисно — у
       виділеному рядку помилка має лишатися видимою.
       Зворотних лапок тут бути не може — це тіло шаблонного рядка css. */
    tr td.cell-invalid {
      background: #fdecec;
      outline: 1px solid var(--color-error);
      outline-offset: -1px;
    }
  `];

  @property({ attribute: false }) section?: TabularSection<Record<string, unknown>>;

  #bound?: TabularSection<Record<string, unknown>>;

  protected override willUpdate() {
    if (this.section !== this.#bound) {
      this.#bound?.unbind(this);
      this.section?.bind(this);
      this.#bound = this.section;
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#bound?.unbind(this);
    this.#bound = undefined;
  }

  protected override updated() {
    const focus = this.section?.pendingFocus;
    if (!focus) return;
    this.section!.pendingFocus = null;
    this.#focusCell(focus.row, focus.col);
  }

  // ── Фокус і клавіатура ─────────────────────────────────────────────────────

  #cellAt(row: number, col: number): HTMLTableCellElement | null {
    return this.renderRoot.querySelector(`td[data-row="${row}"][data-col="${col}"]`);
  }

  #focusCell(row: number, col: number): boolean {
    const control = this.#cellAt(row, col)?.querySelector<HTMLElement>(CELL_CONTROL);
    if (!control) return false;
    control.focus();
    return true;
  }

  /** Комірка події — з composedPath, бо target ретаргетнутий на host контрола. */
  #eventCell(e: Event): { row: number; col: number } | null {
    for (const el of e.composedPath()) {
      if (el instanceof HTMLTableCellElement && el.dataset.row !== undefined) {
        return { row: Number(el.dataset.row), col: Number(el.dataset.col) };
      }
    }
    return null;
  }

  #onFocusIn = (e: Event) => {
    const cell = this.#eventCell(e);
    if (cell) this.section?.select(cell.row);
  };

  #editableCols(): number[] {
    const section = this.section!;
    const cols: number[] = [];
    section.visibleColumns().forEach((col, i) => {
      if (col.kind !== "computed") cols.push(i);
    });
    return cols;
  }

  #onKeyDown = (e: KeyboardEvent) => {
    const section = this.section;
    if (!section) return;

    // У режимі перегляду клавіатура секції мовчить цілком: рядки не додаються,
    // не видаляються, і Enter не створює новий у кінці таблиці.
    if (section.readonly) return;

    if (e.key === "Insert") {
      e.preventDefault();
      section.addLine();
      return;
    }
    if (e.key === "Delete" && e.ctrlKey) {
      e.preventDefault();
      section.removeLine();
      return;
    }

    const cell = this.#eventCell(e);
    if (!cell) return;
    const inPicker = e.composedPath().some((el) =>
      el instanceof HTMLElement && el.tagName === "UI-PICKER"
    );

    // Ctrl+Enter — не наш Enter: це кнопка за замовчуванням форми, і секція
    // мусить його пропустити. Без цієї умови таблиця з'їдала б його разом із
    // preventDefault, і в документі з табличною частиною — тобто саме там, де
    // сполучення й потрібне, — воно не працювало б узагалі.
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // Enter веде вправо (порядок — оголошення колонок, підрядкові після
      // сіткових); ui-decimal свій Enter (канонізація) не гасить — подія
      // долітає сюди вже після його обробки. Спроби по черзі: custom-комірка
      // може не мати контрола (тире валюти) — фокус не вдався, йдемо далі.
      const editable = this.#editableCols();
      e.preventDefault();
      for (const c of editable) {
        if (c > cell.col && this.#focusCell(cell.row, c)) return;
      }
      if (cell.row + 1 < section.rows.length) {
        for (const c of editable) {
          if (this.#focusCell(cell.row + 1, c)) return;
        }
        return;
      }
      section.addLine();
      return;
    }

    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !inPicker) {
      const target = cell.row + (e.key === "ArrowUp" ? -1 : 1);
      if (target < 0 || target >= section.rows.length) return;
      e.preventDefault();
      this.#focusCell(target, cell.col);
    }
  };

  // ── Комірки ────────────────────────────────────────────────────────────────

  #cellContent(
    col: TabularColumn<Record<string, unknown>>,
    line: Record<string, unknown>,
    index: number,
  ): TemplateResult | string {
    const section = this.section!;
    const key = col.key ?? "";
    switch (col.kind) {
      case "custom":
        return col.render?.(line, index) ?? "";
      case "computed":
        return html`${col.value?.(line) ?? ""}`;
      case "text":
        return html`<input class="cell-control" ?disabled=${section.readonly}
          .value=${String(line[key] ?? "")}
          @input=${(e: Event) => section.patch(index, { [key]: (e.target as HTMLInputElement).value })} />`;
      case "checkbox":
        return html`<input type="checkbox" ?disabled=${section.readonly} .checked=${line[key] === true}
          @change=${(e: Event) => section.patch(index, { [key]: (e.target as HTMLInputElement).checked })} />`;
      case "decimal":
        return html`<ui-decimal cell ?disabled=${section.readonly}
          .precision=${col.precision ?? 2}
          .value=${String(line[key] ?? "")}
          @value-input=${(e: ValueEvent) => section.patch(index, { [key]: e.detail.value })}
          @value-changed=${(e: ValueEvent) => section.patch(index, { [key]: e.detail.value })}
        ></ui-decimal>`;
      case "date":
        return html`<ui-date cell ?disabled=${section.readonly}
          .value=${String(line[key] ?? "")}
          @value-changed=${(e: ValueEvent) => section.patch(index, { [key]: e.detail.value })}
        ></ui-date>`;
      case "picker": {
        const refKey = col.refKey ?? (key.endsWith("Id") ? key.slice(0, -2) : key);
        const ref = line[refKey] as { id?: string; name?: string } | null;
        const display = col.displayField ?? "name";
        // Значення комірки — сам об'єкт ссылки; id рядок тримає окремо, бо
        // саме його чекає `save` табличної частини. Пишуться обидва з ОДНІЄЇ
        // події, тож розійтися їм нема як.
        return html`<ui-picker cell ?disabled=${section.readonly}
          url=${col.url ?? ""}
          display-field=${display}
          hint-field=${col.hintField ?? ""}
          ?show-clear=${col.showClear ?? false}
          .value=${ref ?? null}
          @value-changed=${(e: PickEvent) =>
            section.patch(index, {
              [key]: String(e.detail.value?.id ?? ""),
              [refKey]: e.detail.value,
            })}
        ></ui-picker>`;
      }
    }
  }

  #cellClass(col: TabularColumn<Record<string, unknown>>, index: number): string {
    const align = col.align ?? (col.kind === "decimal" || col.kind === "computed" ? "right" : "left");
    const parts: string[] = [];
    if (col.kind === "computed") parts.push("cell-text", "tabular-nums");
    if (col.kind === "checkbox") parts.push("text-center");
    if (align === "right") parts.push("text-right");
    if (align === "center" && col.kind !== "checkbox") parts.push("text-center");
    if (this.section?.cellError(index, col)) parts.push("cell-invalid");
    return parts.join(" ");
  }

  /**
   * Текст помилки їде в `title` комірки, а не окремим підписом: у щільній
   * таблиці зайвий рядок під коміркою поламав би сітку, а сама підсвітка
   * каже, ЩО не так, лише наполовину. Повний текст першої помилки форма
   * додатково показує банером — див. `TabularSection.firstErrorText()`.
   */
  #cellTitle(col: TabularColumn<Record<string, unknown>>, index: number) {
    return this.section?.cellError(index, col) || nothing;
  }

  // ── Рендер ─────────────────────────────────────────────────────────────────

  /** Колонки сітки (row 1) — вони визначають ширини всієї таблиці. */
  #grid(columns: Array<TabularColumn<Record<string, unknown>>>) {
    return columns.filter((c) => (c.row ?? 1) <= 1);
  }

  /** Рівні підрядків (row ≥ 2), за зростанням. */
  #subLevels(columns: Array<TabularColumn<Record<string, unknown>>>): number[] {
    return [...new Set(columns.map((c) => c.row ?? 1).filter((r) => r >= 2))].sort((a, b) => a - b);
  }

  override render(): TemplateResult {
    const section = this.section;
    if (!section) return html``;

    const columns = section.visibleColumns();
    const grid = this.#grid(columns);
    const levels = this.#subLevels(columns);
    const totals = grid.some((c) => c.total);
    // Колонок сітки в рядку: [#] + сітка + [кошик]
    const colCount = grid.length + (section.showLineNo ? 1 : 0) + (section.rowDelete ? 1 : 0);

    return html`
      <table class="table table-sm w-full table-tabular"
        @keydown=${this.#onKeyDown} @focusin=${this.#onFocusIn}>
        ${this.#renderHead(columns, section)}
        <tbody>
          ${section.rows.map((line, i) => this.#renderRecord(line, i, columns, grid, levels))}
          ${section.rows.length === 0
            ? html`<tr><td colspan=${colCount} class="text-center text-muted py-4">${t("common.noData")}</td></tr>`
            : nothing}
        </tbody>
        ${totals ? this.#renderTotals(grid, section) : nothing}
      </table>
    `;
  }

  /**
   * Один запис = 1 + N рядків `<tr>` (N — рівні підрядків). Ячейки підрядка
   * лягають під сітку зліва направо, ширина — `span` у колонках сітки;
   * залишок добивається порожньою ячейкою. № і кошик — rowspan на весь запис.
   */
  #renderRecord(
    line: Record<string, unknown>,
    i: number,
    columns: Array<TabularColumn<Record<string, unknown>>>,
    grid: Array<TabularColumn<Record<string, unknown>>>,
    levels: number[],
  ): TemplateResult {
    const section = this.section!;
    const recordSpan = 1 + levels.length;
    const cur = i === section.currentIndex ? "current" : "";
    return html`
      <tr class=${cur} @click=${() => section.select(i)}>
        ${section.showLineNo
          ? html`<td class="cell-text" rowspan=${recordSpan}>
              ${section.lineNoKey ? String(line[section.lineNoKey] ?? i + 1) : i + 1}
            </td>`
          : nothing}
        ${grid.map((col) => html`
          <td data-row=${i} data-col=${columns.indexOf(col)} class=${this.#cellClass(col, i)}
            title=${this.#cellTitle(col, i)}>
            ${this.#cellContent(col, line, i)}
          </td>
        `)}
        ${section.rowDelete
          ? html`
            <td class="text-center" rowspan=${recordSpan}>
              <!-- Хрестик і колір шрифту — той самий значок, що в панелі дій
                   секції: дія прибирає рядок, а не позначає запис на видалення. -->
              <button class="btn btn-ghost btn-xs" title=${t("tabular.delete")}
                @click=${(e: Event) => { e.stopPropagation(); section.removeLine(i); }}>
                ${icons.clear}
              </button>
            </td>`
          : nothing}
      </tr>
      ${levels.map((level) => {
        const subs = columns.filter((c) => (c.row ?? 1) === level);
        const used = subs.reduce((s, c) => s + (c.span ?? 1), 0);
        const pad = grid.length - used;
        return html`
          <tr class=${cur} @click=${() => section.select(i)}>
            ${subs.map((col) => html`
              <td colspan=${col.span ?? 1} data-row=${i} data-col=${columns.indexOf(col)}
                class=${this.#cellClass(col, i)} title=${this.#cellTitle(col, i)}>
                ${this.#cellContent(col, line, i)}
              </td>
            `)}
            ${pad > 0 ? html`<td colspan=${pad}></td>` : nothing}
          </tr>
        `;
      })}
    `;
  }

  #leafTh(col: TabularColumn<Record<string, unknown>>, rowspan = 1): TemplateResult {
    const right = col.align === "right" || col.kind === "decimal" || col.kind === "computed";
    return html`
      <th rowspan=${rowspan} style=${col.width ? `width:${col.width}` : ""}
        class=${right ? "text-right" : ""}>
        ${col.title ? t(col.title) : ""}
      </th>
    `;
  }

  /**
   * Шапка. Однорядна, доки колонки сітки не оголосили `group`; з групами —
   * два ряди: суміжні колонки однієї групи накриті спільною ячейкою
   * (colspan), негруповані розтягнуті на обидва ряди (rowspan). Підрядки
   * (row ≥ 2) додають свій ряд заголовків, лише якщо мають хоч один title.
   */
  #renderHead(
    columns: Array<TabularColumn<Record<string, unknown>>>,
    section: TabularSection<Record<string, unknown>>,
  ): TemplateResult {
    const grid = this.#grid(columns);
    const hasGroups = grid.some((c) => c.group);
    const subHeaderLevels = this.#subLevels(columns).filter((level) =>
      columns.some((c) => (c.row ?? 1) === level && c.title)
    );
    const headRows = (hasGroups ? 1 : 0) + 1 + subHeaderLevels.length;

    const gridRow: TemplateResult[] = [];
    const groupRow: TemplateResult[] = [];
    if (hasGroups) {
      let i = 0;
      while (i < grid.length) {
        const col = grid[i];
        if (col.group) {
          let span = 1;
          while (i + span < grid.length && grid[i + span].group === col.group) span++;
          groupRow.push(html`<th colspan=${span} class="text-center">${t(col.group)}</th>`);
          for (let k = i; k < i + span; k++) gridRow.push(this.#leafTh(grid[k]));
          i += span;
        } else {
          groupRow.push(this.#leafTh(col, 2));
          i++;
        }
      }
    }

    const subRows = subHeaderLevels.map((level) => {
      const subs = columns.filter((c) => (c.row ?? 1) === level);
      const used = subs.reduce((s, c) => s + (c.span ?? 1), 0);
      const pad = grid.length - used;
      return html`
        <tr>
          ${subs.map((col) => html`
            <th colspan=${col.span ?? 1}>${col.title ? t(col.title) : ""}</th>
          `)}
          ${pad > 0 ? html`<th colspan=${pad}></th>` : nothing}
        </tr>
      `;
    });

    return html`
      <thead>
        <tr>
          ${section.showLineNo ? html`<th class="w-10" rowspan=${headRows}>#</th>` : nothing}
          ${hasGroups ? groupRow : grid.map((col) => this.#leafTh(col))}
          ${section.rowDelete ? html`<th class="w-10" rowspan=${headRows}></th>` : nothing}
        </tr>
        ${hasGroups ? html`<tr>${gridRow}</tr>` : nothing}
        ${subRows}
      </thead>
    `;
  }

  /**
   * Підвал: підпис «Разом» займає все до першої total-колонки, під кожною
   * total-колонкою — її сума, решта — порожні th.
   */
  #renderTotals(
    columns: Array<TabularColumn<Record<string, unknown>>>,
    section: TabularSection<Record<string, unknown>>,
  ): TemplateResult {
    const firstTotal = columns.findIndex((c) => c.total);
    const labelSpan = firstTotal + (section.showLineNo ? 1 : 0);
    return html`
      <tfoot>
        <tr>
          ${labelSpan > 0
            ? html`<th colspan=${labelSpan} class="text-right">${t("tabular.total")}</th>`
            : nothing}
          ${columns.slice(firstTotal).map((col) => html`
            <th class="text-right tabular-nums">
              ${col.total ? this.#columnTotal(col, section) : ""}
            </th>
          `)}
          ${section.rowDelete ? html`<th></th>` : nothing}
        </tr>
      </tfoot>
    `;
  }

  #columnTotal(
    col: TabularColumn<Record<string, unknown>>,
    section: TabularSection<Record<string, unknown>>,
  ): string {
    const precision = col.precision ?? 2;
    const value = (line: Record<string, unknown>) =>
      col.value ? dec(col.value(line)) : dec(line[col.key ?? ""]);
    return section.rows.reduce((s, l) => s.plus(value(l)), dec(0)).toFixed(precision);
  }
}
