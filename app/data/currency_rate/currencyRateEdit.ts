import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import { dateFormat } from "@client/shared/datetime.ts";
import "@client/ui-kit/components/ui-date.ts";
import "@client/ui-kit/components/ui-decimal.ts";
import "@client/ui-kit/components/ui-picker.ts";
import type { PickerChangeEvent } from "@client/ui-kit/components/ui-picker.ts";
import { type CurrencyRateEditRoot, CurrencyRateEditRootSchema } from "./currency_rate.schema.ts";

export const tagName = "currency-rate-edit";

@customElement(tagName)
export class CurrencyRateEdit extends BaseUI<CurrencyRateEditRoot> {
  protected model = "currency_rate";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(CurrencyRateEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  protected override formWidth = "max-w-md";

  override render() {
    if (this.running === "get") {
      return html`<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>`;
    }

    const item = this.$root.item;

    return this.renderForm(html`
      <div class="flex flex-col gap-2">
        ${this.renderField(
          this.t("currencyRate.currency"),
          html`<ui-picker
            url="catalog/currency"
            ?disabled=${this.readonlyMode}
            .value=${item.currency ?? null}
            @value-changed=${(e: PickerChangeEvent) => this.setRef("currency", e.detail.value)}
          ></ui-picker>`,
          { field: "currencyId" },
        )}

        ${this.renderField(
          this.t("currencyRate.period"),
          html`<ui-date
            format=${dateFormat.date}
            .value=${item.period ?? ""}
            ?disabled=${this.readonlyMode}
            @change=${this.bindTo(item, "period")}
          ></ui-date>`,
          { field: "period", class: "w-40" },
        )}

        ${this.renderField(
          this.t("currencyRate.rate"),
          html`<ui-decimal
            .value=${item.rate}
            scale="6"
            ?disabled=${this.readonlyMode}
            @change=${this.bindTo(item, "rate")}
          ></ui-decimal>`,
          { field: "rate", class: "w-40" },
        )}

        ${this.renderField(
          this.t("currencyRate.multiplicity"),
          html`<ui-decimal
            .value=${item.multiplicity}
            scale="0"
            ?disabled=${this.readonlyMode}
            @change=${this.bindTo(item, "multiplicity")}
          ></ui-decimal>`,
          { field: "multiplicity", class: "w-32" },
        )}
      </div>
    `);
  }
}
