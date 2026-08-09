import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { UserGroupRow } from "./userGroup.schema.ts";
import { icons } from "@client/ui-kit/icons.ts";

export const tagName = "user-group-list";

@customElement(tagName)
export class UserGroupList extends ModelListBase<UserGroupRow> {
  protected model = "user_group";
  protected editRoute = "admin/user_group/edit";
  protected override defaultSortBy = "code";

  protected columns: ListColumn<UserGroupRow>[] = [
    { key: "code", title: "common.code", width: "10rem", sortable: true },
    { key: "name", title: "common.name", sortable: true, overflow: "ellipsis", tooltip: (r) => r.name },
    { key: "memberCount", title: "userGroup.memberCount", width: "7rem", align: "right", muted: true },
    { key: "permissionCount", title: "userGroup.permissionCount", width: "7rem", align: "right", muted: true },
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

  protected override rowStyle(row: UserGroupRow) {
    return row.isActive === false ? "color:#9ca3af" : "";
  }
}
