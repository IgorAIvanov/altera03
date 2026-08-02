import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { AuditLogRow } from "./audit_log.schema.ts";

export const tagName = "audit-log-list";

@customElement(tagName)
export class AuditLogList extends ModelListBase<AuditLogRow> {
  protected model = "audit_log";
  protected editRoute = null;
  protected override readonly = true;
  protected override defaultSortBy = "occurredAt";
  protected override defaultSortDir: "desc" = "desc";

  protected columns: ListColumn<AuditLogRow>[] = [
    { key: "occurredAt", title: "auditLog.occurredAt", width: "10rem", format: "DD.MM.YY HH:mm", sortable: true },
    { key: "user", title: "auditLog.user", width: "12rem", sortable: true, overflow: "ellipsis" },
    { key: "model", title: "auditLog.model", width: "10rem", sortable: true, overflow: "ellipsis" },
    { key: "command", title: "auditLog.command", width: "8rem", sortable: true },
    { key: "recordId", title: "auditLog.recordId", width: "7rem", sortable: true, muted: true },
    {
      key: "isSuccess", title: "auditLog.result", width: "7rem", sortable: true, align: "center",
      render: (row) => html`<span class="badge ${row.isSuccess ? "badge-success" : "badge-error"}">
        ${this.t(row.isSuccess ? "auditLog.success" : "auditLog.failure")}
      </span>`,
      exportText: (row) => this.t(row.isSuccess ? "auditLog.success" : "auditLog.failure"),
    },
  ];
}