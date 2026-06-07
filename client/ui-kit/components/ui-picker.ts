import { GlobalStyledLitElement } from "../base/gsle.ts";
import { html } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { bus } from "../../bus/bus.ts";

@customElement("ui-picker")
export class UiPicker extends GlobalStyledLitElement {
  // уникальное имя якоря на каждый экземпляр
  private readonly _anchor = `--pk${Math.random().toString(36).slice(2, 8)}`;

  @property({ type: String }) label = "";
  @property({ type: String }) placeholder = "";
  @property({ type: Boolean }) disabled = false;
  @property({ type: String }) url = "";
  @property({ type: String }) fetch = "fetch";
  @property({ type: String }) picker = "picker";
  @property({ type: String }) displayField = "name";
  @property({ type: String }) idField = "id";
  @property({ type: Number }) listSize = 10;
  @property({ type: Boolean }) showClear = false;
  @property({ type: Object }) pickerParams: Record<string, unknown> = {};
  @property({ type: Object }) fetchParams: Record<string, unknown> = {};
  @property({ type: String }) displayValue = "";
  @property({ type: String }) selectedId = "";

  @state() private _items: Array<Record<string, unknown>> = [];

  @query("ul") private _popover?: HTMLUListElement;

  // синхронизируем состояние popover с _items
  protected override updated() {
    if (!this._popover) return;
    const open = this._popover.matches(":popover-open");
    if (this._items.length > 0 && !open) this._popover.showPopover();
    if (this._items.length === 0 && open)  this._popover.hidePopover();
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
    const hasBrowse  = !!this.url;
    const hasButtons = hasBrowse || (this.showClear && !!this.displayValue);

    return html`
      ${this.label ? html`
        <div class="mb-1">
          <span class="text-sm pl-1 fieldset-legend">${this.label}</span>
        </div>
      ` : ""}

      <div style="display:flex;">
        <input
          type="text"
          class="input input-bordered"
          style="anchor-name:${this._anchor}; flex:1; min-width:0; ${hasButtons ? "border-right:none;" : ""}"
          .value=${this.displayValue}
          placeholder="${this.placeholder}"
          ?disabled=${this.disabled}
          @input=${this._onInput}
        />

        ${this.showClear && this.displayValue ? html`
          <button class="btn btn-square btn-xs"
            style="height:24px;min-height:24px;width:24px;border-left:none;border-radius:0;"
            title="Очистити" @click=${this._onClear}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        ` : ""}

        ${hasBrowse ? html`
          <button class="btn btn-square btn-xs"
            style="height:24px;min-height:24px;width:24px;border-left:none;border-radius:0 var(--radius-field) var(--radius-field) 0;"
            title="Підібрати" ?disabled=${this.disabled || !this.url}
            @click=${this._onBrowse}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
        ` : ""}
      </div>

      <!-- popover + CSS Anchor Positioning: браузер управляет z-index, Esc и кликом снаружи -->
      <ul
        popover
        @toggle=${this._onPopoverToggle}
        style="
          position: fixed;
          position-anchor: ${this._anchor};
          top: anchor(bottom);
          left: anchor(left);
          width: anchor-size(width);
          margin: 2px 0 0; padding: 0; inset: unset;
          border: 1px solid var(--color-base-300,#d1d5db);
          border-radius: var(--radius-box,2px);
          box-shadow: 0 2px 8px rgba(0,0,0,.12);
          background: var(--color-base-100,#fff);
          overflow-y: auto;
          max-height: calc(${this.listSize} * 2.5rem);
          list-style: none;
        "
      >
        ${this._items.map(item => html`
          <li
            style="padding:4px 10px;cursor:pointer;font-size:12px;"
            @mouseenter=${(e: Event) => { (e.currentTarget as HTMLElement).style.background = "var(--color-base-200,#f3f4f6)"; }}
            @mouseleave=${(e: Event) => { (e.currentTarget as HTMLElement).style.background = ""; }}
            @mousedown=${(e: Event) => { e.preventDefault(); this._onSelect(item); }}
          >
            ${item[this.displayField] ?? item.name}
            ${item[this.idField] ? html`<span style="font-size:11px;opacity:.4;margin-left:4px;">#${item[this.idField]}</span>` : ""}
          </li>
        `)}
      </ul>
    `;
  }
}
