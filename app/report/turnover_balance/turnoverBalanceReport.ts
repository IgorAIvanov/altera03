import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { ReportBase } from "@client/ui-kit/base/report-base.ts";
import { periodLabel, periodOf } from "@client/shared/period.ts";
import { currentOrg } from "@shared/current-organization.ts";
import {
  TurnoverBalanceRootSchema,
  type TurnoverBalanceRoot,
  type TurnoverBalanceRow,
} from "./turnover_balance.schema.ts";
import "@client/ui-kit/components/ui-picker.ts";
import "@client/ui-kit/components/ui-period.ts";

export const tagName = "turnover-balance-report";

type PickEvent = CustomEvent<{ id: string; label: string }>;
type PeriodEvent = CustomEvent<{ dateFrom: string; dateTo: string }>;

const money = new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function amount(value: number | undefined): string {
  return value ? money.format(value) : "";
}

@customElement(tagName)
export class TurnoverBalanceReport extends ReportBase<TurnoverBalanceRoot> {
  protected model = "turnover_balance";
  protected reportTitle = "turnoverBalance.title";

  constructor() {
    super(TurnoverBalanceRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    const month = periodOf("month");
    this.$root.$query.dateFrom ||= month.dateFrom;
    this.$root.$query.dateTo ||= month.dateTo;

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

  protected override get canRun(): boolean {
    return !this.busy && !!this.$root.$query.organizationId;
  }

  protected override async buildReport() {
    const q = this.$root.$query;
    await this.loadInto("index", {
      organizationId: q.organizationId,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
    });
  }

  /** Рядок під назвою звіту на папері та в Excel: організація й період. */
  protected override printSubtitle(): string {
    const q = this.$root.$query;
    const period = periodLabel({ dateFrom: q.dateFrom, dateTo: q.dateTo });
    return [q.organization?.name, period].filter(Boolean).join(" · ");
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
        <td>
          <button class="link link-hover font-medium" @click=${() => this.openCard(row)}>
            ${row.accountCode}
          </button>
        </td>
        <td title=${row.accountName}>${row.accountName}</td>
        <td class="text-right tabular-nums">${amount(row.openingDebit)}</td>
        <td class="text-right tabular-nums">${amount(row.openingCredit)}</td>
        <td class="text-right tabular-nums">${amount(row.turnoverDebit)}</td>
        <td class="text-right tabular-nums">${amount(row.turnoverCredit)}</td>
        <td class="text-right tabular-nums">${amount(row.closingDebit)}</td>
        <td class="text-right tabular-nums">${amount(row.closingCredit)}</td>
      </tr>
    `;
  }

  protected override renderFilters(): TemplateResult {
    const q = this.$root.$query;

    return html`
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

          <ui-period
            .label=${t("period.label")}
            .dateFrom=${q.dateFrom}
            .dateTo=${q.dateTo}
            @period-changed=${(e: PeriodEvent) => {
              q.dateFrom = e.detail.dateFrom;
              q.dateTo = e.detail.dateTo;
            }}
          ></ui-period>
        </div>
    `;
  }

  protected override renderBody(): TemplateResult {
    const totals = this.$root.totals;

    return html`
        <div class="text-xs text-muted no-print">${t("turnoverBalance.drillHint")}</div>

        <table class="table table-sm w-full">
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
              ? html`<tr><td colspan="8" class="text-center text-muted py-4">${t("common.noData")}</td></tr>`
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
    `;
  }
}
