import { type CSSResultGroup, css, html, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { t } from "@client/locale.ts";
import { tw } from "@client/shared/styles.ts";
import { FilteredBase } from "./filtered-base.ts";
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
 * Фільтри — та сама механіка, що в списків (`FilteredBase`): значення в
 * `$root.$filters`, запис через `setFilter`/`setFilters`, у payload вкладеним
 * об'єктом `filters`, ссылка одним ключем з об'єктом `{id, name}`. Генератора
 * SQL у звітів немає — команду `index` пишуть руками, — але контракт payload
 * від цього не міняється, і саме тому він однаковий: інакше в застосунку жили б
 * дві різні домовленості про те саме, і жодна не була б очевидною.
 *
 * Чим звіт відрізняється: зміна фільтра НЕ переформовує його — оборотка за рік
 * коштує стільки, що ганяти її на кожен клац по фільтру не можна. Тому спільний
 * гак `onFiltersChanged()` список перевизначає на `reload()`, а звіт — на ознаку
 * «застарів» (розмиття плюс вікно з кнопкою; див. нижче).
 *
 * Обов'язкове для підкласу: `model`, `reportTitle`, `buildReport()`.
 */
export abstract class ReportBase<Root extends Record<string, unknown>> extends FilteredBase<Root> {
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

    /* Застарілий звіт. Розмиття СЛАБКЕ (2px) і навмисно: цифри мусять
       лишитися впізнаваними — це ще той звіт, який замовляли, — але читати їх
       по одній уже не виходить, а саме цього ми й домагаємося. Приглушення
       кольору додає ознаку, яка переживає і чорно-білий монітор, і людину, що
       розмиття не помічає.

       pointer-events:none — не прикраса: у звіті клікають рядки
       (розшифровка), і перехід за старим рядком відкрив би картку не того
       рахунку, а слідів того, що дані були застарілі, ніде не лишилося б. */
    .report-body.stale {
      filter: blur(2px) opacity(0.55);
      pointer-events: none;
      user-select: none;
    }

    /* Вікно поверх звіту. sticky, а не fixed: воно мусить лишатися в межах
       вкладки (застосунок багатовкладковий, fixed виліз би поверх сусідньої) і
       не з'їжджати з очей при прокрутці довгого звіту.

       Обгортка нульової висоти — щоб вікно НАКРИВАЛО звіт, а не розсувало
       його. Від'ємний відступ дав би те саме, але числом, підібраним під
       поточну висоту кнопки: перший же довший переклад напису зсунув би
       розкладку, і мовчки. Нульова висота від висоти вмісту не залежить. */
    .stale-slot {
      position: sticky;
      top: .5rem;
      z-index: 15;
      height: 0;
      display: flex;
      justify-content: center;
      /* Обов'язкове саме тут: за замовчуванням flex розтягує дитину на висоту
         контейнера, а вона нульова — вікно ставало смужкою, і кнопка з текстом
         вилазили за рамку. Прив'язка до верху лишає вікну власну висоту. */
      align-items: flex-start;
    }
    .stale-notice {
      display: flex;
      align-items: center;
      gap: .75rem;
      padding: .5rem .75rem;
      /* Не стискається: інакше на вузькому екрані flex забрав би ширину в
         кнопки, а не переніс би текст. */
      flex: 0 0 auto;
      max-width: 100%;
      background: var(--app-surface-strong, #fff);
      border: 1px solid var(--color-warning, #a86a00);
      border-radius: 2px;
      box-shadow: 0 2px 8px rgb(0 0 0 / .18);
    }

    @media (prefers-reduced-motion: no-preference) {
      .report-body { transition: filter .15s ease-out; }
    }

    /* На папері розмиття немає. Друкують усвідомлено — кнопка нікуди не
       зникає, — а розмита таблиця на аркуші була б просто зіпсованою. Правило
       потрібне явно: filter не «екранна» властивість, у друк воно йде. */
    @media print {
      .report-body.stale { filter: none; pointer-events: auto; }
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

  // ── Застарілий звіт ───────────────────────────────────────────────────────
  //
  // Звіт не переформовується сам, і це правильно (оборотка за рік коштує
  // дорого) — але без ознаки на екрані лишалися б ЦИФРИ ЗА СТАРИМИ ФІЛЬТРАМИ
  // під новим періодом у панелі. Найгірший різновид помилки: усе виглядає
  // справним, а число неправильне, і на папір воно поїде так само.

  /**
   * `null` — звіт ще не формували (ознаці нема з чим розходитися), далі —
   * чи чіпали фільтри після формування.
   *
   * Копії фільтрів тут немає навмисно: питання стоїть «змінилися чи ні», а не
   * «на що саме», тож зберігати їхній знімок нема потреби. Ціна одна й відома:
   * фільтр, змінений і повернутий назад, лишає ознаку — звіт запропонує
   * переформувати те, що й так збігається. Помилка в безпечний бік, на відміну
   * від протилежної.
   */
  @state() private stale: boolean | null = null;

  /** Чи розійшовся звіт на екрані з фільтрами. */
  protected get isStale(): boolean {
    return this.stale === true;
  }

  /**
   * Чи звіт узагалі формували в цій вкладці.
   *
   * Порожній екран до першого «Оновити» і порожній результат — це різні речі, і
   * ліки в них протилежні: у першому випадку треба натиснути кнопку, у другому —
   * змінити відбір. Ознака вже є в `stale` (`null` = ще не формували), тож
   * окремого стану не заводимо.
   */
  protected get isBuilt(): boolean {
    return this.stale !== null;
  }

  /**
   * Фільтри змінилися. Список цей гак перевизначає на перезапит, звіт — на
   * ознаку: формувати сам він не буде.
   */
  protected override onFiltersChanged() {
    if (this.stale !== null) this.stale = true;
  }

  /**
   * Ознака гаситься ТУТ, а не в кнопці «Оновити»: звіт формують і повз неї —
   * `applyParams` при переході з іншого звіту, власний виклик підкласу. Одне
   * місце на всі шляхи; саме тому прапорця тут вистачає.
   */
  protected override async loadInto(
    command: string,
    payload: unknown,
    kind: "load" | "save" = "load",
  ): Promise<boolean> {
    const ok = await super.loadInto(command, payload, kind);
    if (command === this.indexCommand) this.stale = false;
    return ok;
  }

  // ── Точки розширення ──────────────────────────────────────────────────────

  /**
   * Фільтри звіту (організація, рахунок, період). Малюються під тулбаром — на
   * відміну від списку, де вони в згортній панелі праворуч: у звіті їх
   * заповнюють ПЕРЕД тим, як він з'явиться, тож ховати їх нема сенсу.
   */
  protected renderFilters(): TemplateResult | string { return ""; }

  /**
   * Параметри переходу лягають у фільтри, а не в `$query`: у звіті `$filters`
   * і є весь стан запиту. Саме цим працює розшифровка — оборотка відкриває
   * картку рахунку з тими самими організацією й періодом.
   */
  override applyParams(params: Record<string, unknown>) {
    this.setFilters(params);
  }

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

  /**
   * Чим звужено — рядок під «немає даних».
   *
   * Умовчання — той самий підпис, що йде на папір (`printSubtitle()`): звіт його
   * вже пише, і в ньому рівно те, що треба назвати — організація й період.
   * Другого переліку фільтрів заводити не варто: він розійшовся б із першим, і
   * мовчки. Перекривають цей метод тоді, коли на екрані доречно сказати більше,
   * ніж на аркуші.
   */
  protected emptyHint(): string { return this.printSubtitle(); }

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

  /**
   * Порожній звіт замість таблиці.
   *
   * «Немає даних» саме по собі не каже головного — те саме, що вже вирішено для
   * списків (`QueryTableBase.renderEmpty`). Але у звіті причина інша й майже
   * завжди одна: **відбір обов'язковий**, тож найчастіша порожнеча — не «нічого
   * не заведено», а «дивимося не туди»: не та організація, не той період.
   * Сплутати це з «звіт зламався» найлегше, а коштує довго — шукати йдуть у SQL.
   *
   * Кнопки тут немає навмисно, і це відмінність від списку: фільтри звіту стоять
   * на очах під тулбаром (не в згортній панелі), тому вихід з причини — сам
   * екран. «Скинути фільтри» тут ще й шкідливе: обов'язкові поля довелося б
   * заповнювати заново.
   */
  protected renderEmpty(): TemplateResult {
    const hint = this.emptyHint();
    return html`
      <div class="text-center p-8 text-muted flex flex-col items-center gap-1">
        <span>${this.isBuilt ? t("common.noData") : t("report.notBuilt")}</span>
        ${this.isBuilt && hint ? html`<span class="text-sm">${t("report.emptyFor", { filters: hint })}</span>` : nothing}
      </div>
    `;
  }

  /**
   * Вікно «параметри змінилися». `role="status"` — щоб про це дізналася й
   * читалка екрана: розмиття для неї не існує, а звіт під ним застарілий.
   *
   * Не банер `renderNotice()` навмисно: той стоїть над звітом і при прокрутці
   * довгої таблиці лишається вгорі, тобто саме там, куди вже не дивляться.
   */
  private renderStaleNotice(): TemplateResult | typeof nothing {
    if (!this.isStale) return nothing;
    return html`
      <div class="stale-slot no-print">
        <div class="stale-notice" role="status">
          <span>${t("report.stale")}</span>
          <button class="btn btn-sm btn-primary" ?disabled=${!this.canRun} @click=${this.buildReport}>
            ${icons.refresh} ${t("report.rebuild")}
          </button>
        </div>
      </div>
    `;
  }

  override render(): TemplateResult {
    return html`
      <div class="flex flex-col">
        ${this.renderToolbar()}
        <div class="p-2 flex flex-col gap-2">
          ${this.renderNotice()}
          ${this.renderStaleNotice()}
          <div class="report-body flex flex-col gap-2 ${this.isStale ? "stale" : ""}">
            ${this.renderPrintHeader()}
            ${this.hasData ? this.renderBody() : this.renderEmpty()}
          </div>
        </div>
      </div>
    `;
  }
}
