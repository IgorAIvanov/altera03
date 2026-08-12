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
/** Значення ссылочного фільтра: id вибирає записи, `name` показує пікер. */
type Ref = { id: string; name: string };

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
    const org = currentOrg();
    // Умовчання одним записом: `setFilters` не перезапитує звіт (його формує
    // «Оновити»), тож зайвих викликів це не коштує.
    this.setFilters({
      dateFrom: this.filterValue("dateFrom") || month.dateFrom,
      dateTo: this.filterValue("dateTo") || month.dateTo,
      // Поточна організація, якщо перехід не приніс своєї.
      organization: this.filterValue("organization")
        ?? (org ? { id: org.id, name: org.name } : null),
    });
  }

  override applyParams(params: Record<string, unknown>) {
    super.applyParams(params);
    if (this.canRun) queueMicrotask(() => this.buildReport());
  }

  protected override get canRun(): boolean {
    return !this.busy && !!this.filterValue<Ref>("organization")?.id;
  }

  protected override async buildReport() {
    await this.loadInto("index", this.filtersPayload());
  }

  /** Рядок під назвою звіту на папері та в Excel: організація й період. */
  protected override printSubtitle(): string {
    const f = this.$root.$filters;
    // Період необов'язковий (схема каже це прямо), тож у підпис він може й не
    // прийти — periodLabel порожній період і не друкує.
    const period = periodLabel({ dateFrom: f.dateFrom ?? "", dateTo: f.dateTo ?? "" });
    return [f.organization?.name, period].filter(Boolean).join(" · ");
  }

  /**
   * Розшифровка рахунку — картка рахунку з тими самими організацією й
   * періодом. Параметри йдуть у вкладку, а не в URL: маршрут в'ю один на
   * звіт, а стан у нього свій (див. BaseUI.applyParams).
   */
  private openCard(row: TurnoverBalanceRow) {
    const f = this.$root.$filters;
    bus.emit({
      type: "tab.open",
      route: "report/account_card/list",
      // Ті самі ключі, що у фільтрах картки: `applyParams` кладе їх прямо в
      // `$filters` приймача, тож перекладати нема чого.
      params: {
        organization: f.organization,
        accountCode: row.accountCode,
        dateFrom: f.dateFrom,
        dateTo: f.dateTo,
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
    const org = this.filterValue<Ref>("organization");

    return html`
        <div class="flex gap-2 items-end flex-wrap">
          <ui-picker
            .label=${t("document.organization")}
            required
            url="catalog/organization"
            fetch="lookup"
            .displayValue=${org?.name ?? ""}
            .selectedId=${org?.id ?? ""}
            @item-selected=${(e: PickEvent) =>
              this.setFilter("organization", { id: e.detail.id, name: e.detail.label })}
          ></ui-picker>

          <ui-period
            .label=${t("period.label")}
            .dateFrom=${this.filterValue<string>("dateFrom") ?? ""}
            .dateTo=${this.filterValue<string>("dateTo") ?? ""}
            @period-changed=${(e: PeriodEvent) =>
              this.setFilters({ dateFrom: e.detail.dateFrom, dateTo: e.detail.dateTo })}
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
