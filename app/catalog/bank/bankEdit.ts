import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import {
  BankEditRootSchema,
  type BankEditRoot,
  type BankItem,
} from "./bank.schema.ts";

export const tagName = "bank-edit";

/** Дані, які повертає `bank_ping`. */
interface BankPingData { item: Record<string, unknown>; }

@customElement(tagName)
export class BankEdit extends BaseUI<BankEditRoot> {
  protected model = "bank";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  /** Результат TS-команди ping — суто UI-стан. */
  private pingResult: string | null = null;

  constructor() {
    // $root ← Value.Create(BankEditRootSchema)
    //   = { item: { id: null, code: "", name: "", isActive: true }, options: {} }
    super(BankEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    // get повертає data = { item, options }; item === null → notFound
    await this.loadInto("get", { id: this.modelId });
  }

  private async save() {
    await this.run("save", { item: this.$root.item }, "save");
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

    const item = this.$root.item;

    return html`
      <div class="p-4 max-w-md">
        ${this.renderNotice()}
        <div class="form-control mb-4">
          <label class="label"><span class="label-text">${this.t("common.code")}</span></label>
          <input class="input input-bordered" .value=${item.code ?? ""}
            @input=${this.bindTo(item, "code")} />
        </div>

        <div class="form-control mb-4">
          <label class="label"><span class="label-text">${this.t("common.name")}</span></label>
          <input class="input input-bordered" .value=${item.name ?? ""}
            @input=${this.bindTo(item, "name")} />
        </div>

        <div class="form-control mb-4">
          <label class="label"><span class="label-text">${this.t("bank.mfo")}</span></label>
          <input class="input input-bordered" .value=${item.mfo ?? ""}
            @input=${this.bindTo(item, "mfo")} />
        </div>

        <div class="flex gap-2 mt-6">
          <button class="btn btn-primary" ?disabled=${!this.canSave} @click=${this.save}>
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
