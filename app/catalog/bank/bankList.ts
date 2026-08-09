import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { BankRow } from "./bank.schema.ts";
import { icons } from "@client/ui-kit/icons.ts";

export const tagName = "bank-list";

@customElement(tagName)
export class BankList extends ModelListBase<BankRow> {
  protected model = "bank";
  protected editRoute = "catalog/bank/edit";
  protected override defaultSortBy = "mfo";

  protected columns: ListColumn<BankRow>[] = [
    { key: "mfo",  title: "bank.mfo", width: "7rem", sortable: true },
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

  // Позначені на видалення — приглушено. Це ПІДКРІПЛЕННЯ до значка в
  // службовій колонці, а не єдина ознака: колір сам по собі повідомленням бути не може.
  // #9ca3af давав 2.54:1 до білого й 1.89:1 до виділеного рядка — тобто ознака,
  // якою рядок і відрізняється, сама була майже не видна. Це значення проходить
  // поріг AA і на білому, і на зебрі.
  protected override rowStyle(row: BankRow) {
    return row.isDeleted === true ? "color:#6b7280" : "";
  }
}
