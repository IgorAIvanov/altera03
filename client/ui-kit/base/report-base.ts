import { css, html, type TemplateResult } from "lit";
import { t } from "@client/locale.ts";
import { tw } from "@client/shared/styles.ts";
import { BaseUI } from "./base-ui.ts";
import { readReportTable, withTitleRows } from "../report/table-model.ts";
import { buildXlsx, downloadFile, safeFileName, XLSX_MIME } from "../report/xlsx.ts";
import { printCurrentView } from "../report/print.ts";

// Розмір і прозорість — атрибутами SVG, а не класами Tailwind: у shadow DOM
// іконка не має залежати від того, чи згенеровано `h-4` (див. тему).
const icon = {
  refresh: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  print: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  excel: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="19"/><line x1="15" y1="13" x2="9" y2="19"/></svg>`,
};

/**
 * Базовий клас екрана звіту.
 *
 * Дає те, що в звіті обов'язкове й однакове: закріплений тулбар «Оновити —
 * Друк — Excel», зона фільтрів під ним, банер помилок, шапка «назва звіту,
 * організація, період» для паперу й для файлу. Підклас лишає собі те, що в
 * кожного звіту своє: фільтри, запит і таблиця.
 *
 * Друк і експорт беруть уже намальовану таблицю (див. `report/table-model.ts`),
 * тому підключаються без жодного опису колонок — новий звіт отримує обидві дії
 * самим фактом наслідування. Єдина умова: у розмітці має бути `<table>` (якщо
 * їх кілька — перша вважається основною).
 *
 * Обов'язкове для підкласу: `model`, `reportTitle`, `buildReport()`.
 */
export abstract class ReportBase<Root extends Record<string, unknown>> extends BaseUI<Root> {
  static override styles = [tw, css`
    /* Тулбар не їде вгору разом зі звітом: прокручується панель вкладки, а
       блок липне до її верху. Фон непрозорий — під ним проїжджають рядки. */
    .report-head {
      position: sticky;
      top: 0;
      z-index: 20;
      background: var(--app-surface-strong, #fff);
      border-bottom: 1px solid var(--app-border, #b8c3cc);
    }
  `];

  /** Ключ локалізації назви звіту — заголовок на папері та в Excel. */
  protected abstract reportTitle: string;

  /** Сформувати звіт. Викликається кнопкою «Оновити» і підкласом. */
  protected abstract buildReport(): Promise<void>;

  /** Чи можна формувати: заповнені обов'язкові фільтри й немає запиту в польоті. */
  protected get canRun(): boolean {
    return !this.busy;
  }

  /** Ім'я команди, що формує звіт, — для спінера на кнопці. */
  protected indexCommand = "index";

  // ── Точки розширення ──────────────────────────────────────────────────────

  /** Фільтри звіту (організація, рахунок, період). Малюються під тулбаром. */
  protected renderFilters(): TemplateResult | string { return ""; }

  /** Додаткові кнопки тулбару — між стандартними діями та правим краєм. */
  protected renderToolbarExtra(): TemplateResult | string { return ""; }

  /**
   * Другий рядок шапки: організація й період — те, без чого роздрукований
   * аркуш не можна прочитати («за який період? по якій організації?»).
   * Повертає порожній рядок — рядка не буде.
   */
  protected printSubtitle(): string { return ""; }

  /** Чи є що друкувати й вивантажувати. Порожній звіт вимикає обидві кнопки. */
  protected get hasData(): boolean {
    const rows = (this.$root as Record<string, unknown>).rows;
    return Array.isArray(rows) && rows.length > 0;
  }

  // ── Дії тулбару ───────────────────────────────────────────────────────────

  /** Основна таблиця звіту у власному shadow root. */
  private reportTable(): HTMLTableElement | null {
    return this.renderRoot.querySelector<HTMLTableElement>("table");
  }

  protected print() {
    // Назва звіту йде в колонтитул сторінки й у пропоноване ім'я PDF-файлу.
    printCurrentView(t(this.reportTitle));
  }

  /**
   * Вивантаження в .xlsx. Дані беруться з екрана, тому файл повторює звіт
   * один-в-один — включно з колонками, які з'явилися за наявністю даних.
   */
  protected exportExcel() {
    const table = this.reportTable();
    if (!table) return;

    const title = t(this.reportTitle);
    const model = withTitleRows(readReportTable(table), [title, this.printSubtitle()]);
    const bytes = buildXlsx(title, model);
    downloadFile(bytes, `${safeFileName(title)}.xlsx`, XLSX_MIME);
  }

  // ── Рендер ────────────────────────────────────────────────────────────────

  private renderToolbar(): TemplateResult {
    return html`
      <div class="report-head no-print flex flex-col gap-2 p-2">
        <div class="flex items-center gap-2 flex-wrap">
          <button class="btn btn-sm btn-primary" ?disabled=${!this.canRun} @click=${this.buildReport}>
            ${this.running === this.indexCommand
              ? html`<span class="loading loading-spinner loading-xs"></span>`
              : icon.refresh}
            ${t("common.refresh")}
          </button>
          <button class="btn btn-sm" ?disabled=${!this.hasData} @click=${this.print}>
            ${icon.print} ${t("common.print")}
          </button>
          <button class="btn btn-sm" ?disabled=${!this.hasData} @click=${this.exportExcel}>
            ${icon.excel} ${t("common.exportExcel")}
          </button>
          ${this.renderToolbarExtra()}
        </div>
        ${this.renderFilters()}
      </div>
    `;
  }

  /** Шапка для паперу: на екрані те саме видно у фільтрах, тому вона `print-only`. */
  private renderPrintHeader(): TemplateResult {
    const subtitle = this.printSubtitle();
    return html`
      <div class="print-only mb-2">
        <div class="print-title">${t(this.reportTitle)}</div>
        ${subtitle ? html`<div class="print-subtitle">${subtitle}</div>` : ""}
      </div>
    `;
  }

  /** Тіло звіту — таблиця. Реалізує підклас. */
  protected abstract renderBody(): TemplateResult;

  override render() {
    return html`
      <div class="flex flex-col">
        ${this.renderToolbar()}
        <div class="p-2 flex flex-col gap-2">
          ${this.renderNotice()}
          ${this.renderPrintHeader()}
          ${this.renderBody()}
        </div>
      </div>
    `;
  }
}
