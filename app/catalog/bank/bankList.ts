import { LitElement, html } from "lit";
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
}

@customElement(tagName)
export class BankList extends SignalWatcher(LitElement) {
  static styles = [tw];

  @state() private rows: BankRow[] = [];
  @state() private loading = false;

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
      <div class="p-4">
        <div class="flex gap-2 mb-4">
          <button class="btn btn-sm" @click=${() => this.load()}>${t("common.refresh")}</button>
          <button class="btn btn-sm btn-primary" @click=${() => this.openEdit(null)}>${t("common.create")}</button>
        </div>

        ${this.loading
          ? html`<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>`
          : this.rows.length === 0
            ? html`<div class="text-center p-8 text-base-content/40">${t("common.noData")}</div>`
            : html`
              <table class="table table-zebra w-full">
                <thead>
                  <tr>
                    <th>${t("common.code")}</th>
                    <th>${t("common.name")}</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.rows.map(row => html`
                    <tr class="cursor-pointer hover" @click=${() => this.openEdit(row.id)}>
                      <td>${row.code}</td>
                      <td>${row.name}</td>
                    </tr>
                  `)}
                </tbody>
              </table>
            `}
      </div>
    `;
  }
}
