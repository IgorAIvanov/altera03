import { html, type CSSResultGroup, type TemplateResult } from "lit";
import { t } from "@client/locale.ts";
import { ModelPickerBase } from "./model-picker-base.ts";
import { type ListColumn } from "./table-contract.ts";
import { TreeTableController, treeStyles } from "./tree-table.ts";

/**
 * Діалог вибору для довідника ІЄРАРХІЧНИХ ЕЛЕМЕНТІВ (самоссылка `parentId`):
 * той самий `ModelPickerBase` (пошук, вибір, підтвердження, розмова з
 * `picker-host`), але рядки малюються деревом — дві дільниці з однаковою
 * назвою в різних цехах розрізняються місцем у структурі, а не колонкою
 * «входить до».
 *
 * Механіка дерева — спільний `TreeTableController` (чому контролер, а не
 * третій базовий клас чи міксин — шапка `tree-table.ts`); тут, як і в
 * `ModelTreeListBase`, лишається тонкий клей. Правила ті самі:
 *
 *  - **`lookup` мусить віддавати `parentId` у рядках** — стандартна
 *    `<Model>LookupRowSchema` тримає лише `id` + `name`, тож модель додає
 *    поле самоссылки сама;
 *  - у режимі дерева їде ВЕСЬ набір (`page: 1, pageSize: treeRowLimit`),
 *    обрізання чесно називає банер;
 *  - діючий пошук тимчасово перемикає в плоский список із пагінацією —
 *    у діалозі підбору пошук головний, і поводиться він як у всіх пікерів;
 *  - сортування за колонкою впорядковує братів і сестер усередині вузла.
 *
 * Вузол дерева — повноцінний елемент, тож і ВИБРАТИ можна будь-який вузол,
 * включно з тим, що має дітей: цех — такий самий підрозділ, як дільниця.
 * Довідник, де «групи» вибирати не можна, — це дерево ГРУП (`hierarchy`),
 * інший механізм і звичайний `ModelPickerBase`.
 */
export abstract class ModelTreePickerBase<Row extends { id: string }> extends ModelPickerBase<Row> {
  static override styles: CSSResultGroup = [
    ...(ModelPickerBase.styles as CSSResultGroup[]),
    treeStyles,
  ];

  // ── Налаштування (ті самі, що в ModelTreeListBase) ────────────────────────
  /** Ім'я поля-самоссылки в рядку lookup. */
  protected treeParentKey = "parentId";
  /** Колонка з відступом і трикутником; умовчання — перша колонка. */
  protected treeColumn?: string;
  /** Стеля вибірки в режимі дерева; обрізання називає банер. */
  protected treeRowLimit = 5000;
  /** Крок відступу на рівень глибини. */
  protected treeIndent = "1.25rem";

  /** Дерево малюється, поки не діє пошук. */
  protected get treeMode(): boolean {
    return this.search.trim() === "";
  }

  /** Механіка дерева — спільна з ModelTreeListBase (див. tree-table.ts). */
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

  /** У режимі дерева «рядки екрана» — видимі вузли в порядку обходу. */
  protected override get rows(): Row[] {
    return this.treeMode ? this.#tree.visibleRows() : super.rows;
  }

  // ── Програмне керування вузлами (делегати контролера) ─────────────────────

  protected isNodeCollapsed(id: string): boolean {
    return this.#tree.isCollapsed(id);
  }
  protected expandNode(id: string) {
    this.#tree.expand(id);
  }
  protected collapseNode(id: string) {
    this.#tree.collapse(id);
  }
  protected toggleNode(id: string) {
    this.#tree.toggle(id);
  }
  protected expandAll() {
    this.#tree.expandAll();
  }
  protected collapseAll() {
    this.#tree.collapseAll();
  }
  /**
   * Показати вузол: розгорнути предків, поставити курсор і повести фокус.
   * Пікеру це потрібне частіше, ніж списку, — показати ПОТОЧНЕ значення поля
   * при відкритті діалогу.
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
