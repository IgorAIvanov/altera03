import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { bus } from "@client/bus/bus.ts";
import { tw } from "@client/shared/styles.ts";

export const tagName = "bank-picker";

interface BankRow {
  id: string;
  name: string;
  mfo?: string;
}

@customElement(tagName)
export class BankPicker extends LitElement {
  static styles = [tw];

  @property({ type: String }) callbackId = "";
  @property({ type: Object }) params: Record<string, unknown> = {};

  @state() private rows: BankRow[] = [];
  @state() private loading = false;
  @state() private fragment = "";
  @state() private selectedId = "";

  connectedCallback() {
    super.connectedCallback();
    this._load("");
  }

  private async _load(fragment: string) {
    this.loading = true;
    try {
      const res = await fetch(`/api/model/bank/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search: fragment, ...this.params }),
      });
      const data = await res.json();
      const rows = data?.data?.rows ?? data?.rows ?? [];
      this.rows = Array.isArray(rows) ? rows : [];
    } catch (e) {
      console.error("[bank-picker] load error:", e);
    } finally {
      this.loading = false;
    }
  }

  private _onSearch(e: Event) {
    this.fragment = (e.target as HTMLInputElement).value;
    this._load(this.fragment);
  }

  private _select(row: BankRow) {
    bus.emit({
      type: "picker.select",
      callbackId: this.callbackId,
      value: { id: row.id, label: row.name },
    });
  }

  private _cancel() {
    bus.emit({ type: "picker.cancel", callbackId: this.callbackId });
  }

  render() {
    return html`
      <div class="flex flex-col h-full">
        <div class="p-3 border-b border-base-300">
          <input
            type="text"
            class="input input-bordered input-sm w-full"
            placeholder="Пошук банку..."
            .value=${this.fragment}
            @input=${this._onSearch}
          />
        </div>

        <div class="flex-1 overflow-y-auto">
          ${this.loading
            ? html`<div class="flex justify-center p-6"><span class="loading loading-spinner"></span></div>`
            : this.rows.length === 0
              ? html`<div class="text-center p-6 text-base-content/40">Нічого не знайдено</div>`
              : html`
                <table class="table table-zebra table-sm w-full">
                  <thead>
                    <tr>
                      <th>Назва</th>
                      <th>МФО</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.rows.map(row => html`
                      <tr
                        class="cursor-pointer hover ${row.id === this.selectedId ? "bg-primary/10" : ""}"
                        @click=${() => { this.selectedId = row.id; }}
                        @dblclick=${() => this._select(row)}
                      >
                        <td>${row.name}</td>
                        <td class="text-base-content/60">${row.mfo ?? ""}</td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              `}
        </div>

        <div class="flex justify-end gap-2 p-3 border-t border-base-300">
          <button class="btn btn-sm" @click=${this._cancel}>Скасувати</button>
          <button
            class="btn btn-sm btn-primary"
            ?disabled=${!this.selectedId}
            @click=${() => {
              const row = this.rows.find(r => r.id === this.selectedId);
              if (row) this._select(row);
            }}
          >
            Вибрати
          </button>
        </div>
      </div>
    `;
  }
}
