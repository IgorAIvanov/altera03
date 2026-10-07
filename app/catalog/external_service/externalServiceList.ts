import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { ExternalServiceRow } from "./external_service.schema.ts";
import { icons } from "@client/ui-kit/icons.ts";

export const tagName = "external-service-list";

@customElement(tagName)
export class ExternalServiceList extends ModelListBase<ExternalServiceRow> {
  protected model = "external_service";
  protected editRoute = "catalog/external_service/edit";
  protected override defaultSortBy = "name";

  // Колонки «токен задано» тут немає свідомо: `list` секретів не знає (вони в
  // іншій таблиці), а питати по рядку означало б запит на кожен рядок.
  protected columns: ListColumn<ExternalServiceRow>[] = [
    { key: "name", title: "common.name", sortable: true, overflow: "ellipsis", tooltip: (r) => r.name },
    { key: "url", title: "externalService.url", overflow: "ellipsis", tooltip: (r) => r.url ?? "" },
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

  protected override rowStyle(row: ExternalServiceRow) {
    return row.isDeleted === true ? "color:#6b7280" : "";
  }
}
