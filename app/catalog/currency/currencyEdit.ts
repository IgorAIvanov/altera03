import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import { CurrencyEditRootSchema, type CurrencyEditRoot } from "./currency.schema.ts";

export const tagName = "currency-edit";

@customElement(tagName)
export class CurrencyEdit extends BaseUI<CurrencyEditRoot> {
  protected model = "currency";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(CurrencyEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  protected override formWidth = "max-w-lg";


  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
    `;

    const item = this.$root.item;

    return this.renderForm(html`
      <div class="flex flex-col gap-2">
          <div class="flex gap-2">
            ${this.renderField(
              this.t("common.code"),
              html`<input class="input input-bordered w-full" maxlength="3" .value=${item.code ?? ""}
                @input=${this.bindTo(item, "code")} />`,
              { class: "w-24", field: "code" },
            )}
            ${this.renderField(
              this.t("common.name"),
              html`<input class="input input-bordered w-full" .value=${item.name ?? ""}
                @input=${this.bindTo(item, "name")} />`,
              { class: "flex-1", field: "name" },
            )}
          </div>

          <div class="flex gap-2">
            ${this.renderField(
              this.t("currency.numericCode"),
              html`<input class="input input-bordered w-full" maxlength="3" .value=${item.numericCode ?? ""}
                @input=${this.bindTo(item, "numericCode")} />`,
              { class: "w-32", field: "numericCode" },
            )}
            ${this.renderField(
              this.t("currency.symbol"),
              html`<input class="input input-bordered w-full" maxlength="8" .value=${item.symbol ?? ""}
                @input=${this.bindTo(item, "symbol")} />`,
              { class: "w-24", field: "symbol" },
            )}
          </div>

              </div>
    `);
  }
}
