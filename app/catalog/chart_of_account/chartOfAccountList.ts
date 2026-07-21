import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { ChartOfAccountRow } from "./chart_of_account.schema.ts";

export const tagName = "chart-of-account-list";

const ACCOUNT_TYPE_KEY: Record<string, string> = {
  active: "chartOfAccount.type.active",
  passive: "chartOfAccount.type.passive",
  active_passive: "chartOfAccount.type.activePassive",
};

@customElement(tagName)
export class ChartOfAccountList extends ModelListBase<ChartOfAccountRow> {
  protected model = "chart_of_account";
  protected editRoute = "catalog/chart_of_account/edit";
  protected override defaultSortBy = "code";

  protected columns: ListColumn<ChartOfAccountRow>[] = [
    { key: "code", title: "chartOfAccount.code", width: "6rem", sortable: true },
    {
      key: "name", title: "common.name", sortable: true, overflow: "ellipsis",
      tooltip: (r) => r.name,
      // Субрахунки зсунуті вправо — плаский список читається як план рахунків.
      render: (row) => row.parentCode
        ? html`<span style="padding-left:1.25rem">${row.name}</span>`
        : html`<strong>${row.name}</strong>`,
    },
    {
      key: "accountType", title: "chartOfAccount.accountType", width: "9rem", muted: true,
      render: (row) => this.t(ACCOUNT_TYPE_KEY[row.accountType] ?? row.accountType),
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

  protected override rowStyle(row: ChartOfAccountRow) {
    return row.isActive === false ? "color:#9ca3af" : "";
  }
}
