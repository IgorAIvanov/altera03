import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { ReportBase } from "@client/ui-kit/base/report-base.ts";
import { dateFormat, formatDate } from "@client/shared/datetime.ts";
import { viewRoute } from "@shared/view-route.ts";
import {
  DocumentMovementsRootSchema,
  type DocumentMovementsRoot,
  type DocumentMovementRow,
  type MovementAnalytic,
  type MovementDocument,
} from "./document_movements.schema.ts";

export const tagName = "document-movements-report";

const money = new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function amount(value: number | undefined): string {
  return value ? money.format(value) : "";
}

@customElement(tagName)
export class DocumentMovementsReport extends ReportBase<DocumentMovementsRoot> {
  protected model = "document_movements";
  protected reportTitle = "documentMovements.title";

  constructor() {
    super(DocumentMovementsRootSchema);
  }

  /**
   * Звіт відкривається лише переходом (з картки рахунку), тому параметри
   * приходять готовими й вибірка йде одразу — власних фільтрів у нього немає.
   */
  override applyParams(params: Record<string, unknown>) {
    super.applyParams(params);
    if (this.filterValue("documentId")) queueMicrotask(() => this.buildReport());
  }

  protected override get canRun(): boolean {
    return !this.busy && !!this.filterValue("documentId");
  }

  /** Рядок під назвою звіту на папері та в Excel: сам документ і організація. */
  protected override printSubtitle(): string {
    const doc = this.$root.document;
    const title = [doc.documentTypeName, doc.number].filter(Boolean).join(" ");
    const date = formatDate(doc.docDate, dateFormat.date);
    return [title, date, doc.organizationName].filter(Boolean).join(" · ");
  }

  protected override async buildReport() {
    const env = await this.run<{ extra?: { document?: MovementDocument } }>(
      "index",
      this.filtersPayload(),
    );
    if (!env.ok || !env.data) return;
    // rows зеркалимо як звичайно; шапку дістаємо з extra — вона транзієнтна
    // в конверті, тому assign її не бачить.
    this.assign(env.data as Partial<DocumentMovementsRoot>);
    const doc = env.data.extra?.document;
    if (doc) this.$root.document = { ...this.$root.document, ...doc };
  }

  /** Перехід до самої форми документа за ключем його типу. */
  private openDocument() {
    const doc = this.$root.document;
    const route = viewRoute(doc.documentTypeCode, "edit");
    if (route && doc.documentId) bus.emit({ type: "tab.open", route, id: doc.documentId });
  }

  /** Перехід до довідника субконто. */
  private openAnalytic(a: MovementAnalytic) {
    const route = viewRoute(a.modelKey, "edit");
    if (route) bus.emit({ type: "tab.open", route, id: a.valueId });
  }

  private renderAnalytics(items: MovementAnalytic[]): TemplateResult | string {
    if (!items.length) return "";
    return html`
      <div class="flex flex-col">
        ${items.map((a) => html`
          <button class="link link-hover text-xs text-left truncate" title=${a.dimensionName}
            @click=${() => this.openAnalytic(a)}>
            ${a.presentation}
          </button>
        `)}
      </div>
    `;
  }

  // Окремі числові колонки під валюту й кількість — щоб звіт, вивантажений в
  // Excel, лишався придатним до обчислень. Кожна показується, лише коли є в даних.
  private get showCurrency(): boolean {
    return this.$root.rows.some((r) => r.currencyAmount);
  }
  private get showQuantity(): boolean {
    return this.$root.rows.some((r) => r.quantity);
  }

  private renderExtraCells(row: DocumentMovementRow): TemplateResult | string {
    return html`
      ${this.showCurrency ? html`
        <td class="text-right tabular-nums">${amount(row.currencyAmount ?? 0)}</td>
        <td class="text-muted">${row.currencyCode ?? ""}</td>` : ""}
      ${this.showQuantity
        ? html`<td class="text-right tabular-nums">${row.quantity ?? ""}</td>` : ""}
    `;
  }

  private renderRow(row: DocumentMovementRow): TemplateResult {
    return html`
      <tr>
        <td>${row.lineNo}</td>
        <td class="whitespace-nowrap" title=${row.debitAccountName ?? ""}>${row.debitAccount ?? ""}</td>
        <td>${this.renderAnalytics(row.debitAnalytics)}</td>
        <td class="whitespace-nowrap" title=${row.creditAccountName ?? ""}>${row.creditAccount ?? ""}</td>
        <td>${this.renderAnalytics(row.creditAnalytics)}</td>
        <td class="text-right tabular-nums">${amount(row.amount)}</td>
        ${this.renderExtraCells(row)}
        <td>${row.description ?? ""}</td>
      </tr>
    `;
  }

  /** Перехід до самого документа — дія цього звіту, тож стоїть у тулбарі. */
  protected override renderToolbarExtra(): TemplateResult {
    return html`
      <button class="btn btn-sm" ?disabled=${!this.$root.document.documentId} @click=${this.openDocument}>
        ${t("documentMovements.openDocument")}
      </button>
    `;
  }

  protected override renderFilters(): TemplateResult {
    const doc = this.$root.document;

    return html`
        <div class="flex flex-col">
          <span class="font-medium">
            ${doc.documentTypeName} ${doc.number ?? ""}
            ${doc.isPosted ? html`<span class="badge badge-success badge-xs ml-1"></span>` : ""}
          </span>
          <span class="text-xs text-muted">
            ${formatDate(doc.docDate, dateFormat.dateTime)} · ${doc.organizationName}
          </span>
        </div>
    `;
  }

  protected override renderBody(): TemplateResult {
    const doc = this.$root.document;

    return html`
        <table class="table table-sm w-full">
          <thead>
            <tr>
              <th class="w-10">#</th>
              <th class="w-20">${t("manualEntry.debit")}</th>
              <th>${t("accountCard.analytics")}</th>
              <th class="w-20">${t("manualEntry.credit")}</th>
              <th>${t("accountCard.analytics")}</th>
              <th class="w-32 text-right">${t("invoice.amount")}</th>
              ${this.showCurrency ? html`
                <th class="w-28 text-right">${t("manualEntry.currencyAmount")}</th>
                <th class="w-16">${t("manualEntry.currency")}</th>` : ""}
              ${this.showQuantity ? html`<th class="w-24 text-right">${t("manualEntry.quantity")}</th>` : ""}
              <th>${t("manualEntry.description")}</th>
            </tr>
          </thead>
          <tbody>
            ${this.$root.rows.map((row) => this.renderRow(row))}
            ${this.$root.rows.length === 0
              ? html`<tr><td colspan="7" class="text-center text-muted py-4">${t("common.noData")}</td></tr>`
              : ""}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="5" class="text-right">${t("invoice.total")}</th>
              <th class="text-right tabular-nums">${amount(doc.total)}</th>
              ${this.showCurrency ? html`<th></th><th></th>` : ""}
              ${this.showQuantity ? html`<th></th>` : ""}
              <th></th>
            </tr>
          </tfoot>
        </table>
    `;
  }
}
