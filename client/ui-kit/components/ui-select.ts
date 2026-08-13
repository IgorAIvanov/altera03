import { GlobalStyledLitElement } from "../base/gsle.ts";
import { html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { icons } from "../icons.ts";

export interface UiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Вибір одного значення з фіксованого набору опцій.
 *
 * `value` зберігає машинний код опції, а `label` лишається лише
 * представленням. Це відповідає TypeBox-переліченням у схемах моделей.
 */
@customElement("ui-select")
export class UiSelect extends GlobalStyledLitElement {
  static override shadowRootOptions: ShadowRootInit = {
    ...GlobalStyledLitElement.shadowRootOptions,
    delegatesFocus: true,
  };

  @property({ type: String }) value = "";
  @property({ type: Array }) options: UiSelectOption[] = [];
  @property({ type: String }) label = "";
  @property({ type: Boolean }) required = false;
  /** Текст помилки поля; непорожній — рамка червона (див. theme.css, :host([invalid])). */
  @property({ type: String, reflect: true }) invalid = "";
  @property({ type: String, attribute: "label-position" }) labelPosition: "top" | "left" = "top";
  /** Текст першої порожньої опції. Порожньо — не додавати її. */
  @property({ type: String }) placeholder = "";
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) readonly = false;
  /** Кнопка очищення вибору — для необов'язкових полів. */
  @property({ type: Boolean, attribute: "show-clear" }) showClear = false;
  @property({ type: String }) size: "" | "xs" | "sm" | "md" | "lg" = "";
  @property({ type: String }) width = "";
  @property({ type: Boolean, reflect: true }) cell = false;
  @property({ type: Boolean }) visible = true;

  private _set(next: string) {
    if (next === this.value) return;
    this.value = next;
    this.dispatchEvent(new CustomEvent("value-changed", {
      detail: { value: next },
      bubbles: true,
      composed: true,
    }));
  }

  private _onChange(e: Event) {
    this._set((e.target as HTMLSelectElement).value);
  }

  /**
   * Значення доставляється ПІСЛЯ рендера, а не прив'язкою в шаблоні.
   *
   * У лита прив'язки елемента комітяться раніше, ніж додаються його діти, тож
   * `.value=${this.value}` присвоювалося, коли жодного `<option>` ще не було.
   * Браузер таке значення відкидає (немає з чого вибирати), а щойно пункти
   * з'являлися — ставав на ПЕРШИЙ. Далі лит `.value` уже не чіпав: воно
   * дорівнювало тому, що він сам поставив минулого разу, — і контрол лишався
   * на першому пункті назавжди.
   *
   * Найгірше в цьому було не саме зміщення, а те, як воно виглядає. Помилку
   * видно ЛИШЕ коли збережене значення не збігається з першим пунктом, а в
   * половини списків перший пункт — найчастіший («20%», «покупка»). Тобто
   * екран правильний, доки хтось не вибере інше; а коли вибере, побачить не
   * «показано не те», а «не збереглося»: після взаємодії контрол тримає
   * вибране, і різниця вилазить аж після перезаходу.
   *
   * Присвоєння ВЛАСТИВОСТІ, а не `?selected` на пункті: атрибут діє лише доки
   * в option не зведено прапорець «брудності», а в цього компонента значення
   * міняється й програмно — кнопкою очищення, — тобто вже після взаємодії.
   * Значення поза переліком лишає select порожнім, і це чесніше за мовчазне
   * зміщення на перший пункт.
   */
  protected override updated(changed: Map<string, unknown>) {
    super.updated?.(changed);
    const select = this.renderRoot.querySelector("select");
    if (select && select.value !== this.value) select.value = this.value;
  }

  override render(): TemplateResult {
    if (!this.visible) return html``;

    // З кнопкою очищення select живе в join-групі (як ui-date): рамку й
    // cell-control несе обгортка, сам select стає join-item.
    const select = html`
      <select
        class="select w-full ${this.size ? `select-${this.size}` : ""} ${
          this.showClear
            ? "join-item flex-1 min-w-0"
            : this.cell ? "cell-control" : "select-bordered"
        }"
        ?disabled=${this.disabled || this.readonly}
        @change=${this._onChange}
      >
        ${this.placeholder ? html`<option value="">${this.placeholder}</option>` : ""}
        ${this.options.map((option) => html`
          <option value=${option.value} ?disabled=${option.disabled ?? false}>${option.label}</option>
        `)}
      </select>
    `;

    const control = this.showClear
      ? html`
        <div class="join w-full ${this.cell ? "cell-control" : ""}">
          ${select}
          <button type="button"
            class="btn btn-square join-item ${this.size ? `btn-${this.size}` : "btn-sm"}"
            title="Очистити"
            ?disabled=${this.disabled || this.readonly || !this.value}
            @click=${() => this._set("")}>
            ${icons.clear}
          </button>
        </div>
      `
      : select;

    if (this.cell) return control;

    const style = this.width ? `width:${this.width}` : "";
    return this.labelPosition === "left"
      ? html`
        <div class="flex items-center gap-2" style=${style}>
          ${this.label ? html`<span class="label text-sm whitespace-nowrap">${this.label}${this.required ? html`<span class="field-required">*</span>` : ""}</span>` : ""}
          ${control}
        </div>
      `
      : html`
        <div class="flex flex-col gap-1 ${this.invalid ? "field-invalid" : ""}" style=${style}>
          ${this.label ? html`<span class="label text-sm leading-none">${this.label}${this.required ? html`<span class="field-required">*</span>` : ""}</span>` : ""}
          ${control}
          ${this.invalid ? html`<span class="field-error">${this.invalid}</span>` : ""}
        </div>
      `;
  }
}