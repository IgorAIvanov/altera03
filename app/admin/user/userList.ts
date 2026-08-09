import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { t } from "@client/locale.ts";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { UserRow } from "./user.schema.ts";
import { icons } from "@client/ui-kit/icons.ts";

export const tagName = "user-list";

@customElement(tagName)
export class UserList extends ModelListBase<UserRow> {
  protected model = "user";
  protected editRoute = "admin/user/edit";
  protected override defaultSortBy = "login";

  protected columns: ListColumn<UserRow>[] = [
    { key: "login", title: "user.login", width: "12rem", sortable: true },
    { key: "fullName", title: "user.fullName", sortable: true, overflow: "ellipsis", tooltip: (r) => r.fullName },
    // Користувач без пароля виглядає у списку як звичайний, а увійти під ним
    // не можна взагалі — тому позначка, а не тиша. Порожня, коли все гаразд:
    // окремий значок «пароль є» лише зашумив би список.
    {
      key: "hasPassword", title: "user.password", width: "9rem", align: "center",
      render: (r) =>
        r.hasPassword === false
          ? html`<span class="badge badge-warning badge-sm">${t("user.noPassword")}</span>`
          : "",
      exportText: (r) => (r.hasPassword === false ? t("user.noPassword") : ""),
    },
    { key: "groupCount", title: "user.groupCount", width: "6rem", align: "right", muted: true },
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

  protected override rowStyle(row: UserRow) {
    return row.isActive === false ? "color:#9ca3af" : "";
  }
}
