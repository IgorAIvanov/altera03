import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { MenuListRow } from "./menu.schema.ts";

export const tagName = "menu-list";

@customElement(tagName)
export class MenuList extends ModelListBase<MenuListRow> {
  protected model = "menu";
  protected editRoute = "admin/menu/edit";
  protected override defaultSortBy = "code";

  protected columns: ListColumn<MenuListRow>[] = [
    { key: "code", title: "common.code", width: "10rem", sortable: true },
    { key: "name", title: "common.name", sortable: true, overflow: "ellipsis", tooltip: (r) => r.name },
    { key: "itemCount",  title: "menu.itemCount",  width: "7rem", align: "right", muted: true, sortable: true },
    { key: "groupCount", title: "menu.groupCount", width: "7rem", align: "right", muted: true, sortable: true },
    {
      key: "_actions", title: "", width: "3rem", align: "center",
      render: (row) => html`
        <button class="btn btn-ghost btn-xs px-1" title=${this.t("common.open")}
          @click=${stopRow(() => this.openEdit(row.id))}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      `,
    },
  ];

  protected override rowStyle(row: MenuListRow) {
    return row.isActive === false ? "color:#9ca3af" : "";
  }

  protected override renderToolbarExtra() {
    return html`
      <button class="btn btn-sm" ?disabled=${!this.selectedId || this.busy}
        @click=${this.copySelected} title=${this.t("menu.copyHint")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        ${this.t("menu.copy")}
      </button>
    `;
  }

  /**
   * Копія відкривається одразу на редагування: копіюють, щоб змінити, а не
   * щоб мати другий такий самий рядок у списку. Групи копії не дістаються —
   * див. app.menu_copy.
   */
  private async copySelected() {
    if (!this.selectedId) return;

    const env = await this.run<{ item?: { id?: string } | null }>(
      "copy",
      { id: this.selectedId },
      "save",
    );
    if (!env.ok) return;

    this.selectedId = "";
    this.reload();

    const id = env.data?.item?.id;
    if (id) this.openEdit(id);
  }
}
