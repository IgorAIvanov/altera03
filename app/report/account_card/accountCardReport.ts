import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { ReportBase } from "@client/ui-kit/base/report-base.ts";
import { dateFormat, formatDate } from "@client/shared/datetime.ts";
import { periodLabel, periodOf } from "@client/shared/period.ts";
import { viewRoute } from "@shared/view-route.ts";
import { currentOrg } from "@shared/current-organization.ts";
import {
  AccountCardRootSchema,
  type AccountCardRoot,
  type AccountCardRow,
  type ReportAnalytic,
} from "./account_card.schema.ts";
import "@client/ui-kit/components/ui-picker.ts";
import "@client/ui-kit/components/ui-period.ts";

export const tagName = "account-card-report";

type PickEvent = CustomEvent<{ id: string; label: string }>;
type PeriodEvent = CustomEvent<{ dateFrom: string; dateTo: string }>;

const money = new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 0 у звіті — це порожня клітинка, а не «нуль»: так читається сітка сум. */
function amount(value: number | undefined): string {
  return value ? money.format(value) : "";
}

@customElement(tagName)
export class AccountCardReport extends ReportBase<AccountCardRoot> {
  protected model = "account_card";
  protected reportTitle = "accountCard.title";

  constructor() {
    super(AccountCardRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    // Період за замовчуванням — поточний місяць: звіт відкривається вже
    // придатним до запуску, без ручного заповнення дат.
    const month = periodOf("month");
    this.$root.$query.dateFrom ||= month.dateFrom;
    this.$root.$query.dateTo ||= month.dateTo;

    // Поточна організація за замовчуванням — але не перетираємо ту, що вже
    // прийшла параметром переходу (drill-down з ОСВ несе свою організацію).
    const org = currentOrg();
    if (org && !this.$root.$query.organizationId) {
      this.$root.$query.organizationId = org.id;
      this.$root.$query.organization = { id: org.id, name: org.name };
    }
  }

  /**
   * Перехід зі зведеного звіту: параметри приходять готовими, тому звіт
   * формується одразу — інакше користувач бачив би порожню таблицю й мусив
   * би тиснути «Сформувати» після кліку, який уже був явним запитом даних.
   */
  override applyParams(params: Record<string, unknown>) {
    super.applyParams(params);
    if (this.canRun) queueMicrotask(() => this.buildReport());
  }

  protected override get canRun(): boolean {
    const q = this.$root.$query;
    return !this.busy && !!q.organizationId && !!q.accountCode;
  }

  protected override async buildReport() {
    const q = this.$root.$query;
    await this.loadInto("index", {
      organizationId: q.organizationId,
      accountCode: q.accountCode,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
    });
  }

  /** Рядок під назвою звіту на папері та в Excel: рахунок, організація, період. */
  protected override printSubtitle(): string {
    const q = this.$root.$query;
    const totals = this.$root.totals;
    const account = [totals.account || q.accountCode, totals.accountName].filter(Boolean).join(" — ");
    const period = periodLabel({ dateFrom: q.dateFrom, dateTo: q.dateTo });
    return [account, q.organization?.name, period].filter(Boolean).join(" · ");
  }

  /**
   * Клік на документі веде не прямо у форму, а в «Рух документа» — проміжну
   * ланку drill-down (ОСВ → картка → рух → документ), звідки видно всі
   * проводки документа й уже звідти відкривається сама форма.
   */
  private openMovements(row: AccountCardRow) {
    bus.emit({
      type: "tab.open",
      route: "report/document_movements/list",
      params: { documentId: row.documentId },
    });
  }

  /**
   * Перехід до довідника субконто. Маршрут беремо з view-manifest за ключем
   * моделі — тим самим, що лежить у app.analytic_dimension. Немає в'ю —
   * немає переходу: це не помилка даних, а не реалізований екран.
   */
  private openAnalytic(modelKey: string, id: string) {
    const route = viewRoute(modelKey, "edit");
    if (!route) return;
    bus.emit({ type: "tab.open", route, id });
  }

  private renderAnalytics(items: ReportAnalytic[]): TemplateResult | string {
    if (!items.length) return "";
    return html`
      <div class="flex flex-col">
        ${items.map((a) => html`
          <button class="link link-hover text-xs text-left truncate" title=${a.dimensionName}
            @click=${() => this.openAnalytic(a.modelKey, a.valueId)}>
            ${a.presentation}
          </button>
        `)}
      </div>
    `;
  }

  // Валюту й кількість показуємо окремими колонками — і лише коли вони в даних
  // є. Окремі числові колонки, а не «сума + код» в одній клітинці: так звіт,
  // вивантажений в Excel, лишається придатним до обчислень.
  private get showCurrency(): boolean {
    return this.$root.rows.some((r) => r.currencyAmount);
  }
  private get showQuantity(): boolean {
    return this.$root.rows.some((r) => r.quantity);
  }

  private renderExtraCells(row: AccountCardRow): TemplateResult | string {
    return html`
      ${this.showCurrency ? html`
        <td class="text-right tabular-nums">${amount(row.currencyAmount ?? 0)}</td>
        <td class="text-muted">${row.currencyCode ?? ""}</td>` : ""}
      ${this.showQuantity
        ? html`<td class="text-right tabular-nums">${row.quantity ?? ""}</td>` : ""}
    `;
  }

  /**
   * Порожні клітинки під валюту/кількість для рядків підсумків. Тег важливий:
   * підвал складається з `th`, і саме на `th` поширюється фон підвала — якщо
   * дати сюди `td`, колонки валюти в підвалі лишаться недофарбованими.
   */
  private extraFillerCells(tag: "td" | "th" = "td"): TemplateResult | string {
    const cell = tag === "th"
      ? html`<th></th>`
      : html`<td></td>`;
    return html`
      ${this.showCurrency ? html`${cell}${cell}` : ""}
      ${this.showQuantity ? cell : ""}
    `;
  }

  private renderRow(row: AccountCardRow): TemplateResult {
    return html`
      <tr>
        <td class="whitespace-nowrap">${formatDate(row.docDate, dateFormat.date)}</td>
        <td>
          <button class="link link-hover" title=${row.documentTypeName}
            @click=${() => this.openMovements(row)}>
            ${row.documentTypeName} ${row.docNumber ?? ""}
          </button>
        </td>
        <td>${this.renderAnalytics(row.analytics)}</td>
        <td class="whitespace-nowrap" title=${row.corrAccountName ?? ""}>${row.corrAccount ?? ""}</td>
        <td>${this.renderAnalytics(row.corrAnalytics)}</td>
        <td class="text-right tabular-nums">${amount(row.debit)}</td>
        <td class="text-right tabular-nums">${amount(row.credit)}</td>
        <td class="text-right tabular-nums">
          ${row.balanceDebit ? amount(row.balanceDebit) : ""}
          ${row.balanceCredit ? html`<span class="text-error">${amount(row.balanceCredit)}</span>` : ""}
        </td>
        ${this.renderExtraCells(row)}
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

          <ui-picker
            .label=${t("accountCard.account")}
            required
            url="catalog/chart_of_account"
            fetch="lookup"
            display-field="code"
            hint-field="name"
            .displayValue=${q.accountCode}
            .selectedId=${q.accountCode}
            @item-selected=${(e: PickEvent) => { q.accountCode = e.detail.label; }}
            @item-cleared=${() => { q.accountCode = ""; }}
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
        ${totals.accountName
          ? html`<div class="text-sm text-muted no-print">
              ${totals.account} — ${totals.accountName}
            </div>`
          : ""}

        <table class="table table-sm w-full">
          <thead>
            <tr>
              <th class="w-24">${t("invoice.date")}</th>
              <th class="w-56">${t("accountCard.document")}</th>
              <th>${t("accountCard.analytics")}</th>
              <th class="w-20">${t("accountCard.corrAccount")}</th>
              <th>${t("accountCard.corrAnalytics")}</th>
              <th class="w-28 text-right">${t("manualEntry.debit")}</th>
              <th class="w-28 text-right">${t("manualEntry.credit")}</th>
              <th class="w-28 text-right">${t("accountCard.balance")}</th>
              ${this.showCurrency ? html`
                <th class="w-28 text-right">${t("manualEntry.currencyAmount")}</th>
                <th class="w-16">${t("manualEntry.currency")}</th>` : ""}
              ${this.showQuantity ? html`<th class="w-24 text-right">${t("manualEntry.quantity")}</th>` : ""}
            </tr>
          </thead>
          <tbody>
            <tr class="font-medium">
              <td colspan="5">${t("accountCard.opening")}</td>
              <td class="text-right tabular-nums">${amount(totals.openingDebit)}</td>
              <td class="text-right tabular-nums">${amount(totals.openingCredit)}</td>
              <td></td>
              ${this.extraFillerCells("td")}
            </tr>
            ${this.$root.rows.map((row) => this.renderRow(row))}
            ${this.$root.rows.length === 0
              ? html`<tr><td colspan="8" class="text-center text-muted py-4">${t("common.noData")}</td></tr>`
              : ""}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="5" class="text-right">${t("accountCard.turnover")}</th>
              <th class="text-right tabular-nums">${amount(totals.turnoverDebit)}</th>
              <th class="text-right tabular-nums">${amount(totals.turnoverCredit)}</th>
              <th></th>
              ${this.extraFillerCells("th")}
            </tr>
            <tr>
              <th colspan="5" class="text-right">${t("accountCard.closing")}</th>
              <th class="text-right tabular-nums">${amount(totals.closingDebit)}</th>
              <th class="text-right tabular-nums">${amount(totals.closingCredit)}</th>
              <th></th>
              ${this.extraFillerCells("th")}
            </tr>
          </tfoot>
        </table>
    `;
  }
}
