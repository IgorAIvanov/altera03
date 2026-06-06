import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";

export const tagName = "bank-list";

interface BankRow {
  id: string;
  code: string;
  name: string;
}

@customElement(tagName)
export class BankList extends SignalWatcher(LitElement) {
  static styles = css`
    :host { display: block; padding: 1rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.5rem 1rem; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { font-weight: 600; color: #6b7280; font-size: 0.875rem; }
    tr:hover td { background: #f9fafb; cursor: pointer; }
    .toolbar { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    button { padding: 0.4rem 1rem; border-radius: 6px; border: 1px solid #d1d5db; background: white; cursor: pointer; }
    button:hover { background: #f3f4f6; }
    .empty { text-align: center; padding: 2rem; color: #9ca3af; }
  `;

  @state() private rows: BankRow[] = [];
  @state() private loading = false;

  private unsub?: () => void;

  connectedCallback() {
    super.connectedCallback();
    // обновляемся когда кто-то изменил банк
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
    this.loading = true;
    try {
      const data = await bus.request("data.load", { model: "bank", command: "index" }) as { rows?: BankRow[] };
      this.rows = data?.rows ?? [];
    } finally {
      this.loading = false;
    }
  }

  private openEdit(id: string | null) {
    bus.emit({ type: "tab.open", route: "catalog/bank/edit", id });
  }

  render() {
    return html`
      <div class="toolbar">
        <button @click=${() => this.load()}>${t("common.refresh")}</button>
        <button @click=${() => this.openEdit(null)}>${t("common.create")}</button>
      </div>

      ${this.loading
        ? html`<div class="empty">...</div>`
        : this.rows.length === 0
          ? html`<div class="empty">${t("common.noData")}</div>`
          : html`
            <table>
              <thead>
                <tr>
                  <th>${t("common.code")}</th>
                  <th>${t("common.name")}</th>
                </tr>
              </thead>
              <tbody>
                ${this.rows.map(row => html`
                  <tr @click=${() => this.openEdit(row.id)}>
                    <td>${row.code}</td>
                    <td>${row.name}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          `}
    `;
  }
}
