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

type PickEvent = CustomEvent<{ id: string; label: string }>;
type ValueEvent = CustomEvent<{ value: string }>;

/** Селектор редагованого контрола всередині комірки. */
const CELL_CONTROL = "ui-picker, ui-decimal, ui-date, input, select";

// Рядки читаються з `$root` форми через сигнали — без SignalWatcher
// компонент не дізнавався б про зміни (секція чужого стану не тримає).
const Base = SignalWatcher(GlobalStyledLitElement);

export const tagName = "ui-tabular-table";

@customElement(tagName)
export class UiTabularTable extends Base {
  static override styles: CSSResultGroup = [tw, css`
    tr.current td { background: #eef4fb; }
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

    if (e.key === "Enter" && !e.shiftKey) {
      // Enter веде вправо; ui-decimal свій Enter (канонізація) не гасить —
      // подія долітає сюди вже після його обробки.
      const editable = this.#editableCols();
      const next = editable.find((c) => c > cell.col);
      e.preventDefault();
      if (next !== undefined) {
        this.#focusCell(cell.row, next);
      } else if (cell.row + 1 < section.rows.length) {
        this.#focusCell(cell.row + 1, editable[0] ?? 0);
      } else {
        section.addLine();
      }
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
        return html`<input class="cell-control" .value=${String(line[key] ?? "")}
          @input=${(e: Event) => section.patch(index, { [key]: (e.target as HTMLInputElement).value })} />`;
      case "checkbox":
        return html`<input type="checkbox" .checked=${line[key] === true}
          @change=${(e: Event) => section.patch(index, { [key]: (e.target as HTMLInputElement).checked })} />`;
      case "decimal":
        return html`<ui-decimal cell
          .precision=${col.precision ?? 2}
          .value=${String(line[key] ?? "")}
          @value-input=${(e: ValueEvent) => section.patch(index, { [key]: e.detail.value })}
          @value-changed=${(e: ValueEvent) => section.patch(index, { [key]: e.detail.value })}
        ></ui-decimal>`;
      case "date":
        return html`<ui-date cell
          .value=${String(line[key] ?? "")}
          @value-changed=${(e: ValueEvent) => section.patch(index, { [key]: e.detail.value })}
        ></ui-date>`;
      case "picker": {
        const refKey = col.refKey ?? (key.endsWith("Id") ? key.slice(0, -2) : key);
        const ref = line[refKey] as { id?: string; name?: string } | null;
        const display = col.displayField ?? "name";
        return html`<ui-picker cell
          url=${col.url ?? ""}
          fetch=${col.fetchCommand ?? "lookup"}
          display-field=${display}
          hint-field=${col.hintField ?? ""}
          ?show-clear=${col.showClear ?? false}
          .displayValue=${String((ref as Record<string, unknown> | null)?.[display] ?? "")}
          .selectedId=${String(line[key] ?? "")}
          @item-selected=${(e: PickEvent) =>
            section.patch(index, {
              [key]: e.detail.id,
              [refKey]: { id: e.detail.id, [display]: e.detail.label },
            })}
          @item-cleared=${() => section.patch(index, { [key]: "", [refKey]: null })}
        ></ui-picker>`;
      }
    }
  }

  #cellClass(col: TabularColumn<Record<string, unknown>>): string {
    const align = col.align ?? (col.kind === "decimal" || col.kind === "computed" ? "right" : "left");
    const parts: string[] = [];
    if (col.kind === "computed") parts.push("cell-text", "tabular-nums");
    if (col.kind === "checkbox") parts.push("text-center");
    if (align === "right") parts.push("text-right");
    if (align === "center" && col.kind !== "checkbox") parts.push("text-center");
    return parts.join(" ");
  }

  // ── Рендер ─────────────────────────────────────────────────────────────────

  override render(): TemplateResult {
    const section = this.section;
    if (!section) return html``;

    const columns = section.visibleColumns();
    const totals = columns.some((c) => c.total);
    // Колонок у рядку: [#] + колонки + [кошик]
    const colCount = columns.length + (section.showLineNo ? 1 : 0) + (section.rowDelete ? 1 : 0);

    return html`
      <table class="table table-sm w-full table-tabular"
        @keydown=${this.#onKeyDown} @focusin=${this.#onFocusIn}>
        <thead>
          <tr>
            ${section.showLineNo ? html`<th class="w-10">#</th>` : nothing}
            ${columns.map((col) => html`
              <th style=${col.width ? `width:${col.width}` : ""}
                class=${col.align === "right" || col.kind === "decimal" || col.kind === "computed" ? "text-right" : ""}>
                ${col.title ? t(col.title) : ""}
              </th>
            `)}
            ${section.rowDelete ? html`<th class="w-10"></th>` : nothing}
          </tr>
        </thead>
        <tbody>
          ${section.rows.map((line, i) => html`
            <tr class=${i === section.currentIndex ? "current" : ""}
              @click=${() => section.select(i)}>
              ${section.showLineNo
                ? html`<td class="cell-text">${section.lineNoKey ? String(line[section.lineNoKey] ?? i + 1) : i + 1}</td>`
                : nothing}
              ${columns.map((col, c) => html`
                <td data-row=${i} data-col=${c} class=${this.#cellClass(col)}>
                  ${this.#cellContent(col, line, i)}
                </td>
              `)}
              ${section.rowDelete
                ? html`
                  <td class="text-center">
                    <button class="btn btn-ghost btn-xs text-error" title=${t("tabular.delete")}
                      @click=${(e: Event) => { e.stopPropagation(); section.removeLine(i); }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    </button>
                  </td>`
                : nothing}
            </tr>
          `)}
          ${section.rows.length === 0
            ? html`<tr><td colspan=${colCount} class="text-center text-base-content/40 py-4">${t("common.noData")}</td></tr>`
            : nothing}
        </tbody>
        ${totals ? this.#renderTotals(columns, section) : nothing}
      </table>
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
