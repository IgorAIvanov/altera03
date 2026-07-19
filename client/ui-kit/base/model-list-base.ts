import { html, css, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { Type } from "@sinclair/typebox";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { tw } from "@client/shared/styles.ts";
import { BaseUI } from "./base-ui.ts";
import { QuerySchema, TotalsSchema, type Query, type Totals } from "@shared/schema.ts";

export type SortDir = "asc" | "desc";

/** Форма `$root` списку: службовий `$query` + дані `rows`/`totals`. */
export type ListRoot<Row> = { $query: Query; rows: Row[]; totals: Totals };

/**
 * Generic root-схема списку/пікера для `Value.Create`: форма рядка важлива лише
 * на рівні TS-типу (`Row`), а для ініціалізації достатньо порожнього `rows`.
 * Тож підкласам не потрібен власний конструктор чи `<Model>RootSchema`.
 * Спільна для `ModelListBase` та `ModelPickerBase`.
 */
export const listRootSchema = Type.Object({
  $query: QuerySchema,
  rows:   Type.Array(Type.Unknown()),
  totals: TotalsSchema,
});

/** Описание однієї колонки списку. */
export interface ListColumn<Row> {
  /** Ключ поля у рядку та значення sortBy для сервера. */
  key: string;
  /** Заголовок колонки — ключ локалізації або літерал (проходить через t()). */
  title: string;
  /** Ширина CSS, напр. "8rem". Без значення — гнучка колонка. */
  width?: string;
  align?: "left" | "right" | "center";
  /**
   * Поведінка тексту в комірці:
   *  - "wrap" (за замовч.) — переноситься на кілька рядків;
   *  - "nowrap" — один рядок без переносу;
   *  - "ellipsis" — один рядок, обрізається з "…" (потребує `width`).
   */
  overflow?: "wrap" | "nowrap" | "ellipsis";
  /** Приглушений текст (вторинні дані: коди, дати). */
  muted?: boolean;
  sortable?: boolean;
  /** Нативний tooltip комірки (атрибут title). */
  tooltip?: (row: Row) => string;
  /**
   * Кастомний рендер комірки. За замовчуванням — row[key].
   * Сюди можна повернути кнопки, бейджі, дворядковий вміст тощо.
   * Для кнопок гортай обробник через `stopRow(...)`, щоб клік не виділяв рядок.
   */
  render?: (row: Row) => TemplateResult | string;
}

export interface ListTotals {
  count: number;
  page: number;
  pageSize: number;
}

/** CSS-клас вирівнювання для th/td. */
export function alignClass(align?: string): string {
  return align === "right" ? "text-right" : align === "center" ? "text-center" : "";
}

/** Inline-стиль комірки: перенос/обрізка тексту + max-width для ellipsis. */
export function cellStyle<Row>(col: ListColumn<Row>): string {
  const parts: string[] = [];
  if (col.overflow === "nowrap") parts.push("white-space:nowrap");
  if (col.overflow === "ellipsis") {
    parts.push("white-space:nowrap", "overflow:hidden", "text-overflow:ellipsis");
    if (col.width) parts.push(`max-width:${col.width}`);
  }
  return parts.join(";");
}

/**
 * Обгортка обробника події в комірці, що зупиняє спливання —
 * клік по кнопці в рядку не виділяє/не активує рядок.
 * Приклад: `@click=${stopRow(() => this.openEdit(row.id))}`
 */
export function stopRow(fn: (e: Event) => void) {
  return (e: Event) => { e.stopPropagation(); fn(e); };
}

/** Дворядкова комірка: основний текст + приглушений другий рядок. */
export function twoLine(primary: unknown, secondary?: unknown): TemplateResult {
  return html`
    <div class="leading-tight">
      <div>${primary}</div>
      ${secondary != null && secondary !== ""
        ? html`<div class="text-xs text-base-content/50">${secondary}</div>`
        : ""}
    </div>
  `;
}

const icon = {
  create: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  open: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  delete: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  refresh: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  search: html`<svg class="h-4 w-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
};

/**
 * Базовий клас для типової форми списку моделі.
 *
 * Підклас зобов'язаний задати `model`, `columns` та `editRoute`.
 * Уся логіка (завантаження, серверне сортування, пагінація, пошук,
 * вибір рядка, видалення, реакція на model.changed) реалізована тут.
 *
 * Точки розширення для майбутніх варіантів форм:
 *  - `extraPayload()`        — додаткові поля у payload (панель фільтрів для документів)
 *  - `renderHeaderArea()`    — повноширинна зона між тулбаром і таблицею (фільтри, хлібні крихти груп)
 *  - `renderToolbarExtra()`  — додаткові кнопки тулбару
 *  - `rowClass()`            — додаткові класи рядка (підсвітка статусів)
 *  - `onActivate()`          — дія по подвійному кліку (за замовч. — відкрити edit)
 */
export abstract class ModelListBase<Row extends { id: string }> extends BaseUI<ListRoot<Row>> {
  static override styles = [tw, css`
    tr.selected td { background: var(--color-primary) !important; color: var(--color-primary-content) !important; }
    th.sortable { cursor: pointer; user-select: none; }
  `];

  // ── Обов'язкові для підкласу (`model` успадковано з BaseUI) ────────────────
  protected abstract columns: ListColumn<Row>[];
  protected abstract editRoute: string;

  // ── Опційні налаштування ──────────────────────────────────────────────────
  protected listCommand = "list";
  protected defaultSortBy = "";
  protected defaultSortDir: SortDir = "asc";
  protected pageSizeOptions = [10, 20, 50, 100];

  // ── Стан ──────────────────────────────────────────────────────────────────
  /** Виділений рядок — клієнтський транзиент, не частина data-контракту. */
  @state() protected selectedId = "";

  // Проєкції старих імен полів на службовий `$query` та дані `$root`.
  // Логіка/рендер нижче лишаються без змін; читання трекає SignalWatcher,
  // запис у deep-проксі перемальовує.
  protected get rows(): Row[] { return this.$root.rows; }
  protected get total(): number { return this.$root.totals.count; }
  /**
   * Спіннер на місці таблиці — лише для першого завантаження (порожній список).
   * Перезавантаження (сортування/пагінація/пошук) показує глобальна смужка
   * на тулбарі (loading.start/end у data-service), тож таблиця не блимає.
   */
  protected get loading(): boolean {
    return this.running === this.listCommand && this.$root.rows.length === 0;
  }

  protected get search(): string { return this.$root.$query.search; }
  protected set search(v: string) { this.$root.$query.search = v; }
  protected get page(): number { return this.$root.$query.page; }
  protected set page(v: number) { this.$root.$query.page = v; }
  protected get pageSize(): number { return this.$root.$query.pageSize; }
  protected set pageSize(v: number) { this.$root.$query.pageSize = v; }
  protected get sortBy(): string { return this.$root.$query.sortBy; }
  protected set sortBy(v: string) { this.$root.$query.sortBy = v; }
  protected get sortDir(): SortDir { return this.$root.$query.sortDir as SortDir; }
  protected set sortDir(v: SortDir) { this.$root.$query.sortDir = v; }

  constructor() { super(listRootSchema); }

  #searchTimer?: number;
  #unsub?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    if (!this.sortBy) this.sortBy = this.defaultSortBy || this.columns[0]?.key || "";
    this.sortDir = this.defaultSortDir;
    this.#unsub = bus.on("model.changed", (msg) => {
      if (msg.model === this.model) this.load();
    });
    this.load();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#unsub?.();
  }

  // ── Точки розширення (override за потреби) ─────────────────────────────────
  /** Додаткові поля payload — напр. значення панелі фільтрів. */
  protected extraPayload(): Record<string, unknown> { return {}; }
  /** Повноширинна зона під тулбаром: фільтри, навігація по групах. */
  protected renderHeaderArea(): TemplateResult | string { return ""; }
  /** Додаткові кнопки тулбару (між стандартними діями та пошуком). */
  protected renderToolbarExtra(): TemplateResult | string { return ""; }
  /** Додаткові CSS-класи рядка (підсвітка за статусом тощо). */
  protected rowClass(_row: Row): string { return ""; }
  /**
   * Inline-стиль рядка (колір тексту/фону за статусом). Застосовується до
   * кожної `<td>`, щоб перекрити zebra; виділення рядка має пріоритет.
   * Напр.: `return row.isActive === false ? "color:#9ca3af" : "";`
   */
  protected rowStyle(_row: Row): string { return ""; }
  /** Підпис рядка для діалогу видалення. */
  protected rowLabel(row: Row): string {
    return (row as Record<string, unknown>).name as string ?? row.id;
  }
  /** Дія активації рядка (подвійний клік). За замовчуванням — відкрити edit. */
  protected onActivate(row: Row) { this.openEdit(row.id); }

  // ── Логіка ──────────────────────────────────────────────────────────────────
  protected async load() {
    // payload = службовий $query (+ розширення підкласу).
    // Відповідь `{ rows, totals[, $query] }` домержується у $root через assign:
    // якщо БД поверне ефективний $query — він віддзеркалиться назад.
    const env = await this.run<Partial<ListRoot<Row>>>(this.listCommand, {
      ...this.$root.$query,
      ...this.extraPayload(),
    });
    if (env.ok && env.data) this.assign(env.data);
  }

  /** Перезавантаження з першої сторінки (виклик з підкласу при зміні фільтрів). */
  protected reload() { this.page = 1; this.load(); }

  protected openEdit(id: string | null) {
    bus.emit({ type: "tab.open", route: this.editRoute, id });
  }

  protected async deleteSelected() {
    if (!this.selectedId) return;
    const row = this.rows.find((r) => r.id === this.selectedId);
    if (!confirm(`${t("common.confirmDelete")} "${row ? this.rowLabel(row) : ""}"?`)) return;
    // kind:"save" → data-service емітить model.changed → підписка нижче перезавантажує.
    await this.run("delete", { id: this.selectedId }, "save");
    this.selectedId = "";
  }

  #onSearch(e: Event) {
    this.search = (e.target as HTMLInputElement).value;
    this.page = 1;
    clearTimeout(this.#searchTimer);
    this.#searchTimer = setTimeout(() => this.load(), 300);
  }

  #setSort(col: ListColumn<Row>) {
    if (!col.sortable) return;
    if (this.sortBy === col.key) {
      this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
    } else {
      this.sortBy = col.key;
      this.sortDir = "asc";
    }
    this.page = 1;
    this.load();
  }

  #totalPages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); }

  #sortIcon(col: ListColumn<Row>) {
    if (!col.sortable) return "";
    if (this.sortBy !== col.key) return html`<span class="opacity-20">↕</span>`;
    return this.sortDir === "asc" ? html`<span>↑</span>` : html`<span>↓</span>`;
  }

  #cell(row: Row, col: ListColumn<Row>) {
    if (col.render) return col.render(row);
    const v = (row as Record<string, unknown>)[col.key];
    return v == null ? "" : String(v);
  }

  // ── Рендер ──────────────────────────────────────────────────────────────────
  override render() {
    const totalPages = this.#totalPages();

    return html`
      <div class="flex flex-col h-full">

        <!-- Тулбар -->
        <div class="flex items-center gap-2 p-2 border-b border-base-300 flex-wrap">
          <button class="btn btn-sm btn-primary" @click=${() => this.openEdit(null)}>
            ${icon.create} ${t("common.create")}
          </button>
          <button class="btn btn-sm" ?disabled=${!this.selectedId}
            @click=${() => this.openEdit(this.selectedId)}>
            ${icon.open} ${t("common.open")}
          </button>
          <button class="btn btn-sm btn-error btn-outline" ?disabled=${!this.selectedId}
            @click=${this.deleteSelected}>
            ${icon.delete} ${t("common.delete")}
          </button>
          ${this.renderToolbarExtra()}
          <div class="flex-1"></div>
          <label class="input input-sm flex items-center gap-2">
            ${icon.search}
            <input type="text" class="grow" placeholder="${t("common.search")}..."
              .value=${this.search} @input=${this.#onSearch} />
          </label>
          <button class="btn btn-sm btn-ghost" @click=${() => this.load()}>
            ${icon.refresh} ${t("common.refresh")}
          </button>
        </div>

        ${this.renderHeaderArea()}

        <!-- Таблиця -->
        <div class="flex-1 overflow-auto">
          ${this.loading
            ? html`<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>`
            : this.rows.length === 0
              ? html`<div class="text-center p-8 text-base-content/40">${t("common.noData")}</div>`
              : html`
                <table class="table table-sm table-zebra w-full">
                  <thead class="sticky top-0 bg-base-100 z-10">
                    <tr>
                      ${this.columns.map((col) => html`
                        <th
                          class="${col.sortable ? "sortable" : ""} ${alignClass(col.align)}"
                          style=${col.width ? `width:${col.width}` : ""}
                          @click=${() => this.#setSort(col)}
                        >
                          ${t(col.title)} ${this.#sortIcon(col)}
                        </th>
                      `)}
                    </tr>
                  </thead>
                  <tbody>
                    ${this.rows.map((row) => html`
                      <tr
                        class="cursor-pointer hover ${row.id === this.selectedId ? "selected" : ""} ${this.rowClass(row)}"
                        @click=${() => { this.selectedId = row.id; }}
                        @dblclick=${() => this.onActivate(row)}
                      >
                        ${this.columns.map((col) => html`
                          <td class="${col.muted ? "text-base-content/60" : ""} ${alignClass(col.align)}"
                            style=${[cellStyle(col), this.rowStyle(row)].filter(Boolean).join(";")}
                            title=${col.tooltip ? col.tooltip(row) : nothing}>
                            ${this.#cell(row, col)}
                          </td>
                        `)}
                      </tr>
                    `)}
                  </tbody>
                </table>
              `}
        </div>

        <!-- Пагінація -->
        <div class="flex items-center justify-between px-3 py-2 border-t border-base-300 text-sm">
          <span class="text-base-content/50">${this.total} ${t("common.records")}</span>
          <div class="join">
            <button class="join-item btn btn-xs" ?disabled=${this.page <= 1}
              @click=${() => { this.page = 1; this.load(); }}>«</button>
            <button class="join-item btn btn-xs" ?disabled=${this.page <= 1}
              @click=${() => { this.page--; this.load(); }}>‹</button>
            <button class="join-item btn btn-xs btn-disabled pointer-events-none">
              ${this.page} / ${totalPages}
            </button>
            <button class="join-item btn btn-xs" ?disabled=${this.page >= totalPages}
              @click=${() => { this.page++; this.load(); }}>›</button>
            <button class="join-item btn btn-xs" ?disabled=${this.page >= totalPages}
              @click=${() => { this.page = totalPages; this.load(); }}>»</button>
          </div>
          <select class="select select-xs w-20"
            @change=${(e: Event) => {
              this.pageSize = Number((e.target as HTMLSelectElement).value);
              this.page = 1;
              this.load();
            }}>
            ${this.pageSizeOptions.map((n) => html`
              <option value=${n} ?selected=${n === this.pageSize}>${n}</option>
            `)}
          </select>
        </div>
      </div>
    `;
  }
}
