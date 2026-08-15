import { customElement } from "lit/decorators.js";
import { ModelPickerBase } from "@client/ui-kit/base/model-picker-base.ts";
import type { ListColumn } from "@client/ui-kit/base/table-contract.ts";
import type { RemarkLookupRow } from "./remark.schema.ts";

export const tagName = "remark-picker";

/**
 * Вибір раніше поданого зауваження — щоб послатися на нього.
 *
 * Колонка одна: у назві вже стоїть номер (`№12 · Не проводиться накладна`), а
 * заголовки в потоці перевірки повторюються, тож без номера вибирати довелося б
 * навмання.
 */
@customElement(tagName)
export class RemarkPicker extends ModelPickerBase<RemarkLookupRow> {
  protected model = "remark";

  protected columns: ListColumn<RemarkLookupRow>[] = [
    { key: "name", title: "remark.titleOne" },
  ];
}
