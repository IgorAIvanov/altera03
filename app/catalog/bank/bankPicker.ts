import { customElement } from "lit/decorators.js";
import { ModelPickerBase } from "@client/ui-kit/base/model-picker-base.ts";
import type { ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { BankLookupRow } from "./bank.schema.ts";

export const tagName = "bank-picker";

@customElement(tagName)
export class BankPicker extends ModelPickerBase<BankLookupRow> {
  protected model = "bank";
  protected defaultSortBy = "name";

  protected columns: ListColumn<BankLookupRow>[] = [
    { key: "name", title: "common.name", sortable: true },
    { key: "mfo",  title: "bank.mfo", width: "7rem", muted: true, align: "right", sortable: true },
  ];
}
