import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { NomenclatureRow } from "./nomenclature.schema.ts";

export const tagName = "nomenclature-list";

@customElement(tagName)
export class NomenclatureList extends ModelListBase<NomenclatureRow> {
  protected model = "nomenclature";
  protected editRoute = "catalog/nomenclature/edit";
  protected override defaultSortBy = "code";
  // Ієрархічний довідник: праворуч — дерево груп із чекбоксами-фільтром,
  // у тулбарі — «До групи…». Уся механіка в базі, тут лише прапорець.
  protected override hierarchy = true;

  protected columns: ListColumn<NomenclatureRow>[] = [
    { key: "code", title: "common.code", width: "8rem", sortable: true },
    { key: "name", title: "common.name", sortable: true, overflow: "ellipsis", tooltip: (r) => r.name },
    { key: "unit", title: "nomenclature.unit", width: "6rem" },
    { key: "groupName", title: "nomenclature.group", width: "12rem", overflow: "ellipsis" },
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

  protected override rowStyle(row: NomenclatureRow) {
    return row.isActive === false ? "color:#9ca3af" : "";
  }
}
