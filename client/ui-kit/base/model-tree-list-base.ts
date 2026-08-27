import { html, type CSSResultGroup, type TemplateResult } from "lit";
import { t } from "@client/locale.ts";
import { ModelListBase } from "./model-list-base.ts";
import { type ListColumn } from "./table-contract.ts";
import { TreeTableController, treeStyles } from "./tree-table.ts";

/**
 * Базовий клас списку ІЄРАРХІЧНИХ ЕЛЕМЕНТІВ — довідника, де батьком запису є
 * такий самий запис (самоссылка `parentId`): підрозділи (цех → дільниця),
 * статті затрат, статті доходів. Це `HierarchyOfItems` джерела: вузол дерева —
 * повноцінний елемент, він потрапляє в субконто і має власну картку.
 *
 * ## Чому окремий клас, а не прапорець у `ModelListBase`
 *
 * `hierarchy: true` (дерево ГРУП) механіки таблиці не міняє: панель
 * `<ui-group-tree>` збоку плюс `groupIds` у payload, рядки лишаються плоскою
 * пагінованою таблицею. Дерево самих рядків міняє РЕЖИМ основи: пагінація
 * (вузол і діти на різних сторінках), глобальне сортування, клавіатура з
 * гортанням, пошук. Прапорець розповз би чотирма `if (tree)` по гарячому шляху
 * кожного плоского списку — рівно те, від чого `QueryTableBase` застерігає в
 * шапці («Чому не один render() з прапорцями»). Обидва механізми через це
 * взаємовиключні: `hierarchy: true` тут — помилка старту, а не комбінація.
 *
 * Сама механіка дерева (стан згорнутості, розгортка, дієслова, клавіатура,
 * комірка з трикутником) живе в `TreeTableController` — вона спільна з
 * діалогом підбору `ModelTreePickerBase`, а спільного предка під неї в цих
 * двох немає (і чому саме контролер — див. шапку `tree-table.ts`). Тут
 * лишається клей: перекриття `rows`/`cell`/`onRowKeyDown` і делегати дієслів.
 *
 * ## Контракт для моделі
 *
 *  - рядок списку несе самоссылку (`parentId`, ім'я поля — `treeParentKey`);
 *  - команда `list` віддає НАБІР ЦІЛКОМ: у режимі дерева payload їде з
 *    `page: 1, pageSize: treeRowLimit` — сторінка дерева не має сенсу.
 *    Згенерований CRUD підходить як є (стелі pageSize він не ставить);
 *  - окремого «сортування дерева» немає: сервер сортує глобально, розгортка
 *    перегруповує за батьком, тож сортування за колонкою впорядковує
 *    БРАТІВ І СЕСТЕР усередині кожного вузла.
 *
 * ## Дві чесні межі
 *
 *  - **пошук (і його очищення) перемикає вигляд**: знайдений вузол без предків
 *    показувати нечесно, а тягнути предків — окрема механіка; тому діючий пошук
 *    показує звичайний плоский список із пагінацією, порожній — дерево;
 *  - **вивантаження в Excel — плоске**, у порядку відповіді сервера: відступ
 *    сам по собі у файл не потрапляє.
 *
 * Умовчання показу — все розкрито: стан тримає набір ЗГОРНУТИХ вузлів, тож
 * після перезавантаження нові вузли приходять розкритими самі.
 */
export abstract class ModelTreeListBase<Row extends { id: string }> extends ModelListBase<Row> {
  static override styles: CSSResultGroup = [
    ...(ModelListBase.styles as CSSResultGroup[]),
    treeStyles,
  ];

  // ── Налаштування ──────────────────────────────────────────────────────────
  /** Ім'я поля-самоссылки в рядку списку. */
  protected treeParentKey = "parentId";
  /**
   * Колонка, у якій малюється відступ і трикутник розгортання.
   * Умовчання — перша колонка.
   */
  protected treeColumn?: string;
  /**
   * Стеля вибірки в режимі дерева — стільки піде в `pageSize` payload-а.
   * Захист браузера, як `exportRowLimit`: що не влізло, назве банер, а
   * обрізане дерево (батьки за стелею) не вдаватиме повне.
   */
  protected treeRowLimit = 5000;
  /** Крок відступу на рівень глибини. */
  protected treeIndent = "1.25rem";

  /**
   * Дерево малюється, поки не діє пошук; з пошуком екран — звичайний плоский
   * список (пагінація, гортання, super у всіх перекриттях нижче).
   */
  protected get treeMode(): boolean {
    return this.search.trim() === "";
  }

  /** Механіка дерева — спільна з ModelTreePickerBase (див. tree-table.ts). */
  readonly #tree = new TreeTableController<Row>({
    host: this,
    source: () => this.$root.rows as Row[],
    parentIdOf: (row) => (row as Record<string, unknown>)[this.treeParentKey] as
      | string
      | null
      | undefined,
    active: () => this.treeMode,
    rows: () => this.rows,
    selectedId: () => this.selectedId,
    setSelectedId: (id) => {
      this.selectedId = id;
    },
    moveSelection: (index) => this.moveSelection(index),
    pageStep: () => this.pageSize,
    indent: () => this.treeIndent,
  });

  override connectedCallback() {
    if (this.hierarchy) {
      throw new Error(
        `${this.model}: ModelTreeListBase несумісний із hierarchy — ` +
          "дерево ГРУП і дерево ЕЛЕМЕНТІВ взаємовиключні (див. док класу).",
      );
    }
    super.connectedCallback();
  }

  /**
   * У режимі дерева «рядки екрана» — видимі вузли в порядку обходу. Через це
   * решта основи (клавіатура, курсор, позначки, статус) працює з деревом,
   * нічого про нього не знаючи.
   */
  protected override get rows(): Row[] {
    return this.treeMode ? this.#tree.visibleRows() : super.rows;
  }

  // ── Програмне керування вузлами (делегати контролера) ─────────────────────

  protected isNodeCollapsed(id: string): boolean {
    return this.#tree.isCollapsed(id);
  }
  /** Розгорнути вузол. Уже розгорнутий — нічого не робить (і не малює). */
  protected expandNode(id: string) {
    this.#tree.expand(id);
  }
  /** Згорнути вузол. Курсор зі схованого піддерева переїде на видимого предка. */
  protected collapseNode(id: string) {
    this.#tree.collapse(id);
  }
  /** Клік по трикутнику: перемкнути вузол. */
  protected toggleNode(id: string) {
    this.#tree.toggle(id);
  }
  /** Розгорнути все дерево. */
  protected expandAll() {
    this.#tree.expandAll();
  }
  /** Згорнути все дерево — лишаються самі корені. */
  protected collapseAll() {
    this.#tree.collapseAll();
  }
  /**
   * Показати вузол: розгорнути всіх його предків, поставити курсор і повести
   * фокус. Повертає `false`, якщо вузла в завантаженому наборі немає.
   * У плоскому вигляді (діє пошук) просто ставить курсор.
   */
  protected revealNode(id: string): boolean {
    return this.#tree.reveal(id);
  }

  // ── Завантаження ──────────────────────────────────────────────────────────

  protected override loadPayload(): Record<string, unknown> {
    const payload = super.loadPayload();
    if (this.treeMode) Object.assign(payload, { page: 1, pageSize: this.treeRowLimit });
    return payload;
  }

  protected override async load() {
    await super.load();
    // Набір обрізано стелею — дерево неповне (обрізані батьки піднялися б у
    // корінь), і мовчати про це не можна: виглядало б як інша структура.
    const got = (this.$root.rows as Row[]).length;
    if (this.treeMode && got < this.total) {
      this.messages = [{ type: "warn", text: t("tree.truncated", { count: got }) }];
    }
  }

  // ── Комірка колонки дерева ────────────────────────────────────────────────

  #treeColumnKey(): string {
    return this.treeColumn ?? this.columns[0]?.key ?? "";
  }

  protected override cell(row: Row, col: ListColumn<Row>): TemplateResult | string {
    const content = super.cell(row, col);
    if (!this.treeMode || col.key !== this.#treeColumnKey()) return content;
    return this.#tree.renderToggleCell(row, content);
  }

  // ── Клавіатура ────────────────────────────────────────────────────────────

  protected override onRowKeyDown(e: KeyboardEvent, row: Row, index: number) {
    if (this.readonly || !this.treeMode) return super.onRowKeyDown(e, row, index);
    // Що контролер не забрав (Enter, пробіл, Ctrl+A) — вирішує основа.
    if (!this.#tree.handleRowKey(e, row, index)) super.onRowKeyDown(e, row, index);
  }

  // ── Підвал ────────────────────────────────────────────────────────────────

  /** Замість пагінації в режимі дерева — сама смужка з лічильником. */
  protected override renderPagination(): TemplateResult {
    if (!this.treeMode) return super.renderPagination();
    return html`
      <div class="flex items-center px-3 py-2 border-t border-base-300 text-sm">
        <span class="text-muted">${this.total} ${t("common.records")}</span>
      </div>
    `;
  }
}
