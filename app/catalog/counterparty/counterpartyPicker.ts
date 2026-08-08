import { customElement } from "lit/decorators.js";
import { ModelPickerBase } from "@client/ui-kit/base/model-picker-base.ts";
import type { ListColumn } from "@client/ui-kit/base/table-contract.ts";
import type { CounterpartyLookupRow } from "./counterparty.schema.ts";

export const tagName = "counterparty-picker";

@customElement(tagName)
export class CounterpartyPicker extends ModelPickerBase<CounterpartyLookupRow> {
  protected model = "counterparty";
  protected override defaultSortBy = "name";

  protected columns: ListColumn<CounterpartyLookupRow>[] = [
    { key: "name", title: "common.name", sortable: true },
  ];
}
