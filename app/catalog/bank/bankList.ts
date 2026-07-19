import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { BankRow } from "./bank.schema.ts";

export const tagName = "bank-list";

@customElement(tagName)
export class BankList extends ModelListBase<BankRow> {
  protected model = "bank";
  protected editRoute = "catalog/bank/edit";
  protected override defaultSortBy = "code";

  protected columns: ListColumn<BankRow>[] = [
    { key: "code", title: "common.code", width: "8rem", sortable: true },
    { key: "name", title: "common.name", sortable: true, overflow: "ellipsis", tooltip: (r) => r.name },
    { key: "mfo",  title: "bank.mfo", width: "7rem", muted: true, align: "right", sortable: true },
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

  // приклад кольору рядка: неактивні банки — приглушено
  protected override rowStyle(row: BankRow) {
    return row.isActive === false ? "color:#9ca3af" : "";
  }
}
