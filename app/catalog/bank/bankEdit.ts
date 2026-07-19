import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import { BankItemSchema, type BankItem } from "./bank.schema.ts";

export const tagName = "bank-edit";

/** Дані, які повертає `bank_get` / `bank_ping`. */
interface BankGetData { item: BankItem | null; }
interface BankPingData { item: Record<string, unknown>; }

@customElement(tagName)
export class BankEdit extends BaseUI<BankItem> {
  protected model = "bank";

  @property({ type: String }) modelId: string | null = null;

  /** Результат TS-команди ping — суто UI-стан. */
  private pingResult: string | null = null;

  constructor() {
    // $root ← Value.Create(BankItemSchema) = { id: null, code: "", name: "", isActive: true }
    super(BankItemSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    const env = await this.run<BankGetData>("get", { id: this.modelId });
    if (env.ok && env.data?.item) this.assign(env.data.item);
  }

  private async save() {
    await this.run("save", { item: this.$root }, "save");
  }

  private async ping() {
    const env = await this.run<BankPingData>("ping", { id: this.modelId });
    const text = this.messages[0]?.text ?? "";
    this.pingResult = `${text}\n${JSON.stringify(env.data?.item ?? {}, null, 2)}`;
    this.requestUpdate();
  }

  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8">
        <span class="loading loading-spinner"></span>
      </div>
    `;

    return html`
      <div class="p-4 max-w-md">
        <div class="form-control mb-4">
          <label class="label"><span class="label-text">${this.t("common.code")}</span></label>
          <input class="input input-bordered" .value=${this.$root.code ?? ""}
            @input=${this.bind("code")} />
        </div>

        <div class="form-control mb-4">
          <label class="label"><span class="label-text">${this.t("common.name")}</span></label>
          <input class="input input-bordered" .value=${this.$root.name ?? ""}
            @input=${this.bind("name")} />
        </div>

        <div class="form-control mb-4">
          <label class="label"><span class="label-text">${this.t("bank.mfo")}</span></label>
          <input class="input input-bordered" .value=${this.$root.mfo ?? ""}
            @input=${this.bind("mfo")} />
        </div>

        <div class="flex gap-2 mt-6">
          <button class="btn btn-primary" ?disabled=${this.busy} @click=${this.save}>
            ${this.running === "save" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
            ${this.t("common.save")}
          </button>
          <button class="btn btn-outline" ?disabled=${this.busy} @click=${this.ping}>
            ${this.running === "ping" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
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
