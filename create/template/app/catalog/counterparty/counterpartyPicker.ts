import { customElement } from "lit/decorators.js";
import { ModelPickerBase } from "@client/ui-kit/base/model-picker-base.ts";
import type { ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { CounterpartyLookupRow } from "./counterparty.schema.ts";

export const tagName = "counterparty-picker";

/**
 * Діалог вибору. Його відкриває `<ui-picker url="catalog/counterparty">` —
 * `url` це маршрут в'ю, а не шлях API.
 */
@customElement(tagName)
export class CounterpartyPicker extends ModelPickerBase<CounterpartyLookupRow> {
  protected model = "counterparty";
  protected override defaultSortBy = "name";

  protected columns: ListColumn<CounterpartyLookupRow>[] = [
    { key: "name", title: "common.name", sortable: true },
    { key: "edrpou", title: "counterparty.edrpou", width: "8rem", muted: true, align: "right", sortable: true },
  ];
}
