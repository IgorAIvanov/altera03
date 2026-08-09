import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { CounterpartyRow } from "./counterparty.schema.ts";
import { icons } from "@client/ui-kit/icons.ts";

export const tagName = "counterparty-list";

@customElement(tagName)
export class CounterpartyList extends ModelListBase<CounterpartyRow> {
  protected model = "counterparty";
  protected editRoute = "catalog/counterparty/edit";
  protected override defaultSortBy = "code";

  protected columns: ListColumn<CounterpartyRow>[] = [
    { key: "code", title: "common.code", width: "8rem", sortable: true },
    { key: "name", title: "common.name", sortable: true, overflow: "ellipsis", tooltip: (r) => r.name },
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

  protected override rowStyle(row: CounterpartyRow) {
    return row.isDeleted === true ? "color:#6b7280" : "";
  }
}
