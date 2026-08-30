import { GlobalStyledLitElement } from "../base/gsle.ts";
import { html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { bus } from "../../bus/bus.ts";
import { apiFetch } from "../../data/api.ts";
import { placePopover, POPOVER_ANCHORED_STYLE } from "../popover.ts";
import { icons } from "../icons.ts";

/**
 * Значення пікера — ссылка як її віддає база: ключ і підпис в одному об'єкті
 * (`{ id, name }`). `null` — не вибрано.
 */
export type PickerValue = Record<string, unknown> | null;

/** Подія зміни: та сама, що в решти контролів набору. */
export type PickerChangeEvent = CustomEvent<{ value: PickerValue }>;

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
  /**
   * Відбір підбору — те, чим форма ЗВУЖУЄ перелік: рахунки цієї організації,
   * договори цього контрагента, номенклатура цього складу.
   *
   * Одна властивість на обидва шляхи вибору — випадний список і діалог: підбір,
   * звужений в одному й повний у другому, гірший за незвужений, бо помилку в
   * ньому не видно. Ключі — оголошені `x-filter` моделі; невідомий ключ підбір
   * ВІДХИЛЯЄ, а не ігнорує.
   *
   * Це не те саме, що фільтри списку: там відбір задає користувач панеллю, тут —
   * форма, і зняти його користувач не може.
   */
  @property({ type: Object }) filters: Record<string, unknown> | null = null;
  /**
   * Значення — ОБ'ЄКТ, як його віддає база: `{ id, name }`. Одна прив'язка на
   * поле, а не пара «id окремо, підпис окремо».
   *
   * Доти форма тримала два поля й дві прив'язки (`selected-id` +
   * `display-value`), і забути можна було будь-яку з них: на екрані порожньо,
   * симптом «дані не прийшли», причина за три шари. При цьому підпис ЗАВЖДИ вже
   * був у відповіді — `get`, рядок списку, эхо фільтра й `lookup` віддають
   * вкладений об'єкт через `x-ref`. Пікер тепер бере його як є.
   */
  @property({ type: Object }) value: PickerValue = null;
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

  /**
   * Набране руками — доки не вибрали рядок. `null` означає «показуй підпис
   * значення»: інакше зовнішня зміна `value` не витиснула б із поля недобитий
   * фрагмент пошуку.
   */
  #typed: string | null = null;

  /** Текст у полі: набране має перевагу, інакше підпис із значення. */
  get #text(): string {
    return this.#typed ?? String(this.value?.[this.displayField] ?? "");
  }

  protected override willUpdate(changed: PropertyValues) {
    if (changed.has("value")) this.#typed = null;
  }

  // синхронизируем состояние popover с _items
  protected override updated() {
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
      // Команда завжди `lookup` — саме її дає генератор CRUD і саме її
      // оголошують моделі. Налаштування імені прибрано: моделі з іншою назвою
      // підбору не існує, а атрибут лише дозволяв помилитися.
      const res = await apiFetch(`/api/model/${this._modelName}/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          search: fragment,
          ...(this.filters ? { filters: this.filters } : {}),
          ...this.fetchParams,
        }),
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
    this.#typed = val;
    // Стерли текст — стерли й значення: поле з підписом, за яким нічого не
    // стоїть, обманює найгірше з можливого.
    if (!val) {
      this._items = [];
      this._activeIndex = -1;
      this.#commit(null);
      return;
    }
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
    this._items = [];
    this._popover?.hidePopover();
    // Віддаємо рівно ключ і підпис, а не весь рядок підбору: значення пікера
    // їде у форму й далі в `save`, і зайві колонки там нікому не потрібні.
    this.#commit({
      [this.idField]: String(item[this.idField] ?? ""),
      [this.displayField]: String(item[this.displayField] ?? ""),
    });
  }

  private _onClear() {
    this._items = [];
    this._popover?.hidePopover();
    this.#commit(null);
  }

  private async _onBrowse() {
    if (!this.url) return;
    // Два канали, і вони НЕ однакові, хоч доти йшли одним ключем:
    //  - `filters` — звуження формою, знімати його людині не можна, тож у
    //    діалог воно їде окремим `lockedFilters` і накладається поверх панелі;
    //  - `pickerParams` — «відкрий діалог ось так»: усе, що в ньому лежить під
    //    ключем `filters`, діалог візьме за ПОЧАТКОВИЙ стан своєї панелі
    //    (`ModelPickerBase.defaultFilters()`), і людина його поправить.
    // Доти обидва писалися в `params.filters`, другий затирав перший, і
    // «звузили» від «підставили» не відрізнялося ніяк.
    const params = {
      ...this.pickerParams,
      ...(this.filters ? { lockedFilters: this.filters } : {}),
    };
    const result = await bus.pick(
      `${this.url}/${this.picker}`,
      Object.keys(params).length ? params : undefined,
    );
    if (result) {
      this.#commit({ [this.idField]: result.id, [this.displayField]: result.label });
    }
  }

  /**
   * Нове значення — і назовні однією подією.
   *
   * Ім'я те саме, що в решти контролів набору (`ui-date`, `ui-decimal`):
   * `value-changed` з `detail.value`. Доти пікер мав власну пару
   * `item-selected` / `item-cleared`, тобто форма мусила слухати два різні
   * канали для однієї зміни — і невідома подія просто ніколи не наставала.
   */
  #commit(next: PickerValue) {
    this.value = next;
    this.#typed = null;
    this.dispatchEvent(new CustomEvent("value-changed", {
      detail: { value: next },
      bubbles: true,
      composed: true,
    }));
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
          .value=${this.#text}
          placeholder="${this.placeholder}"
          ?disabled=${this.disabled}
          @input=${this._onInput}
          @keydown=${this._onKeyDown}
        />
        ${this.showClear ? html`
          <button class="btn btn-square btn-sm join-item"
            title="Очистити" ?disabled=${this.disabled || !this.#text} @click=${this._onClear}>
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
        style=${`${POPOVER_ANCHORED_STYLE} background:#ffffff; border:1px solid var(--color-base-300,#d1d5db); flex-direction:column; flex-wrap:nowrap;${this._items.length === 0 ? "display:none;" : ""}`}
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
          ${this.label ? html`<span class="label text-sm whitespace-nowrap">${this.label}${this.required ? html`<span class="field-required">*</span>` : ""}</span>` : ""}
          ${inputGroup}
        </div>
      ` : html`
        <div class="flex flex-col gap-1${this.width ? ` w-[${this.width}]` : ""} ${this.invalid ? "field-invalid" : ""}">
          ${this.label ? html`<span class="label text-sm leading-none">${this.label}${this.required ? html`<span class="field-required">*</span>` : ""}</span>` : ""}
          ${inputGroup}
          ${this.invalid ? html`<span class="field-error">${this.invalid}</span>` : ""}
        </div>
      `}
      ${popover}
    `;
  }
}
