import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { NomenclatureRow } from "./nomenclature.schema.ts";
import { icons } from "@client/ui-kit/icons.ts";

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
          ${icons.open}
        </button>
      `,
    },
  ];

  protected override rowStyle(row: NomenclatureRow) {
    return row.isDeleted === true ? "color:#6b7280" : "";
  }
}
