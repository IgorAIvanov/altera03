import { GlobalStyledLitElement } from "../base/gsle.ts";
import { html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

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
  @property({ type: String, attribute: "label-position" }) labelPosition: "top" | "left" = "top";
  /** Текст першої порожньої опції. Порожньо — не додавати її. */
  @property({ type: String }) placeholder = "";
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) readonly = false;
  @property({ type: String }) size: "" | "xs" | "sm" | "md" | "lg" = "";
  @property({ type: String }) width = "";
  @property({ type: Boolean, reflect: true }) cell = false;
  @property({ type: Boolean }) visible = true;

  private _onChange(e: Event) {
    const next = (e.target as HTMLSelectElement).value;
    if (next === this.value) return;
    this.value = next;
    this.dispatchEvent(new CustomEvent("value-changed", {
      detail: { value: next },
      bubbles: true,
      composed: true,
    }));
  }

  override render(): TemplateResult {
    if (!this.visible) return html``;

    const select = html`
      <select
        class="select w-full ${this.size ? `select-${this.size}` : ""} ${
          this.cell ? "cell-control" : "select-bordered"
        }"
        .value=${this.value}
        ?disabled=${this.disabled || this.readonly}
        @change=${this._onChange}
      >
        ${this.placeholder ? html`<option value="">${this.placeholder}</option>` : ""}
        ${this.options.map((option) => html`
          <option value=${option.value} ?disabled=${option.disabled ?? false}>${option.label}</option>
        `)}
      </select>
    `;

    if (this.cell) return select;

    const style = this.width ? `width:${this.width}` : "";
    return this.labelPosition === "left"
      ? html`
        <div class="flex items-center gap-2" style=${style}>
          ${this.label ? html`<span class="label text-sm whitespace-nowrap">${this.label}${this.required ? html`<span class="text-error ml-0.5">*</span>` : ""}</span>` : ""}
          ${select}
        </div>
      `
      : html`
        <div class="flex flex-col gap-1" style=${style}>
          ${this.label ? html`<span class="label text-sm leading-none">${this.label}${this.required ? html`<span class="text-error ml-0.5">*</span>` : ""}</span>` : ""}
          ${select}
        </div>
      `;
  }
}