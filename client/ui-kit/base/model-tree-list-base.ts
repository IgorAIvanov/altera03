import { css, type CSSResultGroup, html, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { t } from "@client/locale.ts";
import { ModelListBase } from "./model-list-base.ts";
import { stopRow, type ListColumn } from "./table-contract.ts";
import { flattenTree, treeParentIndex, type TreeNode } from "./tree-contract.ts";

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
    css`
      .tree-cell { display: flex; align-items: center; gap: 2px; }
      .tree-toggle {
        width: 1.25rem;
        height: 1.25rem;
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: 0;
        padding: 0;
        cursor: pointer;
        color: inherit;
        font-size: 0.75rem;
        line-height: 1;
        /* .7 — той самий поріг, що в .sort-idle: менше не видно, що вузол розкривається. */
        opacity: 0.7;
      }
      .tree-toggle:hover { opacity: 1; }
      .tree-toggle:focus-visible {
        outline: 1px solid var(--color-primary);
        outline-offset: -1px;
        opacity: 1;
      }
      .tree-toggle-none { cursor: default; }
    `,
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

  // ── Стан ──────────────────────────────────────────────────────────────────
  /** ЗГОРНУТІ вузли. Транзиент, як selectedId; порожній набір — усе розкрито. */
  @state() private collapsedIds: ReadonlySet<string> = new Set();

  /**
   * Дерево малюється, поки не діє пошук; з пошуком екран — звичайний плоский
   * список (пагінація, гортання, super у всіх перекриттях нижче).
   */
  protected get treeMode(): boolean {
    return this.search.trim() === "";
  }

  override connectedCallback() {
    if (this.hierarchy) {
      throw new Error(
        `${this.model}: ModelTreeListBase несумісний із hierarchy — ` +
          "дерево ГРУП і дерево ЕЛЕМЕНТІВ взаємовиключні (див. док класу).",
      );
    }
    super.connectedCallback();
  }

  // ── Розгортка ─────────────────────────────────────────────────────────────

  /** Кеш видимих вузлів: перерахунок лише на нові дані чи іншу згорнутість. */
  #cache?: {
    source: readonly Row[];
    collapsed: ReadonlySet<string>;
    nodes: TreeNode<Row>[];
    rows: Row[];
    byId: Map<string, TreeNode<Row>>;
    /** Батько КОЖНОГО рядка набору, не лише видимих — для ходіння вгору. */
    parents: Map<string, string | null>;
  };

  #parentIdOf = (row: Row) =>
    (row as Record<string, unknown>)[this.treeParentKey] as string | null | undefined;

  #tree() {
    const source = this.$root.rows as Row[];
    const cached = this.#cache;
    if (cached && cached.source === source && cached.collapsed === this.collapsedIds) return cached;

    const nodes = flattenTree(source, this.#parentIdOf, (id) => this.collapsedIds.has(id));
    const next = {
      source,
      collapsed: this.collapsedIds,
      nodes,
      rows: nodes.map((node) => node.row),
      byId: new Map(nodes.map((node) => [node.row.id, node])),
      parents: treeParentIndex(source, this.#parentIdOf),
    };
    this.#cache = next;
    return next;
  }

  /**
   * У режимі дерева «рядки екрана» — видимі вузли в порядку обходу. Через це
   * решта основи (клавіатура, курсор, позначки, статус) працює з деревом,
   * нічого про нього не знаючи.
   */
  protected override get rows(): Row[] {
    return this.treeMode ? this.#tree().rows : super.rows;
  }

  // ── Програмне керування вузлами ───────────────────────────────────────────
  //
  // Дієслова, а не перемикач, навмисно: перемикачем можна лише «клацнути», а
  // програмний сценарій хоче ГАРАНТОВАНОГО стану («розгорни», хай там що
  // було). До того ж лінива модель великих дерев підключиться саме сюди —
  // «розгорнути» перестане бути чисто клієнтською дією і почне довантажувати
  // дітей вузла, а перемикач такого гака не має.

  protected isNodeCollapsed(id: string): boolean {
    return this.collapsedIds.has(id);
  }

  /** Розгорнути вузол. Уже розгорнутий — нічого не робить (і не малює). */
  protected expandNode(id: string) {
    this.#setCollapsed([id], false);
  }

  /** Згорнути вузол. Курсор зі схованого піддерева переїде на видимого предка. */
  protected collapseNode(id: string) {
    this.#setCollapsed([id], true);
  }

  /** Клік по трикутнику: перемкнути вузол. */
  protected toggleNode(id: string) {
    this.#setCollapsed([id], !this.collapsedIds.has(id));
  }

  /** Розгорнути все дерево. */
  protected expandAll() {
    if (this.collapsedIds.size) this.collapsedIds = new Set();
  }

  /** Згорнути все дерево — лишаються самі корені. */
  protected collapseAll() {
    const withChildren = new Set<string>();
    for (const parent of this.#tree().parents.values()) {
      if (parent) withChildren.add(parent);
    }
    this.#setCollapsed([...withChildren], true);
  }

  /**
   * Показати вузол: розгорнути всіх його предків, поставити курсор і повести
   * фокус (через `moveSelection`, як стрілки). Повертає `false`, якщо вузла в
   * завантаженому наборі немає. У плоскому вигляді (діє пошук) просто ставить
   * курсор — розгортати нема чого.
   */
  protected revealNode(id: string): boolean {
    const { parents } = this.#tree();
    if (this.treeMode) {
      if (!parents.has(id)) return false;
      const path: string[] = [];
      const seen = new Set<string>([id]);
      let cursor = parents.get(id) ?? null;
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        path.push(cursor);
        cursor = parents.get(cursor) ?? null;
      }
      this.#setCollapsed(path, false);
    }
    const index = this.rows.findIndex((row) => row.id === id);
    if (index < 0) return false;
    this.moveSelection(index);
    return true;
  }

  /** Єдине місце запису згорнутості: без зміни — без перемальовування. */
  #setCollapsed(ids: readonly string[], collapsed: boolean) {
    const next = new Set(this.collapsedIds);
    let changed = false;
    for (const id of ids) {
      if (collapsed) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      } else if (next.delete(id)) {
        changed = true;
      }
    }
    if (!changed) return;
    this.collapsedIds = next;
    // Розгортання нічого не ховає — курсор перевіряти треба лише згортанню.
    if (collapsed) this.#ensureCursorVisible();
  }

  /**
   * Курсор стояв у щойно згорнутому піддереві — переводимо на найближчого
   * ВИДИМОГО предка, інакше виділений рядок зник би з екрана разом із
   * фокусною чергою (rowTabIndex тримається на selectedId).
   */
  #ensureCursorVisible() {
    const { byId, parents } = this.#tree();
    if (!this.selectedId || byId.has(this.selectedId) || !parents.has(this.selectedId)) return;
    const seen = new Set<string>();
    let cursor = parents.get(this.selectedId) ?? null;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (byId.has(cursor)) {
        this.selectedId = cursor;
        return;
      }
      cursor = parents.get(cursor) ?? null;
    }
    this.selectedId = "";
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
    const node = this.#tree().byId.get(row.id);
    if (!node) return content;

    const collapsed = this.isNodeCollapsed(row.id);
    const label = t(collapsed ? "tree.expand" : "tree.collapse");
    return html`
      <div class="tree-cell" style="padding-inline-start:calc(${node.depth} * ${this.treeIndent})">
        ${node.hasChildren
          ? html`
            <button type="button" class="tree-toggle"
              aria-expanded=${collapsed ? "false" : "true"}
              aria-label=${label} title=${label}
              @click=${stopRow(() => this.toggleNode(row.id))}>
              ${collapsed ? "▸" : "▾"}
            </button>`
          : html`<span class="tree-toggle tree-toggle-none" aria-hidden="true"></span>`}
        <div class="min-w-0">${content}</div>
      </div>
    `;
  }

  // ── Клавіатура ────────────────────────────────────────────────────────────

  /**
   * У режимі дерева гортання сторінок не існує, тож клавіші меж працюють у
   * видимих вузлах; Left/Right — за WAI-ARIA treegrid: Right розкриває
   * згорнутий вузол або веде до першого нащадка, Left згортає розкритий або
   * веде до батька. Решта (Enter, пробіл, Ctrl+A) — як у основи.
   */
  protected override onRowKeyDown(e: KeyboardEvent, row: Row, index: number) {
    if (this.readonly || !this.treeMode) return super.onRowKeyDown(e, row, index);

    const node = this.#tree().byId.get(row.id);
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        if (!node?.hasChildren) return;
        if (this.isNodeCollapsed(row.id)) this.expandNode(row.id);
        // Розкритий вузол: перший нащадок — наступний рядок обходу.
        else this.moveSelection(index + 1);
        return;
      case "ArrowLeft": {
        e.preventDefault();
        if (node?.hasChildren && !this.isNodeCollapsed(row.id)) {
          this.collapseNode(row.id);
          return;
        }
        const parent = this.#parentIndexOf(index);
        if (parent >= 0) this.moveSelection(parent);
        return;
      }
      case "ArrowDown":
        e.preventDefault();
        if (index + 1 < this.rows.length) this.moveSelection(index + 1);
        return;
      case "ArrowUp":
        e.preventDefault();
        if (index > 0) this.moveSelection(index - 1);
        return;
      case "PageDown":
        e.preventDefault();
        this.moveSelection(Math.min(index + this.pageSize, this.rows.length - 1));
        return;
      case "PageUp":
        e.preventDefault();
        this.moveSelection(Math.max(index - this.pageSize, 0));
        return;
      case "Home":
        e.preventDefault();
        this.moveSelection(0);
        return;
      case "End":
        e.preventDefault();
        this.moveSelection(this.rows.length - 1);
        return;
      default:
        super.onRowKeyDown(e, row, index);
    }
  }

  /** Індекс видимого батька — найближчий вузол вище з меншою глибиною. */
  #parentIndexOf(index: number): number {
    const nodes = this.#tree().nodes;
    const depth = nodes[index]?.depth ?? 0;
    if (depth === 0) return -1;
    for (let i = index - 1; i >= 0; i--) {
      if (nodes[i].depth < depth) return i;
    }
    return -1;
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
