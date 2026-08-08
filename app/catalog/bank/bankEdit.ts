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
    //   = { item: { id: null, code: "", name: "", isDeleted: false }, options: {} }
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

  private async ping() {
    const env = await this.run<BankPingData>("ping", { id: this.modelId });
    const text = this.messages[0]?.text ?? "";
    this.pingResult = `${text}\n${JSON.stringify(env.data?.item ?? {}, null, 2)}`;
    this.requestUpdate();
  }

  /** Проста картка — вузька колонка; ширші форми лишають типове `max-w-3xl`. */
  protected override formWidth = "max-w-md";

  /** Своя дія над записом — ліворуч, одразу за стандартними кнопками. */
  protected override renderActions() {
    return html`
      <button class="btn btn-sm btn-outline" ?disabled=${this.busy} @click=${this.ping}>
        ${this.running === "ping" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
        TS-команда (ping)
      </button>
    `;
  }

  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8">
        <span class="loading loading-spinner"></span>
      </div>
    `;

    const item = this.$root.item;

    return this.renderForm(html`
      <div class="flex flex-col gap-2">
          ${this.renderField(
            this.t("common.code"),
            html`<input class="input input-bordered w-full" .value=${item.code ?? ""}
              @input=${this.bindTo(item, "code")} />`,
            { field: "code" },
          )}

          ${this.renderField(
            this.t("common.name"),
            html`<input class="input input-bordered w-full" .value=${item.name ?? ""}
              @input=${this.bindTo(item, "name")} />`,
            { field: "name" },
          )}

          ${this.renderField(
            this.t("bank.mfo"),
            html`<input class="input input-bordered w-full" .value=${item.mfo ?? ""}
              @input=${this.bindTo(item, "mfo")} />`,
            { field: "mfo" },
          )}

        ${this.pingResult
          ? html`<pre class="mt-4 p-3 rounded bg-base-200 text-xs whitespace-pre-wrap">${this.pingResult}</pre>`
          : ""}
      </div>
    `);
  }
}
