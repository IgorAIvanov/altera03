import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { tw } from "@client/shared/styles.ts";

export const tagName = "bank-list";

interface BankRow {
  id: string;
  code: string;
  name: string;
  mfo: string;
}

interface Totals {
  count: number;
  page: number;
  pageSize: number;
}

type SortDir = "asc" | "desc";

@customElement(tagName)
export class BankList extends SignalWatcher(LitElement) {
  static styles = [tw, css`
    tr.selected { background: var(--color-primary) !important; color: var(--color-primary-content) !important; }
  `];

  @state() private rows: BankRow[] = [];
  @state() private loading = false;
  @state() private selectedId = "";
  @state() private search = "";
  @state() private page = 1;
  @state() private pageSize = 20;
  @state() private sortBy = "code";
  @state() private sortDir: SortDir = "asc";
  @state() private total = 0;

  private _searchTimer?: number;
  private unsub?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this.unsub = bus.on("model.changed", (msg) => {
      if (msg.model === "bank") this.load();
    });
    this.load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsub?.();
  }

  async load() {
    if (this.rows.length === 0) this.loading = true;
    try {
      const data = await bus.request("data.load", {
        model: "bank",
        command: "list",
        payload: {
          search: this.search,
          page: this.page,
          pageSize: this.pageSize,
          sortBy: this.sortBy,
          sortDir: this.sortDir,
        },
      }) as { data?: { rows?: BankRow[]; totals?: Totals } };
      this.rows = data?.data?.rows ?? [];
      this.total = data?.data?.totals?.count ?? 0;
    } finally {
      this.loading = false;
    }
  }

  private openEdit(id: string | null) {
    bus.emit({ type: "tab.open", route: "catalog/bank/edit", id });
  }

  private async deleteSelected() {
    if (!this.selectedId) return;
    const row = this.rows.find(r => r.id === this.selectedId);
    if (!confirm(`Видалити банк "${row?.name}"?`)) return;
    await bus.request("data.save", {
      model: "bank",
      command: "delete",
      payload: { id: this.selectedId },
    });
    this.selectedId = "";
  }

  private onSearchInput(e: Event) {
    this.search = (e.target as HTMLInputElement).value;
    this.page = 1;
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.load(), 300);
  }

  private setSort(col: string) {
    if (this.sortBy === col) {
      this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
    } else {
      this.sortBy = col;
      this.sortDir = "asc";
    }
    this.page = 1;
    this.load();
  }

  private totalPages() {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  private sortIcon(col: string) {
    if (this.sortBy !== col) return html`<span class="opacity-20">↕</span>`;
    return this.sortDir === "asc" ? html`<span>↑</span>` : html`<span>↓</span>`;
  }

  render() {
    const totalPages = this.totalPages();

    return html`
      <div class="flex flex-col h-full">

        <!-- Toolbar -->
        <div class="flex items-center gap-2 p-2 border-b border-base-300 flex-wrap">
          <button class="btn btn-sm btn-primary" @click=${() => this.openEdit(null)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            ${t("common.create")}
          </button>
          <button class="btn btn-sm" ?disabled=${!this.selectedId}
            @click=${() => this.openEdit(this.selectedId)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            ${t("common.open")}
          </button>
          <button class="btn btn-sm btn-error btn-outline" ?disabled=${!this.selectedId}
            @click=${this.deleteSelected}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            ${t("common.delete")}
          </button>
          <div class="flex-1"></div>
          <label class="input input-sm flex items-center gap-2">
            <svg class="h-4 w-4 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input type="text" class="grow" placeholder="${t("common.search")}..."
              .value=${this.search} @input=${this.onSearchInput} />
          </label>
          <button class="btn btn-sm btn-ghost" @click=${() => this.load()}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            ${t("common.refresh")}
          </button>
        </div>

        <!-- Table -->
        <div class="flex-1 overflow-auto">
          ${this.loading
            ? html`<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>`
            : this.rows.length === 0
              ? html`<div class="text-center p-8 text-base-content/40">${t("common.noData")}</div>`
              : html`
                <table class="table table-sm table-zebra w-full">
                  <thead class="sticky top-0 bg-base-100 z-10">
                    <tr>
                      <th class="cursor-pointer select-none w-32" @click=${() => this.setSort("code")}>
                        ${t("common.code")} ${this.sortIcon("code")}
                      </th>
                      <th class="cursor-pointer select-none" @click=${() => this.setSort("name")}>
                        ${t("common.name")} ${this.sortIcon("name")}
                      </th>
                      <th class="cursor-pointer select-none w-28" @click=${() => this.setSort("mfo")}>
                        ${t("bank.mfo")} ${this.sortIcon("mfo")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.rows.map(row => html`
                      <tr
                        class="cursor-pointer hover ${row.id === this.selectedId ? "selected" : ""}"
                        @click=${() => { this.selectedId = row.id; }}
                        @dblclick=${() => this.openEdit(row.id)}
                      >
                        <td>${row.code}</td>
                        <td>${row.name}</td>
                        <td class="text-base-content/60">${row.mfo ?? ""}</td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              `}
        </div>

        <!-- Pagination -->
        <div class="flex items-center justify-between px-3 py-2 border-t border-base-300 text-sm">
          <span class="text-base-content/50">
            ${this.total} ${t("common.records")}
          </span>
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
          <select class="select select-xs w-20" .value=${String(this.pageSize)}
            @change=${(e: Event) => {
              this.pageSize = Number((e.target as HTMLSelectElement).value);
              this.page = 1;
              this.load();
            }}>
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
      </div>
    `;
  }
}
