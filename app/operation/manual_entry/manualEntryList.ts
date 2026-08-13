import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import { dateFormat } from "@client/shared/datetime.ts";
import { movementsButton } from "@shared/document-movements.ts";
import type { ManualEntryRow } from "./manual_entry.schema.ts";
import { icons } from "@client/ui-kit/icons.ts";

export const tagName = "manual-entry-list";

@customElement(tagName)
export class ManualEntryList extends ModelListBase<ManualEntryRow> {
  protected model = "manual_entry";
  protected editRoute = "operation/manual_entry/edit";

  /**
   * Журнал документів — відбір за організацією. Умовчання (поточна
   * організація), можливість його зняти й мовчання при одній організації
   * дає основа; тут лишається сам факт, що документ організації належить.
   */
  protected override organizationFilter = true;
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
          ${icons.open}
        </button>
      `,
    },
  ];

  /** Рух документа — над виділеним рядком, як «Відкрити» й «Видалити». */
  protected override renderToolbarExtra() {
    const row = this.selectedRow;
    return movementsButton(row?.id, row?.isPosted);
  }
}
