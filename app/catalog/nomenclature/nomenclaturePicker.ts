import { customElement } from "lit/decorators.js";
import { ModelPickerBase } from "@client/ui-kit/base/model-picker-base.ts";
import type { ListColumn } from "@client/ui-kit/base/table-contract.ts";
import type { NomenclatureLookupRow } from "./nomenclature.schema.ts";

export const tagName = "nomenclature-picker";

@customElement(tagName)
export class NomenclaturePicker extends ModelPickerBase<NomenclatureLookupRow> {
  protected model = "nomenclature";
  protected override defaultSortBy = "name";

  protected columns: ListColumn<NomenclatureLookupRow>[] = [
    { key: "name", title: "common.name", sortable: true },
  ];
}
