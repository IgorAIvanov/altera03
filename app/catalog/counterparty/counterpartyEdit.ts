import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { tw } from "@client/shared/styles.ts";
import type { CounterpartyItem } from "./counterparty.schema.ts";

export const tagName = "counterparty-edit";

@customElement(tagName)
export class CounterpartyEdit extends SignalWatcher(LitElement) {
  static styles = [tw];

  @property({ type: String }) modelId: string | null = null;

  @state() private item: CounterpartyItem = { id: null, code: "", name: "", isActive: true };
  @state() private loading = false;
  @state() private saving = false;

  connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  async load() {
    this.loading = true;
    try {
      const data = await bus.request("data.load", {
        model: "counterparty",
        command: "get",
        payload: { id: this.modelId },
      }) as { data?: { item?: CounterpartyItem } };
      this.item = data?.data?.item ?? { id: null, code: "", name: "", isActive: true };
    } finally {
      this.loading = false;
    }
  }

  async save() {
    this.saving = true;
    try {
      await bus.request("data.save", {
        model: "counterparty",
        command: "save",
        payload: { item: this.item },
      });
    } finally {
      this.saving = false;
    }
  }

  private setField(field: keyof CounterpartyItem, value: string | boolean) {
    this.item = { ...this.item, [field]: value };
  }

  render() {
    if (this.loading) return html`
      <div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
    `;

    return html`
      <div class="p-4 max-w-md">
        <div class="form-control mb-4">
          <label class="label"><span class="label-text">${t("common.code")}</span></label>
          <input class="input input-bordered" .value=${this.item.code}
            @input=${(e: Event) => this.setField("code", (e.target as HTMLInputElement).value)} />
        </div>

        <div class="form-control mb-4">
          <label class="label"><span class="label-text">${t("common.name")}</span></label>
          <input class="input input-bordered" .value=${this.item.name}
            @input=${(e: Event) => this.setField("name", (e.target as HTMLInputElement).value)} />
        </div>

        <label class="label cursor-pointer justify-start gap-3 mb-4">
          <input type="checkbox" class="checkbox" .checked=${this.item.isActive ?? true}
            @change=${(e: Event) => this.setField("isActive", (e.target as HTMLInputElement).checked)} />
          <span class="label-text">${t("common.active") }</span>
        </label>

        <div class="flex gap-2 mt-6">
          <button class="btn btn-primary" ?disabled=${this.saving} @click=${this.save}>
            ${this.saving ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
            ${t("common.save")}
          </button>
        </div>
      </div>
    `;
  }
}
