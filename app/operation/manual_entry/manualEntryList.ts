import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import { dateFormat } from "@client/shared/datetime.ts";
import type { ManualEntryRow } from "./manual_entry.schema.ts";

export const tagName = "manual-entry-list";

@customElement(tagName)
export class ManualEntryList extends ModelListBase<ManualEntryRow> {
  protected model = "manual_entry";
  protected editRoute = "operation/manual_entry/edit";
  protected override defaultSortBy = "docDate";

  protected columns: ListColumn<ManualEntryRow>[] = [
    { key: "number", title: "invoice.number", width: "10rem", sortable: true },
    {
      key: "docDate", title: "invoice.date", width: "9rem", muted: true, sortable: true,
      format: dateFormat.dateTime,
    },
    {
      key: "description", title: "manualEntry.description",
      overflow: "ellipsis", tooltip: (r) => r.description ?? "",
    },
    { key: "total", title: "invoice.total", width: "8rem", align: "right" },
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
}
