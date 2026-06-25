import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { tw } from "@client/shared/styles.ts";
import type { BankItem } from "./bank.schema.ts";

export const tagName = "bank-edit";

@customElement(tagName)
export class BankEdit extends SignalWatcher(LitElement) {
  static styles = [tw];

  @property({ type: String }) modelId: string | null = null;

  @state() private item: BankItem = { id: null, code: "", name: "", mfo: "" };
  @state() private loading = false;
  @state() private saving = false;
  @state() private pinging = false;
  @state() private pingResult: string | null = null;

  connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  async load() {
    this.loading = true;
    try {
      const data = await bus.request("data.load", {
        model: "bank",
        command: "get",
        payload: { id: this.modelId },
      }) as { data?: { item?: BankItem } };
      this.item = data?.data?.item ?? { code: "", name: "", mfo: "" };
    } finally {
      this.loading = false;
    }
  }

  async save() {
    this.saving = true;
    try {
      await bus.request("data.save", {
        model: "bank",
        command: "save",
        payload: { item: this.item },
      });
    } finally {
      this.saving = false;
    }
  }

  async ping() {
    this.pinging = true;
    this.pingResult = null;
    try {
      const res = await bus.request("data.load", {
        model: "bank",
        command: "ping",
        payload: { id: this.modelId },
      }) as {
        data?: { item?: Record<string, unknown> };
        messages?: { text?: string }[];
      };
      const message = res?.messages?.[0]?.text ?? "";
      const item = res?.data?.item ?? {};
      this.pingResult = `${message}\n${JSON.stringify(item, null, 2)}`;
    } catch (error) {
      this.pingResult = `Помилка: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.pinging = false;
    }
  }

  private setField(field: keyof BankItem, value: string) {
    this.item = { ...this.item, [field]: value };
  }

  render() {
    if (this.loading) return html`
      <div class="flex justify-center p-8">
        <span class="loading loading-spinner"></span>
      </div>
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

        <div class="form-control mb-4">
          <label class="label"><span class="label-text">${t("bank.mfo")}</span></label>
          <input class="input input-bordered" .value=${this.item.mfo}
            @input=${(e: Event) => this.setField("mfo", (e.target as HTMLInputElement).value)} />
        </div>

        <div class="flex gap-2 mt-6">
          <button class="btn btn-primary" ?disabled=${this.saving} @click=${this.save}>
            ${this.saving ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
            ${t("common.save")}
          </button>
          <button class="btn btn-outline" ?disabled=${this.pinging} @click=${this.ping}>
            ${this.pinging ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
            TS-команда (ping)
          </button>
        </div>

        ${this.pingResult
          ? html`<pre class="mt-4 p-3 rounded bg-base-200 text-xs whitespace-pre-wrap">${this.pingResult}</pre>`
          : ""}
      </div>
    `;
  }
}
