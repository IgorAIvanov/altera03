import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { CounterpartyRow } from "./counterparty.schema.ts";

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
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      `,
    },
  ];

  protected override rowStyle(row: CounterpartyRow) {
    return row.isDeleted === true ? "color:#6b7280" : "";
  }
}
