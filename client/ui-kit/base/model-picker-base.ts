import { type CSSResultGroup, html, css, type TemplateResult } from "lit";
import { property, query } from "lit/decorators.js";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { QueryTableBase } from "./query-table-base.ts";
import type { ListColumn } from "./table-contract.ts";

/**
 * Базовий клас для діалогу вибору (picker) моделі.
 *
 * Рендериться всередині модалки `picker-host`, відкривається через
 * `bus.pick(route, params)` з кнопки-лупи компонента `<ui-picker>`.
 *
 * Підклас зобов'язаний задати `model` та `columns`. Механіка таблиці —
 * завантаження, серверне сортування, пошук, пагінація, клавіатура рядків —
 * у спільній основі `QueryTableBase`; тут лишається те, що робить із таблиці
 * саме ДІАЛОГ: підтвердження вибору, скасування й розмова з `picker-host`.
 *
 * Колонки описуються тим самим типом `ListColumn`, що й у списку — він живе в
 * `table-contract.ts`, спільному для обох.
 *
 * Точки розширення:
 *  - `renderToolbarExtra()` — свої кнопки в тулбарі («показати неактивні»);
 *  - `extraPayload()`       — додаткові поля запиту понад `params` діалогу;
 *  - `rowClass()` / `rowStyle()` — підсвітка рядків.
 */
export abstract class ModelPickerBase<Row extends { id: string }> extends QueryTableBase<Row> {
  static override styles: CSSResultGroup = [
    ...(QueryTableBase.styles as CSSResultGroup[]),
    css`:host { display: block; height: 100%; }`,
  ];

  // ── Обов'язкові для підкласу (`model` успадковано з BaseUI) ────────────────
  protected abstract override columns: ListColumn<Row>[];

  // ── Опційні налаштування ──────────────────────────────────────────────────
  protected lookupCommand = "lookup";
  protected override get loadCommand(): string { return this.lookupCommand; }

  /** Поле рядка, що повертається як label вибраного значення. */
  protected labelField = "name";
  /** Розмір модалки — читається picker-host'ом. Override у підкласі за потреби. */
  protected dialogWidth = "560px";
  protected dialogHeight = "480px";
  protected override defaultPageSize = 10;
  /**
   * Панель фільтрів у діалозі — СМУГОЮ над таблицею, а не колонкою збоку.
   * Діалог вузький (560px за умовчанням) і живе кілька секунд: бічна колонка
   * на 15rem відрізала б від нього чверть ширини назавжди, а рядок контролів
   * коштує однієї смуги висоти, поки панель розгорнута.
   */
  protected override filterPanelDirection: "column" | "row" = "row";
  protected override pageSizeOptions = [10, 20, 50];
  /** У діалозі пошук — головна дія, тож він займає вільне місце тулбара. */
  protected override searchGrow = true;

  // ── Контракт picker-host ──────────────────────────────────────────────────
  @property({ type: String }) callbackId = "";
  @property({ type: Object }) params: Record<string, unknown> = {};
  /**
   * Множинний вибір. Ставить `picker-host` за тим, чим діалог відкривали:
   * `bus.pick()` — одне значення, `bus.pickMany()` — пачка. Сам пікер про це
   * не вирішує, тож той самий екран годиться для обох випадків.
   */
  @property({ type: Boolean }) multiple = false;

  protected override get filterPanelStateKey(): string {
    return `${super.filterPanelStateKey}:picker`;
  }

  /** Поле пошуку — за класом, а не за першим `input`: у тулбарі бувають інші. */
  @query(".search-input") private _input?: HTMLInputElement;

  /**
   * Позначки вмикаються множинністю. Присвоєння тут, а не перекритий гетер:
   * `selectable` в основі — звичайне поле (щоб екрани застосунку могли просто
   * написати `protected override selectable = true`), а гетер поверх поля не
   * компілюється. `multiple` приходить властивістю вже після конструктора, тож
   * зчитувати його треба на кожне оновлення.
   */
  protected override willUpdate(changed: Parameters<QueryTableBase<Row>["willUpdate"]>[0]) {
    super.willUpdate(changed);
    this.selectable = this.multiple;
  }

  /**
   * Звуження ФОРМОЮ — те, що людина в діалозі зняти не може.
   *
   * Приходить окремим ключем `params.lockedFilters` (його кладе `<ui-picker>` з
   * властивості `filters`), і саме тому ключ окремий: у `params.filters` лежить
   * ПОЧАТКОВИЙ СТАН панелі — те, з чим діалог відкривається і що людина
   * поправить. Доти обидва канали приходили під одним іменем, і відрізнити
   * «звузили назавжди» від «підставили для зручності» було нічим.
   */
  protected get lockedFilters(): Record<string, unknown> {
    return (this.params?.lockedFilters ?? {}) as Record<string, unknown>;
  }

  /**
   * Умовчання відбору діалогу — те, що передала форма (`picker-params`):
   * `{ filters: { … } }`. Саме `defaultFilters()`, а не разова засівка: тоді
   * «Скинути» повертає до відборів форми, а не до порожнечі.
   */
  protected override defaultFilters(): Record<string, unknown> {
    return {
      ...super.defaultFilters(),
      ...(this.params?.filters as Record<string, unknown> | undefined ?? {}),
    };
  }

  /**
   * До `$query` додаються фільтри панелі, `params` діалогу й звуження форми.
   *
   * Порядок значущий: `lockedFilters` кладуться ПОВЕРХ того, що людина
   * поставила в панелі, — інакше звуження, яке форма вважає обов'язковим,
   * знімалося б кнопкою «Скинути».
   */
  protected override loadPayload(): Record<string, unknown> {
    const { filters: _defaults, lockedFilters: _locked, ...rest } = this.params;
    const filters = { ...this.filters, ...this.lockedFilters };
    return {
      ...this.$root.$query,
      ...(Object.keys(filters).length ? { filters } : {}),
      ...rest,
      ...this.extraPayload(),
    };
  }

  protected override emptyText(): string { return t("common.notFound"); }

  override firstUpdated(changed: Parameters<QueryTableBase<Row>["firstUpdated"]>[0]) {
    super.firstUpdated(changed);
    this._input?.focus();
  }

  /**
   * З поля пошуку — одразу в таблицю: Tab і стрілка вниз.
   *
   * У діалозі вибору людина робить одне: набирає, спускається в перелік, Enter.
   * Природний порядок Tab вів через «Оновити» й кожен заголовок колонки, тобто
   * до рядків було п'ять-шість натискань. Ті контроли не зникають із черги —
   * до них веде Shift+Tab із таблиці (ця клавіша лишається рідною), тож
   * клавіатурою досяжне все, як і було.
   *
   * Порожній перелік — Tab рідний: вести нікуди, а людині, можливо, саме
   * відбір і треба змінити.
   */
  protected override onSearchKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const toTable = (e.key === "Tab" && !e.shiftKey) || e.key === "ArrowDown";
    if (!toTable || this.loading) return;
    if (this.rows.length === 0 && !this.searchPending) return;
    e.preventDefault();
    void this.#enterTable();
  }

  async #enterTable() {
    await this.flushSearch();
    if (this.rows.length === 0) return;
    // Курсор лишається там, де стояв, якщо рядок ще в переліку; інакше —
    // перший. Виділяється разом із фокусом: без курсора Enter у діалозі
    // і кнопка «Вибрати» нічого не підтвердили б.
    const index = Math.max(0, this.rows.findIndex((r) => r.id === this.selectedId));
    this.moveSelection(index);
  }

  /**
   * Стрілка вгору з першого рядка першої сторінки — назад у пошук, пара до
   * стрілки вниз із пошуку. Далі вгору основі вести все одно нікуди.
   */
  protected override onRowKeyDown(e: KeyboardEvent, row: Row, index: number) {
    if (e.key === "ArrowUp" && index === 0 && this.page <= 1
      && !(e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) {
      e.preventDefault();
      this._input?.focus();
      return;
    }
    super.onRowKeyDown(e, row, index);
  }

  protected rowLabel(row: Row): string {
    return (row as Record<string, unknown>)[this.labelField] as string ?? row.id;
  }

  /**
   * Активація рядка (подвійний клік або Enter) — це і є вибір.
   *
   * У множинному режимі рядок при цьому НЕ повертається сам: подвійний клік
   * позначає його й лишає діалог відкритим. Інакше підбір пачки закривався б
   * на першому ж рядку — тобто саме тоді, коли він і потрібен.
   */
  protected override onActivate(row: Row) {
    if (this.multiple) {
      if (!this.isChecked(row.id)) this.toggleChecked(row);
      return;
    }
    this.#select([row]);
  }

  /** Відповідь діалогу. `values` — усі позначені, `value` — перший із них. */
  #select(rows: Row[]) {
    if (rows.length === 0) return;
    const values = rows.map((row) => ({ id: row.id, label: this.rowLabel(row) }));
    bus.emit({
      type: "picker.select",
      callbackId: this.callbackId,
      // `value` заповнюємо завжди: `bus.pick()` читає саме його, і додавання
      // множинного режиму не повинно зачепити одиночний.
      value: values[0],
      values: this.multiple ? values : undefined,
    });
  }

  #confirm() {
    if (this.multiple) {
      this.#select(this.checked);
      return;
    }
    const row = this.rows.find((r) => r.id === this.selectedId);
    if (row) this.#select([row]);
  }

  /** Чи є що підтверджувати: пачка — позначені, одиночний вибір — курсор. */
  get #canConfirm(): boolean {
    return this.multiple ? this.checked.length > 0 : !!this.selectedId;
  }

  #cancel() {
    bus.emit({ type: "picker.cancel", callbackId: this.callbackId });
  }

  /**
   * Клавіші рівня діалогу. Enter тут потрібен для випадку, коли фокус у полі
   * пошуку: набрав — підтвердив. На самому рядку Enter обробляє основа
   * (`onRowKeyDown` → `onActivate`), і вона позначає подію `preventDefault()` —
   * тож перевірка `defaultPrevented` не дає вибрати рядок ДВІЧІ.
   */
  #onKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && this.#fromNested(e)) return;
    if (e.key === "Enter" && this.#canConfirm) { e.preventDefault(); this.#confirm(); }
    else if (e.key === "Escape") { e.preventDefault(); this.#cancel(); }
  }

  /**
   * Чи прийшла клавіша з ВКЛАДЕНОГО компонента — пікера відбору в тулбарі,
   * поля дати, будь-чого зі свого шадоу-кореня.
   *
   * Потрібне через Enter, і ціна помилки тут найвища з можливих. `<ui-picker>`
   * забирає Enter лише коли в його списку є підсвічений рядок; в усіх інших
   * випадках (список порожній, нічого не підсвічено) подія спливає — і доти
   * її ловив цей самий обробник. Виходило, що Enter у полі ВІДБОРУ підтверджував
   * вибір діалогу: у форму, яка його відкрила, мовчки їхав той рядок, що стояв
   * під курсором у списку.
   *
   * Escape навмисно лишається діалогу: вкладений контрол, якому є що закрити,
   * гасить його сам (`stopPropagation`), а якщо закривати нічого — «Escape
   * закриває вікно» саме те, чого чекають.
   */
  #fromNested(e: Event): boolean {
    for (const node of e.composedPath()) {
      if (node === this) return false;
      // Дефіс в імені = custom element. Власні частини діалогу (input, кнопки,
      // рядки таблиці) — звичайні теги, тож ознака розводить їх однозначно.
      if (node instanceof HTMLElement && node.tagName.includes("-")) return true;
    }
    return false;
  }

  override render(): TemplateResult {
    return html`
      <div class="flex flex-col h-full" @keydown=${this.#onKeydown}>
        ${this.renderToolbar()}

        <!-- Той самий банер, що в списку: без нього відмова сервера в lookup
             (і попередження на кшталт обрізаного дерева) не видна взагалі. -->
        <div class="px-3 pt-2 empty:hidden">${this.renderNotice()}</div>

        <!-- Панель відборів. Доти кнопка «Фільтри» в тулбарі з'являлася
             (її дає основа за hasFilters), рахувала активні відбори — і не
             робила нічого: малювати панель мав render(), а тут її не було
             взагалі. Обіцянка без виконавця. Зворотні лапки в цьому коментарі
             стояти не можуть — він усередині html-шаблона. -->
        <div class="px-3 pt-2 empty:hidden">${this.renderFilterPanel()}</div>

        <div class="flex-1 overflow-y-auto px-3">
          ${this.renderTable()}
        </div>

        ${this.renderPagination()}

        <!-- Дії -->
        <div class="flex justify-end gap-2 p-3 border-t border-base-300">
          <button class="btn btn-sm" @click=${this.#cancel}>${t("common.cancel")}</button>
          <button class="btn btn-sm btn-primary" ?disabled=${!this.#canConfirm}
            @click=${this.#confirm}>
            ${this.multiple && this.checked.length > 0
              ? `${t("common.select")} (${this.checked.length})`
              : t("common.select")}
          </button>
        </div>
      </div>
    `;
  }
}
