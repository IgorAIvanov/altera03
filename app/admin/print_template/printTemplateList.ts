import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { PrintTemplateRow } from "./printTemplate.schema.ts";
import { icons } from "@client/ui-kit/icons.ts";

export const tagName = "print-template-list";

@customElement(tagName)
export class PrintTemplateList extends ModelListBase<PrintTemplateRow> {
  protected model = "print_template";
  protected editRoute = "admin/print_template/edit";
  protected override defaultSortBy = "code";

  protected columns: ListColumn<PrintTemplateRow>[] = [
    { key: "code", title: "common.code", width: "12rem", sortable: true },
    { key: "name", title: "common.name", sortable: true, overflow: "ellipsis", tooltip: (r) => r.name },
    { key: "targetModel", title: "printTemplate.targetModel", width: "10rem", muted: true, sortable: true },
    { key: "dataCommand", title: "printTemplate.dataCommand", width: "9rem", muted: true },
    {
      key: "isDefault", title: "printTemplate.isDefault", width: "8rem", align: "center", sortable: true,
      render: (row) => row.isDefault ? html`<span class="badge badge-sm badge-primary">✓</span>` : "",
    },
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

  /** Неактивні шаблони — приглушено. */
  protected override rowStyle(row: PrintTemplateRow) {
    return row.isActive === false ? "color:#9ca3af" : "";
  }
}
