import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import { dateFormat } from "@client/shared/datetime.ts";
import { currentOrg } from "@shared/current-organization.ts";
import {
  TurnoverBalanceRootSchema,
  type TurnoverBalanceRoot,
  type TurnoverBalanceRow,
} from "./turnover_balance.schema.ts";
import "@client/ui-kit/components/ui-picker.ts";
import "@client/ui-kit/components/ui-date.ts";

export const tagName = "turnover-balance-report";

type PickEvent = CustomEvent<{ id: string; label: string }>;
type DateEvent = CustomEvent<{ value: string }>;

const money = new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function amount(value: number | undefined): string {
  return value ? money.format(value) : "";
}

@customElement(tagName)
export class TurnoverBalanceReport extends BaseUI<TurnoverBalanceRoot> {
  protected model = "turnover_balance";

  constructor() {
    super(TurnoverBalanceRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    this.$root.$query.dateFrom ||= iso(new Date(now.getFullYear(), now.getMonth(), 1));
    this.$root.$query.dateTo ||= iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    // Поточна організація за замовчуванням, якщо перехід не приніс своєї.
    const org = currentOrg();
    if (org && !this.$root.$query.organizationId) {
      this.$root.$query.organizationId = org.id;
      this.$root.$query.organization = { id: org.id, name: org.name };
    }
  }

  override applyParams(params: Record<string, unknown>) {
    super.applyParams(params);
    if (this.canRun) queueMicrotask(() => this.buildReport());
  }

  private get canRun(): boolean {
    return !this.busy && !!this.$root.$query.organizationId;
  }

  private async buildReport() {
    const q = this.$root.$query;
    await this.loadInto("index", {
      organizationId: q.organizationId,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
    });
  }

  /**
   * Розшифровка рахунку — картка рахунку з тими самими організацією й
   * періодом. Параметри йдуть у вкладку, а не в URL: маршрут в'ю один на
   * звіт, а стан у нього свій (див. BaseUI.applyParams).
   */
  private openCard(row: TurnoverBalanceRow) {
    const q = this.$root.$query;
    bus.emit({
      type: "tab.open",
      route: "report/account_card/list",
      params: {
        organizationId: q.organizationId,
        organization: q.organization,
        accountCode: row.accountCode,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
      },
    });
  }

  private renderRow(row: TurnoverBalanceRow): TemplateResult {
    return html`
      <tr>
        <td class="cell-text">
          <button class="link link-hover font-medium" @click=${() => this.openCard(row)}>
            ${row.accountCode}
          </button>
        </td>
        <td class="cell-text" title=${row.accountName}>${row.accountName}</td>
        <td class="cell-text text-right tabular-nums">${amount(row.openingDebit)}</td>
        <td class="cell-text text-right tabular-nums">${amount(row.openingCredit)}</td>
        <td class="cell-text text-right tabular-nums">${amount(row.turnoverDebit)}</td>
        <td class="cell-text text-right tabular-nums">${amount(row.turnoverCredit)}</td>
        <td class="cell-text text-right tabular-nums">${amount(row.closingDebit)}</td>
        <td class="cell-text text-right tabular-nums">${amount(row.closingCredit)}</td>
      </tr>
    `;
  }

  override render() {
    const q = this.$root.$query;
    const totals = this.$root.totals;

    return html`
      <div class="p-4 flex flex-col gap-2">
        ${this.renderNotice()}

        <div class="flex gap-2 items-end flex-wrap">
          <ui-picker
            .label=${t("document.organization")}
            required
            url="catalog/organization"
            fetch="lookup"
            .displayValue=${q.organization?.name ?? ""}
            .selectedId=${q.organizationId}
            @item-selected=${(e: PickEvent) => {
              q.organizationId = e.detail.id;
              q.organization = { id: e.detail.id, name: e.detail.label };
            }}
          ></ui-picker>

          <ui-date
            .label=${t("accountCard.dateFrom")}
            .value=${q.dateFrom}
            format=${dateFormat.date}
            @value-changed=${(e: DateEvent) => { q.dateFrom = e.detail.value; }}
          ></ui-date>
          <ui-date
            .label=${t("accountCard.dateTo")}
            .value=${q.dateTo}
            format=${dateFormat.date}
            @value-changed=${(e: DateEvent) => { q.dateTo = e.detail.value; }}
          ></ui-date>

          <button class="btn btn-primary" ?disabled=${!this.canRun} @click=${this.buildReport}>
            ${this.running === "index" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
            ${t("accountCard.build")}
          </button>
        </div>

        <div class="text-xs text-base-content/50">${t("turnoverBalance.drillHint")}</div>

        <table class="table table-sm w-full table-tabular">
          <thead>
            <tr>
              <th rowspan="2" class="w-20">${t("accountCard.account")}</th>
              <th rowspan="2">${t("common.name")}</th>
              <th colspan="2" class="text-center">${t("accountCard.opening")}</th>
              <th colspan="2" class="text-center">${t("accountCard.turnover")}</th>
              <th colspan="2" class="text-center">${t("accountCard.closing")}</th>
            </tr>
            <tr>
              <th class="w-28 text-right">${t("manualEntry.debit")}</th>
              <th class="w-28 text-right">${t("manualEntry.credit")}</th>
              <th class="w-28 text-right">${t("manualEntry.debit")}</th>
              <th class="w-28 text-right">${t("manualEntry.credit")}</th>
              <th class="w-28 text-right">${t("manualEntry.debit")}</th>
              <th class="w-28 text-right">${t("manualEntry.credit")}</th>
            </tr>
          </thead>
          <tbody>
            ${this.$root.rows.map((row) => this.renderRow(row))}
            ${this.$root.rows.length === 0
              ? html`<tr><td colspan="8" class="text-center text-base-content/40 py-4">${t("common.noData")}</td></tr>`
              : ""}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="2" class="text-right">${t("invoice.total")}</th>
              <th class="text-right tabular-nums">${amount(totals.openingDebit)}</th>
              <th class="text-right tabular-nums">${amount(totals.openingCredit)}</th>
              <th class="text-right tabular-nums">${amount(totals.turnoverDebit)}</th>
              <th class="text-right tabular-nums">${amount(totals.turnoverCredit)}</th>
              <th class="text-right tabular-nums">${amount(totals.closingDebit)}</th>
              <th class="text-right tabular-nums">${amount(totals.closingCredit)}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }
}
