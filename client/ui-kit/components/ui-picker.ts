import { GlobalStyledLitElement } from "../base/gsle.ts";
import { html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { bus } from "../../bus/bus.ts";

@customElement("ui-picker")
export class UiPicker extends GlobalStyledLitElement {
  @property({ type: String }) label = "";
  @property({ type: String }) placeholder = "";
  @property({ type: Boolean }) disabled = false;

  /** Путь к модели: hr/user */
  @property({ type: String }) url = "";

  /** Имя команды для автодополнения */
  @property({ type: String }) fetch = "fetch";

  /** Имя вью формы подбора */
  @property({ type: String }) picker = "picker";

  /** Доп. параметры, передаваемые в форму подбора */
  @property({ type: Object }) pickerParams: Record<string, unknown> = {};

  /** Доп. параметры, передаваемые в команду fetch */
  @property({ type: Object }) fetchParams: Record<string, unknown> = {};

  /** Поле для отображения в списке и в инпуте */
  @property({ type: String }) displayField = "name";

  /** Поле идентификатора элемента */
  @property({ type: String }) idField = "id";

  /** Максимум строк в выпадающем списке */
  @property({ type: Number }) listSize = 10;

  /** Показывать кнопку очистки */
  @property({ type: Boolean }) showClear = false;

  /** Текущий отображаемый текст */
  @property({ type: String }) displayValue = "";

  /** Текущий идентификатор выбранного элемента */
  @property({ type: String }) selectedId = "";

  @state() private _items: Array<Record<string, unknown>> = [];
  @state() private _loading = false;

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("keydown", this._onEscClose);
    document.addEventListener("mousedown", this._onClickOutside);
  }

  override disconnectedCallback() {
    document.removeEventListener("keydown", this._onEscClose);
    document.removeEventListener("mousedown", this._onClickOutside);
    super.disconnectedCallback();
  }

  private _onEscClose = (e: KeyboardEvent) => {
    if (this._items.length > 0 && e.key === "Escape") {
      this._items = [];
    }
  };

  private _onClickOutside = (e: MouseEvent) => {
    if (this._items.length === 0) return;
    if (!e.composedPath().includes(this)) {
      this._items = [];
    }
  };

  private get _modelName(): string {
    // "catalog/bank" → "bank", "hr/user" → "user"
    return this.url.split("/").at(-1) ?? this.url;
  }

  private async _fetch(fragment: string) {
    if (!this.url) return;
    this._loading = true;
    try {
      const res = await globalThis.fetch(`/api/model/${this._modelName}/${this.fetch}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fragment, ...this.fetchParams }),
      });
      const data = await res.json();
      const rows = data?.data?.rows ?? data?.rows ?? [];
      this._items = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
    } catch (e) {
      console.error("[ui-picker] fetch error:", e);
    } finally {
      this._loading = false;
    }
  }

  private _onInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this.displayValue = val;
    if (!val) {
      this.selectedId = "";
      this._items = [];
      this._emitCleared();
      return;
    }
    this._fetch(val);
  }

  private _onSelect(item: Record<string, unknown>) {
    this.displayValue = String(item[this.displayField] ?? "");
    this.selectedId = String(item[this.idField] ?? "");
    this._items = [];
    this._emit(item);
  }

  private _onClear() {
    this.displayValue = "";
    this.selectedId = "";
    this._items = [];
    this._emitCleared();
  }

  private async _onBrowse() {
    if (!this.url) return;
    const result = await bus.pick(
      `${this.url}/${this.picker}`,
      Object.keys(this.pickerParams).length ? this.pickerParams : undefined,
    );
    if (result) {
      this.displayValue = result.label;
      this.selectedId = result.id;
      this._emit({ [this.idField]: result.id, [this.displayField]: result.label });
    }
  }

  private _emit(item: Record<string, unknown>) {
    this.dispatchEvent(new CustomEvent("item-selected", {
      detail: { id: this.selectedId, label: this.displayValue, item },
      bubbles: true,
      composed: true,
    }));
  }

  private _emitCleared() {
    this.dispatchEvent(new CustomEvent("item-cleared", {
      bubbles: true,
      composed: true,
    }));
  }

  override render() {
    const hasBrowse = !!this.url;
    const hasButtons = hasBrowse || (this.showClear && !!this.displayValue);

    return html`
      ${this.label ? html`
        <div class="mb-1">
          <span class="text-sm pl-1 fieldset-legend">${this.label}</span>
        </div>
      ` : ""}

      <div style="position:relative; width:100%;">
        <div style="display:flex; width:100%;">
          <input
            type="text"
            class="input input-bordered"
            style="flex:1; min-width:0; ${hasButtons ? "border-right:none;" : ""}"
            .value=${this.displayValue}
            placeholder="${this.placeholder}"
            ?disabled=${this.disabled}
            @input=${this._onInput}
          />

          ${this.showClear && this.displayValue ? html`
            <button
              class="btn btn-square btn-xs"
              style="height:24px; min-height:24px; width:24px; border-left:none; border-radius:0;"
              title="Очистити"
              @click=${this._onClear}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          ` : ""}

          ${hasBrowse ? html`
            <button
              class="btn btn-square btn-xs"
              style="height:24px; min-height:24px; width:24px; border-left:none; border-radius:0 var(--radius-field) var(--radius-field) 0;"
              title="Підібрати"
              ?disabled=${this.disabled || !this.url}
              @click=${this._onBrowse}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>
          ` : ""}
        </div>

        ${this._items.length > 0 ? html`
          <ul style="position:absolute; left:0; top:100%; width:100%; z-index:20; background:var(--color-base-100,#fff); border:1px solid var(--color-base-300,#d1d5db); border-radius:var(--radius-box,2px); box-shadow:0 2px 8px rgba(0,0,0,.12); overflow-y:auto; max-height:calc(${this.listSize} * 2.5rem); margin-top:2px; list-style:none; padding:0; margin-block:0;">
            ${this._items.map(item => html`
              <li
                style="padding:4px 10px; cursor:pointer; font-size:12px;"
                @mouseenter=${(e: Event) => { (e.currentTarget as HTMLElement).style.background = 'var(--color-base-200,#f3f4f6)'; }}
                @mouseleave=${(e: Event) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                @mousedown=${(e: Event) => { e.preventDefault(); this._onSelect(item); }}
              >
                ${item[this.displayField] ?? item.name}
                ${item[this.idField] ? html`<span style="font-size:11px;opacity:.4;margin-left:4px;">#${item[this.idField]}</span>` : ""}
              </li>
            `)}
          </ul>
        ` : ""}
      </div>
    `;
  }
}
