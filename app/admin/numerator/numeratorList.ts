import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { NumeratorRow } from "./numerator.schema.ts";
import { icons } from "@client/ui-kit/icons.ts";

export const tagName = "numerator-list";

@customElement(tagName)
export class NumeratorList extends ModelListBase<NumeratorRow> {
  protected model = "numerator";
  protected editRoute = "admin/numerator/edit";
  protected override defaultSortBy = "id";

  protected columns: ListColumn<NumeratorRow>[] = [
    { key: "id", title: "numerator.model", width: "10rem", muted: true, sortable: true },
    { key: "name", title: "common.name", sortable: true, overflow: "ellipsis", tooltip: (r) => r.name },
    { key: "template", title: "numerator.template", width: "12rem", sortable: true },
    {
      key: "period", title: "numerator.period", width: "8rem",
      render: (r) => this.t(`numerator.period_${r.period}`),
      exportText: (r) => this.t(`numerator.period_${r.period}`),
    },
    {
      key: "strategy", title: "numerator.strategy", width: "9rem",
      render: (r) => this.t(`numerator.strategy_${r.strategy}`),
      exportText: (r) => this.t(`numerator.strategy_${r.strategy}`),
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

  /**
   * Нумератори заводить деплой із манифестів моделей: створювати чи видаляти
   * їх з екрана нічого (видалений рядок зламав би видачу номерів моделі).
   * Тому в тулбарі лише «Відкрити» — без «Створити» й кошика.
   */
  protected override renderToolbarActions() {
    return html`
      <button class="btn btn-sm" ?disabled=${!this.selectedId}
        @click=${() => this.openEdit(this.selectedId)}>
        ${icons.open} ${this.t("common.open")}
      </button>
    `;
  }

  /** Insert створює запис — а створювати тут нічого (див. renderToolbarActions). */
  override hotkeyCreate() {}
}
