import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import { dateFormat } from "@client/shared/datetime.ts";
import { REMARK_KINDS, REMARK_STATUSES, type RemarkRow } from "./remark.schema.ts";
import "@client/ui-kit/components/ui-select.ts";

export const tagName = "remark-list";

type SelectEvent = CustomEvent<{ value: string }>;

@customElement(tagName)
export class RemarkList extends ModelListBase<RemarkRow> {
  protected model = "remark";
  protected editRoute = "admin/remark/edit";
  protected override defaultSortBy = "createdAt";
  protected override defaultSortDir: "desc" = "desc";

  protected columns: ListColumn<RemarkRow>[] = [
    { key: "createdAt", title: "remark.createdAt", width: "9.5rem", format: dateFormat.dateTime, sortable: true },
    {
      key: "kind", title: "remark.kind", width: "7rem", sortable: true,
      render: (row) => this.t(`remark.kind.${row.kind}`),
      exportText: (row) => this.t(`remark.kind.${row.kind}`),
    },
    { key: "title", title: "remark.title", sortable: true, overflow: "ellipsis" },
    {
      // Стан читається з `verifiedAt`, а НЕ зі `status`: статус — це заявка
      // виконавця, закритість — факт від людини. Запис може стояти закритим при
      // статусі `new` (людина повернула словами «не виправлено», а потім усе ж
      // закрила), і саме `verifiedAt` тут правда.
      key: "status", title: "remark.status", width: "9rem", sortable: true,
      render: (row) => {
        if (row.verifiedAt) {
          return html`<span class="badge badge-sm badge-success">${this.t("remark.closed")}</span>`;
        }
        const cls = row.hasAnswer ? "badge-info" : "badge-ghost";
        return html`<span class="badge badge-sm ${cls}">${this.t(`remark.status.${row.status}`)}</span>`;
      },
      exportText: (row) => row.verifiedAt ? this.t("remark.closed") : this.t(`remark.status.${row.status}`),
    },
    { key: "author", title: "remark.author", width: "10rem", muted: true, overflow: "ellipsis" },
    {
      key: "ctxRoute", title: "remark.ctxRoute", width: "13rem", muted: true, overflow: "ellipsis",
      tooltip: (row) => row.ctxRoute ?? "",
    },
  ];

  protected override renderFilters() {
    return html`
      <ui-select
        .label=${this.t("remark.kind")}
        size="sm"
        .placeholder=${this.t("remark.anyKind")}
        .options=${REMARK_KINDS.map((k) => ({ value: k, label: this.t(`remark.kind.${k}`) }))}
        .value=${this.filterValue<string>("kind") ?? ""}
        @value-changed=${(e: SelectEvent) => this.setFilter("kind", e.detail.value)}
      ></ui-select>

      <ui-select
        .label=${this.t("remark.status")}
        size="sm"
        .placeholder=${this.t("remark.anyStatus")}
        .options=${REMARK_STATUSES.map((s) => ({ value: s, label: this.t(`remark.status.${s}`) }))}
        .value=${this.filterValue<string>("status") ?? ""}
        @value-changed=${(e: SelectEvent) => this.setFilter("status", e.detail.value)}
      ></ui-select>

      <label class="flex items-center gap-2">
        <input type="checkbox" class="checkbox checkbox-xs"
          .checked=${this.filterValue<string>("openOnly") === "1"}
          @change=${(e: Event) =>
            this.setFilter("openOnly", (e.target as HTMLInputElement).checked ? "1" : "")} />
        <span>${this.t("remark.openOnly")}</span>
      </label>
    `;
  }
}
