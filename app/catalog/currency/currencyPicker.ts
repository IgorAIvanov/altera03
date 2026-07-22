import { customElement } from "lit/decorators.js";
import { ModelPickerBase } from "@client/ui-kit/base/model-picker-base.ts";
import type { ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { CurrencyLookupRow } from "./currency.schema.ts";

export const tagName = "currency-picker";

@customElement(tagName)
export class CurrencyPicker extends ModelPickerBase<CurrencyLookupRow> {
  protected model = "currency";
  protected override defaultSortBy = "code";

  /** Валюта ідентифікується КОДОМ (UAH/USD): він лягає в проводку, а не id. */
  protected override labelField = "code";

  protected columns: ListColumn<CurrencyLookupRow>[] = [
    { key: "code", title: "common.code", width: "6rem", sortable: true },
    { key: "name", title: "common.name", sortable: true },
  ];
}
