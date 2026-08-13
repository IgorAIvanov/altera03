import { GlobalStyledLitElement } from "../base/gsle.ts";
import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { getLocale, t } from "../../locale.ts";
import { placePopover, POPOVER_ANCHORED_STYLE } from "../popover.ts";
import {
  dateFormat,
  daysInMonth,
  formatDate,
  parseDate,
  todayIso,
  toParts,
} from "../../shared/datetime.ts";

/**
 * Поле дати/часу з випадним календарем.
 *
 * `value` — завжди ISO (`YYYY-MM-DD` або `YYYY-MM-DDTHH:mm:ss`), тобто те, що
 * приймає й віддає PostgreSQL. Атрибут `format` керує лише відображенням і
 * розбором вводу, а заразом і тим, ЯКУ ЧАСТИНУ дати показуємо:
 *
 * ```html
 * <ui-date value="2026-07-20"></ui-date>                    <!-- 20.07.26 -->
 * <ui-date format="DD.MM.YYYY"></ui-date>                   <!-- 20.07.2026 -->
 * <ui-date format="DD.MM.YY HH:mm"></ui-date>               <!-- 20.07.26 09:05 -->
 * <ui-date format="MM.YYYY"></ui-date>                      <!-- 07.2026, календар по місяцях -->
 * <ui-date format="HH:mm"></ui-date>                        <!-- 09:05, без календаря -->
 * ```
 *
 * Поведінка редагування — як в `ui-decimal`:
 *  - вхід у поле (Tab або клік) виділяє все значення;
 *  - під час набору текст не переформатовується;
 *  - канонічний вигляд — на blur / Enter; нерозбірливий ввід чиститься;
 *  - Esc повертає значення, що було на вході;
 *  - ↑/↓ змінюють дату на день (з відкритим календарем — рухають курсор).
 *
 * Подія `value-changed` з `detail.value` (ISO або `""`) — на комміт.
 */
@customElement("ui-date")
export class UiDate extends GlobalStyledLitElement {
  /** host.focus() веде у внутрішній input — без цього клавіатурний обхід
      табличної частини (ui-tabular-table) не міг би сфокусувати комірку. */
  static override shadowRootOptions: ShadowRootInit = {
    ...GlobalStyledLitElement.shadowRootOptions,
    delegatesFocus: true,
  };

  /** ISO-значення: `YYYY-MM-DD` | `YYYY-MM-DDTHH:mm:ss` | `""`. */
  @property({ type: String }) value = "";
  /** Шаблон відображення/розбору: `DD.MM.YY`, `MM.YYYY`, `HH:mm` ... */
  @property({ type: String }) format: string = dateFormat.date;
  @property({ type: String }) label = "";
  /** Позначка обов'язковості біля підпису — зірочка, як у renderField() форм. */
  @property({ type: Boolean }) required = false;
  /** Текст помилки поля; непорожній — рамка червона (див. theme.css, :host([invalid])). */
  @property({ type: String, reflect: true }) invalid = "";
  @property({ type: String, attribute: "label-position" }) labelPosition: "top" | "left" = "top";
  @property({ type: String }) placeholder = "";
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) readonly = false;
  /** Кнопка очищення поля. */
  @property({ type: Boolean, attribute: "show-clear" }) showClear = false;
  /** Розмір daisyUI-інпута: `xs` | `sm` | `md` | `lg`. Порожньо — типовий. */
  @property({ type: String }) size: "" | "xs" | "sm" | "md" | "lg" = "";
  @property({ type: String }) width = "";
  /**
   * Режим комірки табличної частини: контрол заповнює `<td>` цілком —
   * без рамки, заокруглень і зовнішніх відступів. `<td>` має бути `p-0`.
   */
  @property({ type: Boolean, reflect: true }) cell = false;
  @property({ type: Boolean }) visible = true;

  /** Текст під час редагування; `null` — поле не редагується. */
  @state() private _draft: string | null = null;
  /** Місяць, відкритий у календарі (ISO першого числа). */
  @state() private _view = "";
  @state() private _open = false;

  /** Значення на момент входу у поле — для відкату по Esc. */
  private _entryValue = "";

  @query("input") private _input?: HTMLInputElement;
  @query("[popover]") private _popover?: HTMLElement;

  /** Чи має шаблон календарну частину (для `HH:mm` кнопка календаря зайва). */
  private get _hasDate(): boolean {
    return /YYYY|YY|MM|DD/.test(this.format);
  }

  /** Шаблон без дня (`MM.YYYY`) — календар вибирає місяць, а не число. */
  private get _monthOnly(): boolean {
    return this._hasDate && !/DD/.test(this.format);
  }

  private get _display(): string {
    return formatDate(this.value, this.format);
  }

  // ── Редагування тексту ────────────────────────────────────────────────────

  private _selectAll() {
    const input = this._input;
    if (input) input.setSelectionRange(0, input.value.length);
  }

  /**
   * Перший клік по незафокусованому полю: фокусуємо самі, щоб `focus`
   * виділив усе значення — так само, як при вході по Tab.
   */
  private _onPointerDown(e: PointerEvent) {
    if (this.disabled || this.readonly) return;
    const input = this._input;
    if (!input || this.shadowRoot?.activeElement === input) return;
    e.preventDefault();
    input.focus();
  }

  private _onFocus() {
    this._entryValue = this.value;
    this._draft = this._display;
    requestAnimationFrame(() => this._selectAll());
  }

  private _onInput(e: Event) {
    this._draft = (e.target as HTMLInputElement).value;
  }

  /** Розбирає чернетку й повідомляє про зміну. Нерозбірливий ввід → "". */
  private _commit() {
    const draft = this._draft;
    this._draft = null;
    if (draft === null) return;
    const next = draft.trim() === "" ? "" : parseDate(draft, this.format, this.value);
    this._set(next);
  }

  private _set(next: string) {
    const changed = next !== this.value;
    this.value = next;
    if (changed) {
      this.dispatchEvent(new CustomEvent("value-changed", {
        detail: { value: next },
        bubbles: true,
        composed: true,
      }));
    }
  }

  /** Зсув на `days` днів (або `months` місяців) від поточного значення. */
  private _shift(days: number, months = 0) {
    const base = toParts(this.value) ?? toParts(todayIso())!;
    const d = new Date(Date.UTC(base.year, base.month - 1 + months, base.day + days));
    const iso = d.toISOString().slice(0, 10);
    const time = /HH|mm|ss/.test(this.format)
      ? `T${String(base.hour).padStart(2, "0")}:${String(base.minute).padStart(2, "0")}:${String(base.second).padStart(2, "0")}`
      : "";
    this._draft = null;
    this._set(iso + time);
    requestAnimationFrame(() => this._selectAll());
  }

  private _onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      if (this._open) this._close();
      this._commit();
      requestAnimationFrame(() => this._selectAll());
      return;
    }
    if (e.key === "Escape") {
      // Позначаємо клавішу обробленою: Esc в оболонці закриває вкладку, і без
      // цього відкат чернетки закривав би заразом усю форму.
      e.preventDefault();
      if (this._open) { this._close(); return; }
      this._draft = formatDate(this._entryValue, this.format);
      this.value = this._entryValue;
      requestAnimationFrame(() => this._selectAll());
      return;
    }
    if (!this._hasDate || this.readonly || this.disabled) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const step = e.key === "ArrowUp" ? 1 : -1;
      // спершу фіксуємо те, що вже набрано, потім рухаємо
      this._commit();
      this._monthOnly ? this._shift(0, step) : this._shift(step);
    }
  }

  // ── Календар ──────────────────────────────────────────────────────────────

  private _toggleCalendar() {
    this._open ? this._close() : this._openCalendar();
  }

  private _openCalendar() {
    this._view = (this.value && formatDate(this.value, "YYYY-MM-DD")) || todayIso();
    this._open = true;
  }

  private _close() {
    this._open = false;
    this._popover?.hidePopover();
  }

  /** Синхронізує popover із `_open` і тримає його під полем. */
  protected override updated() {
    const pop = this._popover;
    if (!pop) return;
    const shown = pop.matches(":popover-open");
    if (this._open && !shown) {
      pop.showPopover();
      // Розміщуємо ПІСЛЯ показу: у схованого елемента немає ширини, а календар
      // ширший за поле — без притискання він вилазив за правий край екрана.
      if (this._input) placePopover(pop, this._input);
    }
    if (!this._open && shown) pop.hidePopover();
  }

  /** Браузер закрив popover (Esc або клік назовні). */
  private _onPopoverToggle(e: Event) {
    if ((e as ToggleEvent).newState !== "closed") return;
    this._open = false;
    // клік назовні: blur уже відпрацював при відкритому календарі й нічого
    // не зафіксував — комітимо набране тут
    if (this.shadowRoot?.activeElement !== this._input) this._commit();
  }

  private _viewParts() {
    return toParts(this._view) ?? toParts(todayIso())!;
  }

  private _moveView(months: number) {
    const p = this._viewParts();
    const d = new Date(Date.UTC(p.year, p.month - 1 + months, 1));
    this._view = d.toISOString().slice(0, 10);
  }

  /** Вибір дня/місяця в календарі: зберігає час поточного значення. */
  private _pick(year: number, month: number, day: number) {
    const cur = toParts(this.value);
    const time = /HH|mm|ss/.test(this.format) && cur
      ? `T${String(cur.hour).padStart(2, "0")}:${String(cur.minute).padStart(2, "0")}:${String(cur.second).padStart(2, "0")}`
      : "";
    const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    this._draft = null;
    this._set(iso + time);
    this._close();
    this._input?.focus();
  }

  /** Назви днів тижня (пн-перший) мовою інтерфейсу. */
  private _weekdays(): string[] {
    const fmt = new Intl.DateTimeFormat(getLocale(), { weekday: "short" });
    // 2024-01-01 — понеділок
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
  }

  private _monthName(year: number, month: number): string {
    return new Intl.DateTimeFormat(getLocale(), { month: "long", year: "numeric" })
      .format(new Date(Date.UTC(year, month - 1, 1)));
  }

  /** Сітка 6×7: числа поточного місяця + добивка сусідніми (null). */
  private _grid(year: number, month: number): Array<number | null> {
    const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // пн = 0
    const total = daysInMonth(year, month);
    const cells: Array<number | null> = Array(firstWeekday).fill(null);
    for (let d = 1; d <= total; d++) cells.push(d);
    while (cells.length % 7) cells.push(null);
    return cells;
  }

  private _renderCalendar() {
    const view = this._viewParts();
    const sel = toParts(this.value);
    const today = toParts(todayIso())!;

    const header = html`
      <div class="flex items-center justify-between gap-1 mb-2">
        <button type="button" class="btn btn-ghost btn-xs" title="−1"
          @click=${() => this._moveView(this._monthOnly ? -12 : -1)}>‹</button>
        <span class="text-sm font-medium capitalize">
          ${this._monthOnly ? view.year : this._monthName(view.year, view.month)}
        </span>
        <button type="button" class="btn btn-ghost btn-xs" title="+1"
          @click=${() => this._moveView(this._monthOnly ? 12 : 1)}>›</button>
      </div>
    `;

    // Шаблон без дня — вибираємо місяць року, а не число.
    if (this._monthOnly) {
      const months = Array.from({ length: 12 }, (_, i) => i + 1);
      return html`
        ${header}
        <div class="grid grid-cols-3 gap-1">
          ${months.map((m) => {
            const active = sel && sel.year === view.year && sel.month === m;
            return html`
              <button type="button"
                class="btn btn-xs ${active ? "btn-primary" : "btn-ghost"}"
                @click=${() => this._pick(view.year, m, 1)}>
                ${new Intl.DateTimeFormat(getLocale(), { month: "short" })
                  .format(new Date(Date.UTC(view.year, m - 1, 1)))}
              </button>
            `;
          })}
        </div>
      `;
    }

    return html`
      ${header}
      <div class="grid grid-cols-7 gap-0.5 text-center">
        ${this._weekdays().map((w) => html`
          <span class="text-[0.65rem] uppercase text-muted py-1">${w}</span>
        `)}
        ${this._grid(view.year, view.month).map((d) => {
          if (d === null) return html`<span></span>`;
          const isSel = sel && sel.year === view.year && sel.month === view.month && sel.day === d;
          const isToday = today.year === view.year && today.month === view.month && today.day === d;
          return html`
            <button type="button"
              class="btn btn-xs btn-square ${isSel ? "btn-primary" : isToday ? "btn-outline" : "btn-ghost"}"
              @click=${() => this._pick(view.year, view.month, d)}>${d}</button>
          `;
        })}
      </div>
      <div class="flex justify-between mt-2 pt-2 border-t border-base-300">
        <button type="button" class="btn btn-ghost btn-xs"
          @click=${() => { const p = toParts(todayIso())!; this._pick(p.year, p.month, p.day); }}>
          ${t("common.today")}
        </button>
        ${this.showClear
          ? html`<button type="button" class="btn btn-ghost btn-xs text-error"
              @click=${() => { this._draft = null; this._set(""); this._close(); }}>✕</button>`
          : nothing}
      </div>
    `;
  }

  override render(): TemplateResult {
    if (!this.visible) return html``;

    const inputGroup = html`
      <div class="join w-full ${this.cell ? "cell-control" : ""}">
        <input
          type="text"
          inputmode="numeric"
          class="input join-item flex-1 min-w-0 ${this.size ? `input-${this.size}` : ""} ${
            // cell-control на обгортці знімає рамку — інпут усередині лишається пласким
            this.cell ? "" : "input-bordered"
          }"
          .value=${this._draft ?? this._display}
          placeholder=${this.placeholder || this.format}
          ?disabled=${this.disabled}
          ?readonly=${this.readonly}
          @pointerdown=${this._onPointerDown}
          @focus=${this._onFocus}
          @input=${this._onInput}
          @blur=${this._onBlur}
          @keydown=${this._onKeyDown}
        />
        ${this._hasDate && !this.readonly ? html`
          <button type="button" class="btn btn-square join-item ${this.size ? `btn-${this.size}` : "btn-sm"}"
            ?disabled=${this.disabled}
            @mousedown=${(e: Event) => e.preventDefault()}
            @click=${this._toggleCalendar}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </button>
        ` : ""}
      </div>
    `;

    const popover = html`
      <div
        popover
        @toggle=${this._onPopoverToggle}
        class="rounded-box shadow-lg p-2"
        style=${`${POPOVER_ANCHORED_STYLE} width:16rem; background:var(--color-base-100,#ffffff); border:1px solid var(--color-base-300,#d1d5db);`}
      >
        ${this._open ? this._renderCalendar() : ""}
      </div>
    `;

    // У комірці таблиці підпис не потрібен — жодних обгорток і відступів.
    if (this.cell) return html`${inputGroup}${popover}`;

    const style = this.width ? `width:${this.width}` : "";

    return html`
      ${this.labelPosition === "left"
        ? html`
          <div class="flex items-center gap-2" style=${style}>
            ${this.label ? html`<span class="label text-sm whitespace-nowrap">${this.label}${this.required ? html`<span class="field-required">*</span>` : ""}</span>` : ""}
            ${inputGroup}
          </div>
        `
        : html`
          <div class="flex flex-col gap-1 ${this.invalid ? "field-invalid" : ""}" style=${style}>
            ${this.label ? html`<span class="label text-sm leading-none">${this.label}${this.required ? html`<span class="field-required">*</span>` : ""}</span>` : ""}
            ${inputGroup}
            ${this.invalid ? html`<span class="field-error">${this.invalid}</span>` : ""}
          </div>
        `}
      ${popover}
    `;
  }

  /** Комміт по втраті фокуса — але не тоді, коли фокус пішов у календар. */
  private _onBlur() {
    if (this._open) return;
    this._commit();
  }
}
