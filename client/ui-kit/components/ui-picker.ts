import { GlobalStyledLitElement } from "../base/gsle.ts";
import { html } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { bus } from "../../bus/bus.ts";

@customElement("ui-picker")
export class UiPicker extends GlobalStyledLitElement {
  @property({ type: String }) label = "";
  @property({ type: String, attribute: "label-position" }) labelPosition: "top" | "left" = "top";
  @property({ type: String }) placeholder = "";
  @property({ type: Boolean }) disabled = false;
  @property({ type: String }) url = "";
  @property({ type: String }) fetch = "fetch";
  @property({ type: String }) picker = "picker";
  @property({ type: String }) displayField = "name";
  @property({ type: String }) idField = "id";
  @property({ type: Number }) listSize = 10;
  @property({ type: Boolean, attribute: "show-clear" }) showClear = false;
  @property({ type: Object }) pickerParams: Record<string, unknown> = {};
  @property({ type: Object }) fetchParams: Record<string, unknown> = {};
  @property({ type: String }) displayValue = "";
  @property({ type: String }) selectedId = "";
  @property({ type: String }) width = "";
  @property({ type: Boolean }) visible = true;

  @state() private _items: Array<Record<string, unknown>> = [];

  @query("ul") private _popover?: HTMLUListElement;
  @query("input") private _input?: HTMLInputElement;

  // синхронизируем состояние popover с _items
  protected override updated() {
    if (!this._popover) return;
    const open = this._popover.matches(":popover-open");
    if (this._items.length > 0 && !open) {
      this._positionPopover();
      this._popover.showPopover();
    }
    if (this._items.length === 0 && open) this._popover.hidePopover();
  }

  private _positionPopover() {
    if (!this._popover || !this._input) return;
    const rect = this._input.getBoundingClientRect();
    this._popover.style.top    = `${rect.bottom + 2}px`;
    this._popover.style.left   = `${rect.left}px`;
    this._popover.style.width  = `${rect.width}px`;
  }

  // браузер закрыл popover (Esc или клик снаружи) — очищаем список
  private _onPopoverToggle(e: Event) {
    if ((e as ToggleEvent).newState === "closed") this._items = [];
  }

  private get _modelName() {
    return this.url.split("/").at(-1) ?? this.url;
  }

  private async _fetch(fragment: string) {
    if (!this.url) return;
    try {
      const res = await globalThis.fetch(`/api/model/${this._modelName}/${this.fetch}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search: fragment, ...this.fetchParams }),
      });
      const data = await res.json();
      const rows = data?.data?.rows ?? data?.rows ?? [];
      this._items = Array.isArray(rows) ? rows as Array<Record<string, unknown>> : [];
    } catch (e) {
      console.error("[ui-picker] fetch error:", e);
    }
  }

  private _onInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this.displayValue = val;
    if (!val) { this.selectedId = ""; this._items = []; this._emitCleared(); return; }
    this._fetch(val);
  }

  private _onSelect(item: Record<string, unknown>) {
    this.displayValue = String(item[this.displayField] ?? "");
    this.selectedId   = String(item[this.idField] ?? "");
    this._items = [];
    this._emit(item);
  }

  private _onClear() {
    this.displayValue = ""; this.selectedId = ""; this._items = [];
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
      this.selectedId   = result.id;
      this._emit({ [this.idField]: result.id, [this.displayField]: result.label });
    }
  }

  private _emit(item: Record<string, unknown>) {
    this.dispatchEvent(new CustomEvent("item-selected", {
      detail: { id: this.selectedId, label: this.displayValue, item },
      bubbles: true, composed: true,
    }));
  }

  private _emitCleared() {
    this.dispatchEvent(new CustomEvent("item-cleared", { bubbles: true, composed: true }));
  }

  override render() {
    const hasBrowse = !!this.url;

    if (!this.visible) return html``;

    const inputGroup = html`
      <div class="join flex-1${this.width ? "" : ""}">
        <input
          type="text"
          class="input join-item flex-1 min-w-0"
          .value=${this.displayValue}
          placeholder="${this.placeholder}"
          ?disabled=${this.disabled}
          @input=${this._onInput}
        />
        ${this.showClear ? html`
          <button class="btn btn-square btn-sm join-item"
            title="Очистити" ?disabled=${this.disabled || !this.displayValue} @click=${this._onClear}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        ` : ""}
        ${hasBrowse ? html`
          <button class="btn btn-square btn-sm join-item"
            title="Підібрати" ?disabled=${this.disabled || !this.url}
            @click=${this._onBrowse}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
        ` : ""}
      </div>
    `;

    return html`
      ${this.labelPosition === "left" ? html`
        <div class="flex items-center gap-2${this.width ? ` w-[${this.width}]` : ""}">
          ${this.label ? html`<span class="label text-sm whitespace-nowrap">${this.label}</span>` : ""}
          ${inputGroup}
        </div>
      ` : html`
        <div class="flex flex-col gap-1${this.width ? ` w-[${this.width}]` : ""}">
          ${this.label ? html`<span class="label text-sm">${this.label}</span>` : ""}
          ${inputGroup}
        </div>
      `}

      <ul
        popover
        @toggle=${this._onPopoverToggle}
        class="menu menu-xs bg-base-100 border border-base-300 rounded-box shadow-md overflow-y-auto p-1"
        style="position:fixed; margin:0; inset:unset; max-height:calc(${this.listSize} * 2.25rem);"
      >
        ${this._items.map(item => html`
          <li>
            <button @mousedown=${(e: Event) => { e.preventDefault(); this._onSelect(item); }}>
              ${item[this.displayField] ?? item.name}
              ${item[this.idField] ? html`<span class="text-xs opacity-40">#${item[this.idField]}</span>` : ""}
            </button>
          </li>
        `)}
      </ul>
    `;
  }
}
