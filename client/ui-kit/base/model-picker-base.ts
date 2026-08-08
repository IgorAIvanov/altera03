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

  /** До `$query` додаються `params` діалогу (фільтр, заданий тим, хто відкрив). */
  protected override loadPayload(): Record<string, unknown> {
    return { ...this.$root.$query, ...this.params, ...this.extraPayload() };
  }

  protected override emptyText(): string { return t("common.notFound"); }

  override firstUpdated(changed: Parameters<QueryTableBase<Row>["firstUpdated"]>[0]) {
    super.firstUpdated(changed);
    this._input?.focus();
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
    if (e.key === "Enter" && this.#canConfirm) { e.preventDefault(); this.#confirm(); }
    else if (e.key === "Escape") { e.preventDefault(); this.#cancel(); }
  }

  override render(): TemplateResult {
    return html`
      <div class="flex flex-col h-full" @keydown=${this.#onKeydown}>
        ${this.renderToolbar()}

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
