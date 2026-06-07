import { customElement } from "lit/decorators.js";
import { ModelListBase, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { BankRow } from "./bank.schema.ts";

export const tagName = "bank-list";

@customElement(tagName)
export class BankList extends ModelListBase<BankRow> {
  protected model = "bank";
  protected editRoute = "catalog/bank/edit";
  protected defaultSortBy = "code";

  protected columns: ListColumn<BankRow>[] = [
    { key: "code", title: "common.code", width: "8rem", sortable: true },
    { key: "name", title: "common.name", sortable: true },
    { key: "mfo",  title: "bank.mfo", width: "7rem", muted: true, sortable: true },
  ];
}
