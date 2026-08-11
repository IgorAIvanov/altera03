import { GlobalStyledLitElement } from "../base/gsle.ts";
import { html, type TemplateResult } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { bus } from "../../bus/bus.ts";
import { apiFetch } from "../../data/api.ts";
import { placePopover } from "../popover.ts";
import { icons } from "../icons.ts";

@customElement("ui-picker")
export class UiPicker extends GlobalStyledLitElement {
  /** host.focus() веде у внутрішній input — без цього клавіатурний обхід
      табличної частини (ui-tabular-table) не міг би сфокусувати комірку. */
  static override shadowRootOptions: ShadowRootInit = {
    ...GlobalStyledLitElement.shadowRootOptions,
    delegatesFocus: true,
  };

  @property({ type: String }) label = "";
  /** Позначка обов'язковості біля підпису — зірочка, як у renderField() форм. */
  @property({ type: Boolean }) required = false;
  /** Текст помилки поля; непорожній — рамка червона (див. theme.css, :host([invalid])). */
  @property({ type: String, reflect: true }) invalid = "";
  @property({ type: String, attribute: "label-position" }) labelPosition: "top" | "left" = "top";
  @property({ type: String }) placeholder = "";
  @property({ type: Boolean }) disabled = false;
  @property({ type: String }) url = "";
  /**
   * Команда моделі, якою шукається підказка при вводі. Умовчання — `lookup`:
   * саме її дає генератор CRUD і саме її оголошують моделі. Доти тут стояло
   * `fetch`, тобто умовчання не працювало НІ РАЗУ — команди з таким іменем
   * немає ні в кого, і пікер без явного атрибута мовчки нічого не знаходив.
   */
  @property({ type: String }) fetch = "lookup";
  @property({ type: String }) picker = "picker";
  @property({ type: String, attribute: "display-field" }) displayField = "name";
  @property({ type: String, attribute: "id-field" }) idField = "id";
  /**
   * Додаткове поле рядка, що показується у випадному списку сірим після
   * основного. Потрібне, коли основне поле саме по собі нечитабельне —
   * наприклад код рахунку: «361» без найменування нічого не каже.
   */
  @property({ type: String, attribute: "hint-field" }) hintField = "";
  @property({ type: Number, attribute: "list-size" }) listSize = 10;
  @property({ type: Boolean, attribute: "show-clear" }) showClear = false;
  @property({ type: Object, attribute: "picker-params" }) pickerParams: Record<string, unknown> = {};
  @property({ type: Object, attribute: "fetch-params" }) fetchParams: Record<string, unknown> = {};
  @property({ type: String, attribute: "display-value" }) displayValue = "";
  @property({ type: String, attribute: "selected-id" }) selectedId = "";
  @property({ type: String }) width = "";
  /**
   * Режим комірки табличної частини: контрол заповнює `<td>` цілком —
   * без рамки, заокруглень і зовнішніх відступів. `<td>` має бути `p-0`.
   */
  @property({ type: Boolean, reflect: true }) cell = false;
  @property({ type: Boolean }) visible = true;

  @state() private _items: Array<Record<string, unknown>> = [];
  @state() private _activeIndex = -1;

  @query("ul") private _popover?: HTMLUListElement;
  @query("input") private _input?: HTMLInputElement;

  // синхронизируем состояние popover с _items
  protected override updated() {
    this.#warnMissingLabel();
    if (!this._popover) return;
    const open = this._popover.matches(":popover-open");
    if (this._items.length > 0 && !open) {
      this._popover.showPopover();
      this._positionPopover();
    }
    if (this._items.length === 0 && open) this._popover.hidePopover();
    if (this._activeIndex >= 0) {
      this._popover.querySelector<HTMLElement>(`[data-index="${this._activeIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }

  /** Попереджаємо один раз на елемент: інакше кожен перемальовок дав би рядок. */
  #labelWarned = false;

  /**
   * Заповнений `selected-id` без `display-value` — це завжди недомовка форми, а
   * на екрані вона виглядає як «дані не прийшли»: поле порожнє, і шукати йдуть у
   * SQL. Причина ж, як правило, за три шари звідти — форма написала не ту
   * властивість (`.valueId`/`.valueLabel` замість `.selectedId`/`.displayValue`)
   * або слухає не ту подію. Lit присвоює невідому властивість екземпляру
   * мовчки, невідома подія просто ніколи не настає, `deno check` цього не
   * бачить, збірка зелена — жоден звичний канал про це не скаже.
   *
   * Затримка перед самим рядком потрібна проти хибних спрацювань: підпис
   * інколи приїжджає окремим запитом, на кадр-два пізніше за id.
   */
  #warnMissingLabel() {
    if (this.#labelWarned || !this.selectedId || this.displayValue) return;
    this.#labelWarned = true;

    setTimeout(() => {
      if (!this.selectedId || this.displayValue) return;
      console.warn(
        `[ui-picker url="${this.url}"] selected-id="${this.selectedId}" заданий, ` +
          `а display-value порожній — поле покажеться порожнім. Підпис дає форма: ` +
          `.displayValue (атрибут display-value). Контракт компонента — ` +
          `.selectedId / .displayValue / @item-selected / @item-cleared.`,
        this,
      );
    }, 300);
  }

  /**
   * Розкладку веде спільний `placePopover` — той самий, що в `ui-date` і
   * `ui-period`. Своє тут лише бажана висота: вона рахується не з вмісту, а з
   * кількості знайдених рядків, інакше список спершу розтягнувся б на весь
   * результат, а вже потім його обрізали б.
   */
  private _positionPopover() {
    if (!this._popover || !this._input) return;
    placePopover(this._popover, this._input, {
      matchAnchorWidth: true,
      desiredHeight: Math.min(this._items.length, this.listSize) * 28 + 8,
    });
  }

  // браузер закрыл popover (Esc или клік ззовні) — очищаємо список
  private _onPopoverToggle(e: Event) {
    if ((e as ToggleEvent).newState === "closed") {
      this._items = [];
      this._activeIndex = -1;
    }
  }

  private get _modelName() {
    return this.url.split("/").at(-1) ?? this.url;
  }

  private async _fetch(fragment: string) {
    if (!this.url) return;
    try {
      const res = await apiFetch(`/api/model/${this._modelName}/${this.fetch}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search: fragment, ...this.fetchParams }),
      });
      const data = await res.json();
      const rows = data?.data?.rows ?? data?.rows ?? [];
      this._items = Array.isArray(rows) ? rows as Array<Record<string, unknown>> : [];
      this._activeIndex = -1;
    } catch (e) {
      console.error("[ui-picker] fetch error:", e);
    }
  }

  private _onInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this.displayValue = val;
    if (!val) { this.selectedId = ""; this._items = []; this._activeIndex = -1; this._emitCleared(); return; }
    this._fetch(val);
  }

  private _onKeyDown(e: KeyboardEvent) {
    if (this._items.length === 0) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      this._moveActive(e.key === "ArrowDown" ? 1 : -1);
      return;
    }

    // Ctrl+Enter лишаємо формі (кнопка за замовчуванням) — навіть з відкритим
    // списком: вибір із нього робиться звичайним Enter.
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && this._activeIndex >= 0) {
      e.preventDefault();
      e.stopPropagation();
      this._onSelect(this._items[this._activeIndex]);
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this._items = [];
      this._activeIndex = -1;
      this._popover?.hidePopover();
      this._input?.focus();
    }
  }

  /** Перший ↑/↓ переносить фокус із input у список, наступні — між пунктами. */
  private _moveActive(step: 1 | -1) {
    this._activeIndex = this._activeIndex < 0
      ? (step > 0 ? 0 : this._items.length - 1)
      : (this._activeIndex + step + this._items.length) % this._items.length;
    requestAnimationFrame(() => {
      this._popover?.querySelector<HTMLButtonElement>(`[data-index="${this._activeIndex}"]`)?.focus();
    });
  }

  private _onSelect(item: Record<string, unknown>) {
    this.displayValue = String(item[this.displayField] ?? "");
    this.selectedId   = String(item[this.idField] ?? "");
    this._items = [];
    this._popover?.hidePopover();
    this._emit(item);
  }

  private _onClear() {
    this.displayValue = ""; this.selectedId = ""; this._items = [];
    this._popover?.hidePopover();
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

  override render(): TemplateResult {
    const hasBrowse = !!this.url;

    if (!this.visible) return html``;

    // cell-control — контракт табличної частини з client/styles/theme.css:
    // рамки, заокруглення й фон знімає він, сітку малює сама таблиця.
    const flat = this.cell ? "cell-control" : "";

    const inputGroup = html`
      <div class="join flex-1 ${flat}">
        <input
          type="text"
          class="input join-item flex-1 min-w-0"
          .value=${this.displayValue}
          placeholder="${this.placeholder}"
          ?disabled=${this.disabled}
          @input=${this._onInput}
          @keydown=${this._onKeyDown}
        />
        ${this.showClear ? html`
          <button class="btn btn-square btn-sm join-item"
            title="Очистити" ?disabled=${this.disabled || !this.displayValue} @click=${this._onClear}>
            ${icons.clear}
          </button>
        ` : ""}
        ${hasBrowse ? html`
          <button class="btn btn-square btn-sm join-item"
            title="Підібрати" ?disabled=${this.disabled || !this.url}
            @click=${this._onBrowse}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
        ` : ""}
      </div>
    `;

    const popover = html`
      <ul
        popover
        @toggle=${this._onPopoverToggle}
        @keydown=${this._onKeyDown}
        class="menu rounded-box shadow-md overflow-y-auto p-1"
        style="position:fixed; margin:0; inset:unset; background:#ffffff; border:1px solid var(--color-base-300,#d1d5db); flex-direction:column; flex-wrap:nowrap;${this._items.length === 0 ? "display:none;" : ""}"
      >
        ${this._items.map((item, index) => html`
          <li>
            <button data-index=${index} class=${index === this._activeIndex ? "active" : ""}
              @mousedown=${(e: Event) => { e.preventDefault(); this._onSelect(item); }}>
              ${item[this.displayField] ?? item.name}
              ${this.hintField
                ? html`<span class="text-xs opacity-50 truncate">${item[this.hintField] ?? ""}</span>`
                : item[this.idField]
                ? html`<span class="text-xs opacity-40">#${item[this.idField]}</span>`
                : ""}
            </button>
          </li>
        `)}
      </ul>
    `;

    // У комірці таблиці підпис не потрібен — жодних обгорток і відступів.
    if (this.cell) return html`${inputGroup}${popover}`;

    return html`
      ${this.labelPosition === "left" ? html`
        <div class="flex items-center gap-2${this.width ? ` w-[${this.width}]` : ""}">
          ${this.label ? html`<span class="label text-sm whitespace-nowrap">${this.label}${this.required ? html`<span class="text-error ml-0.5">*</span>` : ""}</span>` : ""}
          ${inputGroup}
        </div>
      ` : html`
        <div class="flex flex-col gap-1${this.width ? ` w-[${this.width}]` : ""} ${this.invalid ? "field-invalid" : ""}">
          ${this.label ? html`<span class="label text-sm leading-none">${this.label}${this.required ? html`<span class="text-error ml-0.5">*</span>` : ""}</span>` : ""}
          ${inputGroup}
          ${this.invalid ? html`<span class="field-error">${this.invalid}</span>` : ""}
        </div>
      `}
      ${popover}
    `;
  }
}
