import {
  css,
  html,
  type CSSResult,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from "lit";
import { t } from "@client/locale.ts";
import { stopRow } from "./table-contract.ts";
import { flattenTree, treeParentIndex, type TreeNode } from "./tree-contract.ts";

/**
 * Спільна механіка табличного ДЕРЕВА ЕЛЕМЕНТІВ: стан згорнутості, кеш
 * розгортки, програмні дієслова, клавіатура й комірка з трикутником.
 *
 * Живе контролером (композиція), а не третім базовим класом чи міксином, і це
 * вимушено, а не смаково: споживачі стоять у РІЗНИХ гілках ієрархії
 * (`ModelTreeListBase` над списком, `ModelTreePickerBase` над діалогом
 * підбору), спільного предка під дерево в них немає, а міксин у TypeScript не
 * бачить protected-членів основи — тобто не дістав би ні `search`, ні
 * `selectedId`, ні `moveSelection`. Тому логіка лежить тут ОДИН раз, а класи
 * тримають тонкий клей: перекриття `rows`/`cell`/`onRowKeyDown` і делегати
 * дієслів. Розійтися мовчки може лише клей, і він навмисно однорядковий.
 *
 * Модуль не імпортує ані компонентів, ані базових класів — діалог підбору не
 * має тягнути чанк списку (правило графа імпортів, як у `table-contract.ts`).
 *
 * Господар доступається через `TreeTableAdapter` — вузький перелік замикань
 * замість посилання на клас: контролеру потрібні рівно ці сім речей, і по
 * переліку видно, які саме.
 */
export interface TreeTableAdapter<Row extends { id: string }> {
  host: ReactiveControllerHost;
  /** Повний завантажений набір (`$root.rows`). */
  source: () => readonly Row[];
  /** Значення самоссылки рядка (поле `treeParentKey` господаря). */
  parentIdOf: (row: Row) => string | null | undefined;
  /** Чи діє режим дерева зараз (пошук його вимикає). */
  active: () => boolean;
  /** ВИДИМІ рядки екрана — у режимі дерева це і є вузли контролера. */
  rows: () => Row[];
  selectedId: () => string;
  setSelectedId: (id: string) => void;
  /** Перевести курсор і фокус на рядок за індексом (метод основи). */
  moveSelection: (index: number) => void;
  /** Крок PageUp/PageDown у рядках. */
  pageStep: () => number;
  /** Відступ на рівень глибини (CSS-довжина). */
  indent: () => string;
}

/**
 * Стилі комірки дерева — господар додає їх до своїх `static styles`.
 * `.7` — той самий поріг, що в `.sort-idle`: менше не видно, що вузол
 * розкривається.
 */
export const treeStyles: CSSResult = css`
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
    opacity: 0.7;
  }
  .tree-toggle:hover { opacity: 1; }
  .tree-toggle:focus-visible {
    outline: 1px solid var(--color-primary);
    outline-offset: -1px;
    opacity: 1;
  }
  .tree-toggle-none { cursor: default; }
`;

export class TreeTableController<Row extends { id: string }> implements ReactiveController {
  #a: TreeTableAdapter<Row>;

  /** ЗГОРНУТІ вузли; порожній набір — усе розкрито, нове приходить розкритим. */
  #collapsed: ReadonlySet<string> = new Set();

  /** Кеш розгортки: перерахунок лише на нові дані чи іншу згорнутість. */
  #cache?: {
    source: readonly Row[];
    collapsed: ReadonlySet<string>;
    nodes: TreeNode<Row>[];
    rows: Row[];
    byId: Map<string, TreeNode<Row>>;
    /** Батько КОЖНОГО рядка набору, не лише видимих — для ходіння вгору. */
    parents: Map<string, string | null>;
  };

  constructor(adapter: TreeTableAdapter<Row>) {
    this.#a = adapter;
    adapter.host.addController(this);
  }

  hostConnected(): void {}

  #tree() {
    const source = this.#a.source();
    const cached = this.#cache;
    if (cached && cached.source === source && cached.collapsed === this.#collapsed) return cached;

    const nodes = flattenTree(source, this.#a.parentIdOf, (id) => this.#collapsed.has(id));
    const next = {
      source,
      collapsed: this.#collapsed,
      nodes,
      rows: nodes.map((node) => node.row),
      byId: new Map(nodes.map((node) => [node.row.id, node])),
      parents: treeParentIndex(source, this.#a.parentIdOf),
    };
    this.#cache = next;
    return next;
  }

  /** Видимі вузли в порядку обходу. */
  nodes(): TreeNode<Row>[] {
    return this.#tree().nodes;
  }

  /** Ті самі вузли самими рядками — для перекриття `rows` господаря. */
  visibleRows(): Row[] {
    return this.#tree().rows;
  }

  nodeOf(id: string): TreeNode<Row> | undefined {
    return this.#tree().byId.get(id);
  }

  // ── Програмне керування вузлами ───────────────────────────────────────────
  //
  // Дієслова, а не перемикач, навмисно: програмний сценарій хоче
  // ГАРАНТОВАНОГО стану («розгорни», хай там що було), а лінива модель
  // великих дерев підключить довантаження дітей саме в expand().

  isCollapsed(id: string): boolean {
    return this.#collapsed.has(id);
  }

  /** Розгорнути вузол. Уже розгорнутий — нічого не робить (і не малює). */
  expand(id: string): void {
    this.#setCollapsed([id], false);
  }

  /** Згорнути вузол. Курсор зі схованого піддерева переїде на видимого предка. */
  collapse(id: string): void {
    this.#setCollapsed([id], true);
  }

  /** Клік по трикутнику: перемкнути вузол. */
  toggle(id: string): void {
    this.#setCollapsed([id], !this.#collapsed.has(id));
  }

  /** Розгорнути все дерево. */
  expandAll(): void {
    if (this.#collapsed.size === 0) return;
    this.#collapsed = new Set();
    this.#a.host.requestUpdate();
  }

  /** Згорнути все дерево — лишаються самі корені. */
  collapseAll(): void {
    const withChildren = new Set<string>();
    for (const parent of this.#tree().parents.values()) {
      if (parent) withChildren.add(parent);
    }
    this.#setCollapsed([...withChildren], true);
  }

  /**
   * Показати вузол: у режимі дерева розгорнути всіх предків, потім поставити
   * курсор і повести фокус (через `moveSelection`, як стрілки). У плоскому
   * вигляді просто ставить курсор. `false` — вузла у видимому наборі немає.
   */
  reveal(id: string): boolean {
    if (this.#a.active()) {
      const { parents } = this.#tree();
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
    const index = this.#a.rows().findIndex((row) => row.id === id);
    if (index < 0) return false;
    this.#a.moveSelection(index);
    return true;
  }

  /** Єдине місце запису згорнутості: без зміни — без перемальовування. */
  #setCollapsed(ids: readonly string[], collapsed: boolean) {
    const next = new Set(this.#collapsed);
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
    this.#collapsed = next;
    // Розгортання нічого не ховає — курсор перевіряти треба лише згортанню.
    if (collapsed) this.#ensureCursorVisible();
    this.#a.host.requestUpdate();
  }

  /**
   * Курсор стояв у щойно згорнутому піддереві — переводимо на найближчого
   * ВИДИМОГО предка, інакше виділений рядок зник би з екрана разом із
   * фокусною чергою (rowTabIndex основи тримається на selectedId).
   */
  #ensureCursorVisible() {
    const selected = this.#a.selectedId();
    const { byId, parents } = this.#tree();
    if (!selected || byId.has(selected) || !parents.has(selected)) return;
    const seen = new Set<string>();
    let cursor = parents.get(selected) ?? null;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (byId.has(cursor)) {
        this.#a.setSelectedId(cursor);
        return;
      }
      cursor = parents.get(cursor) ?? null;
    }
    this.#a.setSelectedId("");
  }

  // ── Розмітка комірки дерева ───────────────────────────────────────────────

  /**
   * Обгорнути вміст комірки колонки дерева відступом і трикутником.
   * Рядок, якого немає серед видимих вузлів, повертається як є.
   */
  renderToggleCell(row: Row, content: TemplateResult | string): TemplateResult | string {
    const node = this.nodeOf(row.id);
    if (!node) return content;

    const collapsed = this.isCollapsed(row.id);
    const label = t(collapsed ? "tree.expand" : "tree.collapse");
    return html`
      <div class="tree-cell" style="padding-inline-start:calc(${node.depth} * ${this.#a.indent()})">
        ${node.hasChildren
          ? html`
            <button type="button" class="tree-toggle"
              aria-expanded=${collapsed ? "false" : "true"}
              aria-label=${label} title=${label}
              @click=${stopRow(() => this.toggle(row.id))}>
              ${collapsed ? "▸" : "▾"}
            </button>`
          : html`<span class="tree-toggle tree-toggle-none" aria-hidden="true"></span>`}
        <div class="min-w-0">${content}</div>
      </div>
    `;
  }

  // ── Клавіатура ────────────────────────────────────────────────────────────

  /**
   * Клавіші рядка в режимі дерева. `true` — клавіша оброблена (включно з
   * «оброблена як нічого», як-от Right на листку); `false` — хай вирішує
   * основа (Enter, пробіл, Ctrl+A). Гортання сторінок у дереві не існує,
   * тож клавіші меж працюють у видимих вузлах; Left/Right — за WAI-ARIA
   * treegrid: Right розкриває згорнутий вузол або веде до першого нащадка,
   * Left згортає розкритий або веде до батька.
   */
  handleRowKey(e: KeyboardEvent, row: Row, index: number): boolean {
    const rows = this.#a.rows();
    const node = this.nodeOf(row.id);
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        if (!node?.hasChildren) return true;
        if (this.isCollapsed(row.id)) this.expand(row.id);
        // Розкритий вузол: перший нащадок — наступний рядок обходу.
        else this.#a.moveSelection(index + 1);
        return true;
      case "ArrowLeft": {
        e.preventDefault();
        if (node?.hasChildren && !this.isCollapsed(row.id)) {
          this.collapse(row.id);
          return true;
        }
        const parent = this.#parentIndexOf(index);
        if (parent >= 0) this.#a.moveSelection(parent);
        return true;
      }
      case "ArrowDown":
        e.preventDefault();
        if (index + 1 < rows.length) this.#a.moveSelection(index + 1);
        return true;
      case "ArrowUp":
        e.preventDefault();
        if (index > 0) this.#a.moveSelection(index - 1);
        return true;
      case "PageDown":
        e.preventDefault();
        this.#a.moveSelection(Math.min(index + this.#a.pageStep(), rows.length - 1));
        return true;
      case "PageUp":
        e.preventDefault();
        this.#a.moveSelection(Math.max(index - this.#a.pageStep(), 0));
        return true;
      case "Home":
        e.preventDefault();
        this.#a.moveSelection(0);
        return true;
      case "End":
        e.preventDefault();
        this.#a.moveSelection(rows.length - 1);
        return true;
      default:
        return false;
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
}
