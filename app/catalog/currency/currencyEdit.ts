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

  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
    `;

    const item = this.$root.item;

    return html`
      <div class="p-4 max-w-lg flex flex-col gap-2">
        ${this.renderNotice()}

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

        <label class="label cursor-pointer justify-start gap-2 mt-1">
          <input type="checkbox" class="checkbox checkbox-sm" .checked=${item.isActive !== false}
            @change=${(e: Event) => { item.isActive = (e.target as HTMLInputElement).checked; }} />
          <span class="text-sm">${this.t("currency.isActive")}</span>
        </label>

        ${this.renderFormActions()}
      </div>
    `;
  }
}
