import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import { dateFormat, formatDate } from "@client/shared/datetime.ts";
import { viewRoute } from "@shared/view-route.ts";
import {
  AccountCardRootSchema,
  type AccountCardRoot,
  type AccountCardRow,
  type ReportAnalytic,
} from "./account_card.schema.ts";
import "@client/ui-kit/components/ui-picker.ts";
import "@client/ui-kit/components/ui-date.ts";

export const tagName = "account-card-report";

type PickEvent = CustomEvent<{ id: string; label: string }>;
type DateEvent = CustomEvent<{ value: string }>;

const money = new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 0 у звіті — це порожня клітинка, а не «нуль»: так читається сітка сум. */
function amount(value: number | undefined): string {
  return value ? money.format(value) : "";
}

@customElement(tagName)
export class AccountCardReport extends BaseUI<AccountCardRoot> {
  protected model = "account_card";

  constructor() {
    super(AccountCardRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    // Період за замовчуванням — поточний місяць: звіт відкривається вже
    // придатним до запуску, без ручного заповнення дат.
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    this.$root.$query.dateFrom ||= iso(first);
    this.$root.$query.dateTo ||= iso(last);
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

  private get canRun(): boolean {
    const q = this.$root.$query;
    return !this.busy && !!q.organizationId && !!q.accountCode;
  }

  private async buildReport() {
    const q = this.$root.$query;
    await this.loadInto("index", {
      organizationId: q.organizationId,
      accountCode: q.accountCode,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
    });
  }

  /**
   * Drill-down. Маршрут форми беремо з view-manifest за ключем моделі —
   * той самий ключ, що лежить у app.document_type / app.analytic_dimension.
   * Немає в'ю — немає й переходу: мовчки нічого не робимо, бо це не помилка
   * даних, а просто не реалізований екран.
   */
  private open(modelKey: string, id: string) {
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
            @click=${() => this.open(a.modelKey, a.valueId)}>
            ${a.presentation}
          </button>
        `)}
      </div>
    `;
  }

  private renderRow(row: AccountCardRow): TemplateResult {
    return html`
      <tr>
        <td class="cell-text whitespace-nowrap">${formatDate(row.docDate, dateFormat.date)}</td>
        <td class="cell-text">
          <button class="link link-hover" title=${row.documentTypeName}
            @click=${() => this.open(row.documentTypeCode, row.documentId)}>
            ${row.documentTypeName} ${row.docNumber ?? ""}
          </button>
        </td>
        <td class="cell-text">${this.renderAnalytics(row.analytics)}</td>
        <td class="cell-text whitespace-nowrap" title=${row.corrAccountName ?? ""}>${row.corrAccount ?? ""}</td>
        <td class="cell-text">${this.renderAnalytics(row.corrAnalytics)}</td>
        <td class="cell-text text-right tabular-nums">${amount(row.debit)}</td>
        <td class="cell-text text-right tabular-nums">${amount(row.credit)}</td>
        <td class="cell-text text-right tabular-nums">
          ${row.balanceDebit ? amount(row.balanceDebit) : ""}
          ${row.balanceCredit ? html`<span class="text-error">${amount(row.balanceCredit)}</span>` : ""}
        </td>
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

        ${totals.accountName
          ? html`<div class="text-sm text-base-content/70">
              ${totals.account} — ${totals.accountName}
            </div>`
          : ""}

        <table class="table table-sm w-full table-tabular">
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
            </tr>
          </thead>
          <tbody>
            <tr class="font-medium">
              <td class="cell-text" colspan="5">${t("accountCard.opening")}</td>
              <td class="cell-text text-right tabular-nums">${amount(totals.openingDebit)}</td>
              <td class="cell-text text-right tabular-nums">${amount(totals.openingCredit)}</td>
              <td></td>
            </tr>
            ${this.$root.rows.map((row) => this.renderRow(row))}
            ${this.$root.rows.length === 0
              ? html`<tr><td colspan="8" class="text-center text-base-content/40 py-4">${t("common.noData")}</td></tr>`
              : ""}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="5" class="text-right">${t("accountCard.turnover")}</th>
              <th class="text-right tabular-nums">${amount(totals.turnoverDebit)}</th>
              <th class="text-right tabular-nums">${amount(totals.turnoverCredit)}</th>
              <th></th>
            </tr>
            <tr>
              <th colspan="5" class="text-right">${t("accountCard.closing")}</th>
              <th class="text-right tabular-nums">${amount(totals.closingDebit)}</th>
              <th class="text-right tabular-nums">${amount(totals.closingCredit)}</th>
              <th></th>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }
}
