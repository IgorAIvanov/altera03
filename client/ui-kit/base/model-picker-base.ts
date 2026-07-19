import { LitElement, html, css, nothing } from "lit";
import { property, state, query } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { tw } from "@client/shared/styles.ts";
import { alignClass, cellStyle, type ListColumn, type ListTotals, type SortDir } from "./model-list-base.ts";

const searchIcon = html`<svg class="h-4 w-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`;

/**
 * Базовий клас для діалогу вибору (picker) моделі.
 *
 * Рендериться всередині модалки `picker-host`, відкривається через
 * `bus.pick(route, params)` з кнопки-лупи компонента `<ui-picker>`.
 *
 * Підклас зобов'язаний задати `model` та `columns`. Уся механіка
 * (debounce-пошук, завантаження через bus, серверне сортування,
 * пагінація, контрастний вибір рядка, подвійний клік / Enter — підтвердити,
 * Escape — скасувати) реалізована тут.
 *
 * Колонки описуються тим самим типом `ListColumn`, що й у списку:
 * `align` керує вирівнюванням, `sortable` вмикає серверне сортування колонки.
 */
export abstract class ModelPickerBase<Row extends { id: string }> extends SignalWatcher(LitElement) {
  static override styles = [tw, css`
    :host { display: block; height: 100%; }
    tr.selected td { background: var(--color-primary) !important; color: var(--color-primary-content) !important; }
    th.sortable { cursor: pointer; user-select: none; }
  `];

  /** Локалізатор — доступний у render підкласу: `this.t("...")`. */
  protected t = t;

  // ── Обов'язкові для підкласу ──────────────────────────────────────────────
  protected abstract model: string;
  protected abstract columns: ListColumn<Row>[];

  // ── Опційні налаштування ──────────────────────────────────────────────────
  protected lookupCommand = "lookup";
  /** Поле рядка, що повертається як label вибраного значення. */
  protected labelField = "name";
  /** Розмір модалки — читається picker-host'ом. Override у підкласі за потреби. */
  protected dialogWidth = "560px";
  protected dialogHeight = "480px";
  protected defaultSortBy = "";
  protected defaultSortDir: SortDir = "asc";
  protected pageSizeOptions = [10, 20, 50];

  // ── Контракт picker-host ──────────────────────────────────────────────────
  @property({ type: String }) callbackId = "";
  @property({ type: Object }) params: Record<string, unknown> = {};

  @state() protected rows: Row[] = [];
  @state() protected loading = false;
  @state() protected search = "";
  @state() protected selectedId = "";
  @state() protected page = 1;
  @state() protected pageSize = 10;
  @state() protected sortBy = "";
  @state() protected sortDir: SortDir = "asc";
  @state() protected total = 0;

  @query("input") private _input?: HTMLInputElement;
  #searchTimer?: number;

  override connectedCallback() {
    super.connectedCallback();
    if (!this.sortBy) this.sortBy = this.defaultSortBy || this.columns.find((c) => c.sortable)?.key || "";
    this.sortDir = this.defaultSortDir;
    this.#load();
  }

  override firstUpdated() {
    this._input?.focus();
  }

  protected rowLabel(row: Row): string {
    return (row as Record<string, unknown>)[this.labelField] as string ?? row.id;
  }

  /** Inline-стиль рядка (колір) — застосовується до кожної `<td>`. */
  protected rowStyle(_row: Row): string { return ""; }

  async #load() {
    this.loading = true;
    try {
      const data = await bus.request("data.load", {
        model: this.model,
        command: this.lookupCommand,
        payload: {
          search: this.search,
          page: this.page,
          pageSize: this.pageSize,
          sortBy: this.sortBy,
          sortDir: this.sortDir,
          ...this.params,
        },
      }) as { data?: { rows?: Row[]; totals?: ListTotals } };
      this.rows = data?.data?.rows ?? [];
      this.total = data?.data?.totals?.count ?? 0;
    } finally {
      this.loading = false;
    }
  }

  #onSearch(e: Event) {
    this.search = (e.target as HTMLInputElement).value;
    this.page = 1;
    clearTimeout(this.#searchTimer);
    this.#searchTimer = setTimeout(() => this.#load(), 250);
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
    this.#load();
  }

  #sortIcon(col: ListColumn<Row>) {
    if (!col.sortable) return "";
    if (this.sortBy !== col.key) return html`<span class="opacity-20">↕</span>`;
    return this.sortDir === "asc" ? html`<span>↑</span>` : html`<span>↓</span>`;
  }

  #totalPages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); }

  #goto(page: number) { this.page = page; this.#load(); }

  #select(row: Row) {
    bus.emit({
      type: "picker.select",
      callbackId: this.callbackId,
      value: { id: row.id, label: this.rowLabel(row) },
    });
  }

  #confirm() {
    const row = this.rows.find((r) => r.id === this.selectedId);
    if (row) this.#select(row);
  }

  #cancel() {
    bus.emit({ type: "picker.cancel", callbackId: this.callbackId });
  }

  #onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && this.selectedId) { e.preventDefault(); this.#confirm(); }
    else if (e.key === "Escape") { e.preventDefault(); this.#cancel(); }
  }

  #cell(row: Row, col: ListColumn<Row>) {
    if (col.render) return col.render(row);
    const v = (row as Record<string, unknown>)[col.key];
    return v == null ? "" : String(v);
  }

  override render() {
    const totalPages = this.#totalPages();

    return html`
      <div class="flex flex-col h-full" @keydown=${this.#onKeydown}>

        <!-- Пошук -->
        <div class="p-3 pb-2">
          <label class="input input-sm w-full flex items-center gap-2">
            ${searchIcon}
            <input type="text" class="grow" placeholder="${t("common.search")}..."
              .value=${this.search} @input=${this.#onSearch} />
          </label>
        </div>

        <!-- Список -->
        <div class="flex-1 overflow-y-auto px-3">
          ${this.loading
            ? html`<div class="flex justify-center p-6"><span class="loading loading-spinner"></span></div>`
            : this.rows.length === 0
              ? html`<div class="text-center p-6 text-base-content/40">${t("common.notFound")}</div>`
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
                        class="cursor-pointer hover ${row.id === this.selectedId ? "selected" : ""}"
                        @click=${() => { this.selectedId = row.id; }}
                        @dblclick=${() => this.#select(row)}
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
            <button class="join-item btn btn-xs" ?disabled=${this.page <= 1} @click=${() => this.#goto(1)}>«</button>
            <button class="join-item btn btn-xs" ?disabled=${this.page <= 1} @click=${() => this.#goto(this.page - 1)}>‹</button>
            <button class="join-item btn btn-xs btn-disabled pointer-events-none">${this.page} / ${totalPages}</button>
            <button class="join-item btn btn-xs" ?disabled=${this.page >= totalPages} @click=${() => this.#goto(this.page + 1)}>›</button>
            <button class="join-item btn btn-xs" ?disabled=${this.page >= totalPages} @click=${() => this.#goto(totalPages)}>»</button>
          </div>
          <select class="select select-xs w-16"
            @change=${(e: Event) => {
              this.pageSize = Number((e.target as HTMLSelectElement).value);
              this.page = 1;
              this.#load();
            }}>
            ${this.pageSizeOptions.map((n) => html`
              <option value=${n} ?selected=${n === this.pageSize}>${n}</option>
            `)}
          </select>
        </div>

        <!-- Дії -->
        <div class="flex justify-end gap-2 p-3 border-t border-base-300">
          <button class="btn btn-sm" @click=${this.#cancel}>${t("common.cancel")}</button>
          <button class="btn btn-sm btn-primary" ?disabled=${!this.selectedId}
            @click=${this.#confirm}>${t("common.select")}</button>
        </div>
      </div>
    `;
  }
}
