import { type CSSResultGroup, css, html, type TemplateResult } from "lit";
import { t } from "@client/locale.ts";
import { tw } from "@client/shared/styles.ts";
import { BaseUI } from "./base-ui.ts";
import { NO_EXPORT_CLASS, readReportTable, withTitleRows } from "../report/table-model.ts";
import { buildXlsx, downloadFile, safeFileName, XLSX_MIME } from "../report/xlsx.ts";
import { printCurrentView } from "../report/print.ts";
import { icons } from "../icons.ts";

// Розмір і прозорість — атрибутами SVG, а не класами Tailwind: у shadow DOM
// іконка не має залежати від того, чи згенеровано `h-4` (див. тему).

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
  // Звіт нічого не зберігає — незбережених змін у нього не буває.
  protected override dirtyTracking = false;

  static override styles: CSSResultGroup = [tw, css`
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

  /**
   * Основна таблиця звіту у власному shadow root.
   *
   * Перша, що не позначена `no-export`. Позначка потрібна, коли на екрані є ще
   * одна таблиця — легенда графіка, довідкова врізка: без неї експорт вивантажив
   * би саме її, бо вона трапилась у розмітці раніше.
   */
  private reportTable(): HTMLTableElement | null {
    return this.renderRoot.querySelector<HTMLTableElement>(`table:not(.${NO_EXPORT_CLASS})`);
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
              : icons.refresh}
            ${t("common.refresh")}
          </button>
          <button class="btn btn-sm" ?disabled=${!this.hasData} @click=${this.print}>
            ${icons.print} ${t("common.print")}
          </button>
          <button class="btn btn-sm" ?disabled=${!this.hasData} @click=${this.exportExcel}>
            ${icons.excel} ${t("common.exportExcel")}
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

  override render(): TemplateResult {
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
