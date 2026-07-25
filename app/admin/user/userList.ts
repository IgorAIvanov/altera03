import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { UserRow } from "./user.schema.ts";

export const tagName = "user-list";

@customElement(tagName)
export class UserList extends ModelListBase<UserRow> {
  protected model = "user";
  protected editRoute = "admin/user/edit";
  protected override defaultSortBy = "login";

  protected columns: ListColumn<UserRow>[] = [
    { key: "login", title: "user.login", width: "12rem", sortable: true },
    { key: "fullName", title: "user.fullName", sortable: true, overflow: "ellipsis", tooltip: (r) => r.fullName },
    { key: "groupCount", title: "user.groupCount", width: "6rem", align: "right", muted: true },
    {
      key: "_actions", title: "", width: "3rem", align: "center",
      render: (row) => html`
        <button class="btn btn-ghost btn-xs px-1" title=${this.t("common.open")}
          @click=${stopRow(() => this.openEdit(row.id))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      `,
    },
  ];

  protected override rowStyle(row: UserRow) {
    return row.isActive === false ? "color:#9ca3af" : "";
  }
}
