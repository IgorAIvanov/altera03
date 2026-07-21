import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { PrintTemplateRow } from "./printTemplate.schema.ts";

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
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      `,
    },
  ];

  /** Неактивні шаблони — приглушено. */
  protected override rowStyle(row: PrintTemplateRow) {
    return row.isActive === false ? "color:#9ca3af" : "";
  }
}
