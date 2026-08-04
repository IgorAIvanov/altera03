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

    const control = this.showClear
      ? html`
        <div class="join w-full ${this.cell ? "cell-control" : ""}">
          ${select}
          <button type="button"
            class="btn btn-square join-item ${this.size ? `btn-${this.size}` : "btn-sm"}"
            title="Очистити"
            ?disabled=${this.disabled || this.readonly || !this.value}
            @click=${() => this._set("")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      `
      : select;

    if (this.cell) return control;

    const style = this.width ? `width:${this.width}` : "";
    return this.labelPosition === "left"
      ? html`
        <div class="flex items-center gap-2" style=${style}>
          ${this.label ? html`<span class="label text-sm whitespace-nowrap">${this.label}${this.required ? html`<span class="text-error ml-0.5">*</span>` : ""}</span>` : ""}
          ${control}
        </div>
      `
      : html`
        <div class="flex flex-col gap-1" style=${style}>
          ${this.label ? html`<span class="label text-sm leading-none">${this.label}${this.required ? html`<span class="text-error ml-0.5">*</span>` : ""}</span>` : ""}
          ${control}
        </div>
      `;
  }
}