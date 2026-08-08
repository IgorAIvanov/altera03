import { customElement } from "lit/decorators.js";
import { ModelPickerBase } from "@client/ui-kit/base/model-picker-base.ts";
import type { ListColumn } from "@client/ui-kit/base/table-contract.ts";
import type { OrganizationLookupRow } from "./organization.schema.ts";

export const tagName = "organization-picker";

@customElement(tagName)
export class OrganizationPicker extends ModelPickerBase<OrganizationLookupRow> {
  protected model = "organization";
  protected override defaultSortBy = "name";

  protected columns: ListColumn<OrganizationLookupRow>[] = [
    { key: "name",   title: "common.name", sortable: true },
    { key: "edrpou", title: "organization.edrpou", width: "9rem", muted: true, sortable: true },
  ];
}
