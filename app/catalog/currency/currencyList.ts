import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { CurrencyRow } from "./currency.schema.ts";
import { icons } from "@client/ui-kit/icons.ts";

export const tagName = "currency-list";

@customElement(tagName)
export class CurrencyList extends ModelListBase<CurrencyRow> {
  protected model = "currency";
  protected editRoute = "catalog/currency/edit";
  protected override defaultSortBy = "code";

  protected columns: ListColumn<CurrencyRow>[] = [
    { key: "code", title: "common.code", width: "6rem", sortable: true },
    { key: "name", title: "common.name", sortable: true, overflow: "ellipsis", tooltip: (r) => r.name },
    { key: "numericCode", title: "currency.numericCode", width: "8rem", muted: true, align: "right" },
    { key: "symbol", title: "currency.symbol", width: "5rem", align: "center" },
    {
      key: "_actions", title: "", width: "3rem", align: "center",
      render: (row) => html`
        <button class="btn btn-ghost btn-xs px-1" title=${this.t("common.open")}
          @click=${stopRow(() => this.openEdit(row.id))}>
          ${icons.open}
        </button>
      `,
    },
  ];

  protected override rowStyle(row: CurrencyRow) {
    return row.isDeleted === true ? "color:#6b7280" : "";
  }
}
