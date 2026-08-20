import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import { SubordinateRegister } from "@client/ui-kit/subordinate/subordinate-register.ts";
import "@client/ui-kit/subordinate/ui-subordinate-register.ts";
import { dateFormat } from "@client/shared/datetime.ts";
import { CurrencyEditRootSchema, type CurrencyEditRoot } from "./currency.schema.ts";
import type { CurrencyRateRow } from "../../data/currency_rate/currency_rate.schema.ts";

export const tagName = "currency-edit";

@customElement(tagName)
export class CurrencyEdit extends BaseUI<CurrencyEditRoot> {
  protected model = "currency";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(CurrencyEditRootSchema);
  }

  /**
   * Курси валюти просто в її картці — еталон підпорядкованого регістру.
   *
   * Оголошення тут, а не в манифесті: ключі колонок перевіряє компілятор, а
   * панель ядра малює решту — смугу дій, сітку з правкою в рядку, порожній
   * стан, підказку «спершу збережіть картку» й запис ОДРАЗУ командами моделі
   * `currency_rate`. Колонка одна на показ і на правку: `kind` каже, чим
   * комірка правиться. Відбір по власнику панель виводить сама: `currencyId` →
   * ключ `currency`, тобто ім'я ссылки, як його читає згенерований `_list`.
   */
  private rates = new SubordinateRegister<CurrencyRateRow>(this, {
    model: "currency_rate",
    ownerField: "currencyId",
    ownerId: () => this.$root.item.id,
    titleKey: "currencyRate.titleMany",
    sortBy: "period",
    // Курсів за десять років тисячі: видно вікно останніх, а «Перейти до
    // дати» ставить його на будь-яку іншу. Поле мусить нести
    // `x-filter: { op: "range" }` — воно й дає ключ `periodTo`.
    dateField: "period",
    readonly: () => this.readonlyMode,
    columns: [
      {
        kind: "date",
        key: "period",
        title: "currencyRate.period",
        width: "8rem",
        format: dateFormat.date,
        required: true,
      },
      { kind: "decimal", key: "rate", title: "currencyRate.rate", width: "8rem", precision: 6, required: true },
      { kind: "decimal", key: "multiplicity", title: "currencyRate.multiplicity", width: "8rem", precision: 0 },
    ],
    createRow: () => ({ id: "", currency: { id: "", name: "" }, period: "", rate: 0, multiplicity: 1 }),
  });

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

          <ui-subordinate-register .register=${this.rates}></ui-subordinate-register>
              </div>
    `);
  }
}
