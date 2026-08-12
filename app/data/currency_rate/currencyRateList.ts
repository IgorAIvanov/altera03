import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { type ListColumn, ModelListBase, stopRow } from "@client/ui-kit/base/model-list-base.ts";
import { dateFormat } from "@client/shared/datetime.ts";
import { icons } from "@client/ui-kit/icons.ts";
import type { CurrencyRateRow } from "./currency_rate.schema.ts";

export const tagName = "currency-rate-list";

@customElement(tagName)
export class CurrencyRateList extends ModelListBase<CurrencyRateRow> {
  protected model = "currency_rate";
  protected editRoute = "data/currency_rate/edit";
  // Свіже зверху: у регістрі дивляться на останні значення, а не на перші.
  protected override defaultSortBy = "period";
  protected override defaultSortDir = "desc" as const;

  protected columns: ListColumn<CurrencyRateRow>[] = [
    { key: "period", title: "currencyRate.period", width: "8rem", sortable: true, format: dateFormat.date },
    {
      key: "currency",
      title: "currencyRate.currency",
      width: "10rem",
      sortable: true,
      render: (row) => row.currency?.name ?? "",
      // Колонка малює вкладений об'єкт, тож вивантаженню треба сказати, що
      // саме йде у файл, — інакше в Excel поїде «[object Object]».
      exportText: (row) => row.currency?.name ?? "",
    },
    { key: "rate", title: "currencyRate.rate", width: "8rem", align: "right" },
    { key: "multiplicity", title: "currencyRate.multiplicity", width: "7rem", align: "right" },
    {
      key: "_actions",
      title: "",
      width: "3rem",
      align: "center",
      render: (row) => html`
        <button class="btn btn-ghost btn-xs px-1" title=${this.t("common.open")}
          @click=${stopRow(() => this.openEdit(row.id))}>
          ${icons.open}
        </button>
      `,
    },
  ];
}
