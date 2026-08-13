import { GlobalStyledLitElement } from "../base/gsle.ts";
import { html, type TemplateResult } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { Decimal } from "decimal.js";

/**
 * Поле для редагування десяткових чисел.
 *
 * Поведінка редагування (аналог `decimalInput.tsx` з altera_danet, але вхід
 * мишею працює так само, як вхід по Tab):
 *  - вхід у поле (Tab або клік мишею) — виділяє все значення;
 *  - під час набору значення НЕ переформатовується (каретка не стрибає),
 *    дозволені проміжні стани `1`, `1.`, `,5`, `-`;
 *  - канонічне форматування (`precision` знаків) — тільки на blur / Enter;
 *  - Esc повертає значення, яке було на вході у поле.
 *
 * Події:
 *  - `value-input`   — на кожне натискання, `detail.value` — сирий текст;
 *  - `value-changed` — на комміт (blur / Enter), `detail.value` — канонічний рядок.
 */
@customElement("ui-decimal")
export class UiDecimal extends GlobalStyledLitElement {
  /** host.focus() веде у внутрішній input — без цього клавіатурний обхід
      табличної частини (ui-tabular-table) не міг би сфокусувати комірку. */
  static override shadowRootOptions: ShadowRootInit = {
    ...GlobalStyledLitElement.shadowRootOptions,
    delegatesFocus: true,
  };

  /** Канонічне значення як рядок (щоб не втрачати точність). */
  @property({ type: String }) value = "";
  /** Кількість знаків після коми: сума — 2, кількість — 3, курс — 6. */
  @property({ type: Number }) precision = 2;
  @property({ type: String }) label = "";
  @property({ type: Boolean }) required = false;
  /** Текст помилки поля; непорожній — рамка червона (див. theme.css, :host([invalid])). */
  @property({ type: String, reflect: true }) invalid = "";
  @property({ type: String, attribute: "label-position" }) labelPosition: "top" | "left" = "top";
  @property({ type: String }) placeholder = "";
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) readonly = false;
  /** Дозволити від'ємні значення. */
  @property({ type: Boolean, attribute: "allow-negative" }) allowNegative = false;
  /** Порожнє поле трактувати як `0` і форматувати (інакше лишається порожнім). */
  @property({ type: Boolean, attribute: "empty-as-zero" }) emptyAsZero = false;
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

  /** Значення на момент входу у поле — для відкату по Esc. */
  private _entryValue = "";

  @query("input") private _input?: HTMLInputElement;

  /** Канонічне представлення: `precision` знаків після коми. */
  private _format(raw: string): string {
    const s = raw.replace(/\s/g, "").replace(",", ".");
    if (s === "" || s === "-" || s === "." || s === "-.") {
      return this.emptyAsZero ? new Decimal(0).toFixed(this.precision) : "";
    }
    try {
      const d = new Decimal(s);
      const v = this.allowNegative ? d : Decimal.max(d, 0);
      return v.toFixed(this.precision);
    } catch {
      // нерозбірливий ввід — повертаємо попереднє значення
      return this.value;
    }
  }

  /** Прибирає символи, які не можуть бути частиною числа. */
  private _sanitize(raw: string): string {
    let s = raw.replace(/[^\d.,-]/g, "").replace(/,/g, ".");
    const negative = this.allowNegative && s.startsWith("-");
    s = s.replace(/-/g, "");
    const [head, ...rest] = s.split(".");
    if (rest.length) s = `${head}.${rest.join("")}`;
    return negative ? `-${s}` : s;
  }

  private _selectAll() {
    const input = this._input;
    if (!input) return;
    input.setSelectionRange(0, input.value.length);
  }

  /**
   * Перший клік по незафокусованому полю: блокуємо штатне встановлення каретки
   * і фокусуємо самі — далі `focus` виділить усе значення, як і при Tab.
   * Повторні кліки всередині вже активного поля працюють звично (каретка,
   * виділення протягуванням).
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
    this._draft = this._input?.value ?? this.value;
    // Lit ще не оновив DOM; виділяємо після рендеру.
    requestAnimationFrame(() => this._selectAll());
  }

  private _onInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const clean = this._sanitize(input.value);
    if (clean !== input.value) {
      const pos = (input.selectionStart ?? clean.length) - (input.value.length - clean.length);
      input.value = clean;
      input.setSelectionRange(pos, pos);
    }
    this._draft = clean;
    this.dispatchEvent(new CustomEvent("value-input", {
      detail: { value: clean },
      bubbles: true,
      composed: true,
    }));
  }

  /** Нормалізує чернетку у канонічне значення й повідомляє про зміну. */
  private _commit() {
    const next = this._format(this._draft ?? this.value);
    const changed = next !== this.value;
    this.value = next;
    this._draft = null;
    if (changed) {
      this.dispatchEvent(new CustomEvent("value-changed", {
        detail: { value: next },
        bubbles: true,
        composed: true,
      }));
    }
  }

  private _onBlur() {
    this._commit();
  }

  private _onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      this._commit();
      requestAnimationFrame(() => this._selectAll());
      return;
    }
    if (e.key === "Escape") {
      // Позначаємо клавішу обробленою: Esc в оболонці закриває вкладку, і без
      // цього відкат чернетки закривав би заразом усю форму.
      e.preventDefault();
      this._draft = this._entryValue;
      requestAnimationFrame(() => this._selectAll());
    }
  }

  override render(): TemplateResult {
    if (!this.visible) return html``;

    const input = html`
      <input
        type="text"
        inputmode="decimal"
        class="input w-full text-right tabular-nums ${this.size ? `input-${this.size}` : ""} ${
          // cell-control — контракт табличної частини з client/styles/theme.css
          this.cell ? "cell-control" : "input-bordered"
        }"
        .value=${this._draft ?? this.value}
        placeholder="${this.placeholder}"
        ?disabled=${this.disabled}
        ?readonly=${this.readonly}
        @pointerdown=${this._onPointerDown}
        @focus=${this._onFocus}
        @input=${this._onInput}
        @blur=${this._onBlur}
        @keydown=${this._onKeyDown}
      />
    `;

    // У комірці таблиці підпис не потрібен — жодних обгорток і відступів.
    if (this.cell) return input;

    const style = this.width ? `width:${this.width}` : "";

    return this.labelPosition === "left"
      ? html`
        <div class="flex items-center gap-2" style=${style}>
          ${this.label ? html`<span class="label text-sm whitespace-nowrap">${this.label}${this.required ? html`<span class="field-required">*</span>` : ""}</span>` : ""}
          ${input}
        </div>
      `
      : html`
        <div class="flex flex-col gap-1 ${this.invalid ? "field-invalid" : ""}" style=${style}>
          ${this.label ? html`<span class="label text-sm">${this.label}${this.required ? html`<span class="field-required">*</span>` : ""}</span>` : ""}
          ${input}
          ${this.invalid ? html`<span class="field-error">${this.invalid}</span>` : ""}
        </div>
      `;
  }
}
