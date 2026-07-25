import { customElement } from "lit/decorators.js";
import { ModelPickerBase } from "@client/ui-kit/base/model-picker-base.ts";
import type { ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { UserLookupRow } from "./user.schema.ts";

export const tagName = "user-picker";

@customElement(tagName)
export class UserPicker extends ModelPickerBase<UserLookupRow> {
  protected model = "user";
  protected override defaultSortBy = "name";

  protected columns: ListColumn<UserLookupRow>[] = [
    { key: "name", title: "common.name", sortable: true },
  ];
}
