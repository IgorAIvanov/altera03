import { GlobalStyledLitElement } from "../base/gsle.ts";
import { html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { t } from "../../locale.ts";
import { dateFormat, todayIso, toParts } from "../../shared/datetime.ts";
import { placePopover, POPOVER_ANCHORED_STYLE } from "../popover.ts";
import {
  monthNames,
  parsePeriodUnits,
  type Period,
  periodLabel,
  periodOf,
  type PeriodPickUnit,
  type PeriodUnit,
  periodUnit,
  type PeriodUnitChoice,
  QUARTER_ROMAN,
  shiftPeriod,
} from "../../shared/period.ts";
import "./ui-date.ts";

/**
 * Поле періоду — одна пара дат `dateFrom..dateTo` (ISO, обидві включно)
 * замість двох окремих полів «з/по».
 *
 * ```html
 * <ui-period date-from="2026-07-01" date-to="2026-07-31"></ui-period>
 * ```
 *
 * Посередині — кнопка з людською назвою періоду («Липень 2026», «III квартал
 * 2026», інакше пара дат), вона відкриває список пресетів (сьогодні, тиждень,
 * місяць, квартал, рік — цей і минулий) із двома `ui-date` для довільного
 * періоду внизу. Стрілки ◀ ▶ зсувають період на його ж величину: місяць —
 * місяцем, довільні N днів — на N днів.
 *
 * Невалідну пару компонент не віддає: редагування однієї межі за іншу підтягує
 * ту другу. Подія `period-changed` з `detail: { dateFrom, dateTo, unit }` — на
 * кожну зміну.
 *
 * РЕЖИМ ОДИНИЦІ — `units`. Питання ставлять не лише відрізком: «закриття за
 * березень», «декларація за I квартал», «баланс за 2025-й» — це ОДИНИЦЯ, і
 * пресети її не давали, бо всі вісім прив'язані до сьогодні. Щоб узяти березень
 * у серпні, лишалося набрати дві дати руками — тобто рівно той ввід, від якого
 * поле й рятує.
 *
 * ```html
 * <ui-period units="month" value="2026-03-01"></ui-period>
 * <ui-period units="month,quarter,year,custom"></ui-period>
 * ```
 *
 * У поповері замість пресетів — смуга одиниць (лише коли їх більше однієї),
 * навігатор `‹ 2026 ›` і сітка з 12 місяців, 4 кварталів або 12 років.
 *
 * ЗНАЧЕННЯ ЛИШАЄТЬСЯ ПАРОЮ. `value` — це початок одиниці (`2026-03-01`), і він
 * не замінює `dateFrom`/`dateTo`, а розгортається в них: звіт, який фільтрує
 * однією датою, читає `value`, звіт, який фільтрує парою, — ті самі межі, і
 * поле годиться обом. Другого джерела правди тут немає навмисно: пара — це те,
 * що приймає SQL, а одиниця виводиться з неї (`periodUnit`) щоразу заново.
 */
@customElement("ui-period")
export class UiPeriod extends GlobalStyledLitElement {
  /** ISO-межі періоду, обидві включно. */
  @property({ type: String, attribute: "date-from" }) dateFrom = "";
  @property({ type: String, attribute: "date-to" }) dateTo = "";
  @property({ type: String }) label = "";
  @property({ type: String, attribute: "label-position" }) labelPosition: "top" | "left" = "top";
  /** Шаблон дат довільного періоду (підпис і поля вводу): `DD.MM.YY` ... */
  @property({ type: String }) format: string = dateFormat.date;
  /** Розмір daisyUI-кнопок: `xs` | `sm` | `md` | `lg`. Порожньо — типовий. */
  @property({ type: String }) size: "" | "xs" | "sm" | "md" | "lg" = "";
  @property({ type: String }) width = "";
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) visible = true;
  /**
   * Перелік одиниць вибору через кому: `month`, `quarter`, `year`, `custom`.
   * Порожньо — поповер із пресетами, як було.
   *
   * Порядок значущий: він задає і порядок вкладок, і одиницю за умовчанням.
   * Перелік з однієї одиниці смуги вкладок не малює — вибір з одного пункту не
   * вибір; саме так і стоїть у довідці, яка відповідає лише за місяць.
   */
  @property({ type: String }) units = "";
  /**
   * Початок одиниці (`2026-03-01`) — для звітів, що фільтрують ОДНІЄЮ датою.
   *
   * Не друге джерело правди: розгортається в `dateFrom`/`dateTo` тією ж
   * одиницею, а назад читається як `dateFrom`. Поза режимом одиниці не діє —
   * розгортати нема чим.
   */
  @property({ type: String }) value = "";

  @state() private _open = false;
  /** Вкладка, яку відкрив користувач; `null` — виводиться з періоду. */
  @state() private _tab: PeriodPickUnit | "custom" | null = null;
  /** Рік у навігаторі сітки; `0` — виводиться з періоду (інакше — сьогодні). */
  @state() private _navYear = 0;

  /**
   * Розібраний `units`. Полем, а не гетером: розбір попереджає про невідоме
   * слово, а гетер кличеться на кожен рендер — і одна помилка в атрибуті
   * заповнила б консоль сотнею однакових рядків.
   */
  #choice: PeriodUnitChoice = { units: [], custom: false };

  @query("[popover]") private _popover?: HTMLElement;
  @query(".join") private _anchor?: HTMLElement;

  /**
   * Розбір `units` і розгортання `value` — тут, а не в сетерах: до `willUpdate`
   * виставлені ВСІ властивості оновлення, тож `value` розгортається вже
   * відомою одиницею. У сетері це залежало б від порядку, у якому написані
   * атрибути, — тобто працювало б у прикладі й розсипалося в застосунку.
   */
  protected override willUpdate(changed: PropertyValues) {
    if (changed.has("units")) this.#choice = parsePeriodUnits(this.units);

    if (changed.has("value") && this.value !== this.dateFrom) {
      const unit = this.#choice.units.length ? this._activeUnit : null;
      if (unit) {
        const p = this.value ? periodOf(unit, this.value) : { dateFrom: "", dateTo: "" };
        this.dateFrom = p.dateFrom;
        this.dateTo = p.dateTo;
        // Значення приводиться до ПОЧАТКУ одиниці: 17 серпня, покладене в
        // поле місяця, означає серпень, і прочитати з поля треба саме серпень,
        // а не те, що в нього поклали.
        this.value = p.dateFrom;
      }
    }
  }

  private get _period(): Period {
    return { dateFrom: this.dateFrom, dateTo: this.dateTo };
  }

  private _set(p: Period) {
    if (p.dateFrom === this.dateFrom && p.dateTo === this.dateTo) return;
    this.dateFrom = p.dateFrom;
    this.dateTo = p.dateTo;
    // `value` йде слідом за початком, а не живе окремо: інакше поле, прочитане
    // властивістю після вибору мишею, віддавало б те, що в нього поклали.
    this.value = p.dateFrom;
    this.dispatchEvent(new CustomEvent("period-changed", {
      // `unit` — щоб той самий обробник годився й одиниці, й відрізку: `null`
      // означає «це не рівно календарний період», а не «не знаю».
      detail: { dateFrom: this.dateFrom, dateTo: this.dateTo, unit: periodUnit(p) },
      bubbles: true,
      composed: true,
    }));
  }

  private _shift(dir: 1 | -1) {
    this._set(shiftPeriod(this._period, dir));
  }

  /** Межа не заходить за протилежну: та підтягується (ISO порівнюється як дата). */
  private _setFrom(value: string) {
    const dateTo = value && this.dateTo && value > this.dateTo ? value : this.dateTo;
    this._set({ dateFrom: value, dateTo });
  }

  private _setTo(value: string) {
    const dateFrom = value && this.dateFrom && value < this.dateFrom ? value : this.dateFrom;
    this._set({ dateFrom, dateTo: value });
  }

  // ── Popover ───────────────────────────────────────────────────────────────

  private _toggle() {
    this._open = !this._open;
    // Відкриття завжди показує ТЕ, ЩО ЗАРАЗ вибрано: перегорнутий торік рік і
    // відкрита вкладка кварталів не мають переживати закриття вікна — інакше
    // друге відкриття показує чуже місце, і людина шукає в ньому своє.
    if (this._open) {
      this._tab = null;
      this._navYear = 0;
    }
  }

  /** Синхронізує popover із `_open` і тримає його під полем. */
  protected override updated() {
    const pop = this._popover;
    if (!pop) return;
    const shown = pop.matches(":popover-open");
    if (this._open && !shown) {
      pop.showPopover();
      // Розміщуємо ПІСЛЯ показу: у схованого елемента немає ширини, а без неї
      // не притиснути вікно до краю екрана. Видимого миготіння немає — до
      // відмальовування браузер виконує весь синхронний код.
      if (this._anchor) placePopover(pop, this._anchor);
    }
    if (!this._open && shown) pop.hidePopover();
  }

  /** Браузер закрив popover сам (Esc або клік назовні). */
  private _onPopoverToggle(e: Event) {
    if ((e as ToggleEvent).newState === "closed") this._open = false;
  }

  // ── Пресети ───────────────────────────────────────────────────────────────

  /** `shift: -1` — минулий період тієї ж одиниці. */
  private static readonly PRESETS: ReadonlyArray<{ key: string; unit: PeriodUnit; shift: 0 | -1 }> = [
    { key: "period.today", unit: "day", shift: 0 },
    { key: "period.thisWeek", unit: "week", shift: 0 },
    { key: "period.thisMonth", unit: "month", shift: 0 },
    { key: "period.lastMonth", unit: "month", shift: -1 },
    { key: "period.thisQuarter", unit: "quarter", shift: 0 },
    { key: "period.lastQuarter", unit: "quarter", shift: -1 },
    { key: "period.thisYear", unit: "year", shift: 0 },
    { key: "period.lastYear", unit: "year", shift: -1 },
  ];

  private _pickPreset(p: Period) {
    this._set(p);
    this._open = false;
  }

  private _renderPopover(): TemplateResult {
    return html`
      <div
        popover
        @toggle=${this._onPopoverToggle}
        class="rounded-box shadow-lg p-2"
        style=${`${POPOVER_ANCHORED_STYLE} width:19rem; background:var(--color-base-100,#ffffff); border:1px solid var(--color-base-300,#d1d5db);`}
      >
        ${this._open ? this._renderPopoverBody() : ""}
      </div>
    `;
  }

  /** Пресети — коли одиниці не оголошені; інакше сітка одиниць. */
  private _renderPopoverBody(): TemplateResult {
    return this.#choice.units.length ? this._renderUnitBody() : this._renderPresetBody();
  }

  private _renderPresetBody(): TemplateResult {
    return html`
      <div class="grid grid-cols-2 gap-1">
        ${UiPeriod.PRESETS.map((preset) => {
          const p = preset.shift ? shiftPeriod(periodOf(preset.unit), -1) : periodOf(preset.unit);
          const active = p.dateFrom === this.dateFrom && p.dateTo === this.dateTo;
          return html`
            <button type="button"
              class="btn btn-xs justify-start font-normal whitespace-nowrap ${active ? "btn-primary" : "btn-ghost"}"
              @click=${() => this._pickPreset(p)}>${t(preset.key)}</button>
          `;
        })}
      </div>
      <div class="mt-2 pt-2 border-t border-base-300">
        <div class="text-xs text-muted mb-1">${t("period.custom")}</div>
        ${this._renderCustomRange()}
      </div>
    `;
  }

  /** Пара `ui-date` — одна на обидва режими: це той самий довільний відрізок. */
  private _renderCustomRange(): TemplateResult {
    type DateEvent = CustomEvent<{ value: string }>;
    return html`
      <div class="flex items-center gap-1">
        <ui-date
          class="flex-1 min-w-0"
          size="sm"
          .value=${this.dateFrom}
          format=${this.format}
          @value-changed=${(e: DateEvent) => {
            e.stopPropagation();
            this._setFrom(e.detail.value);
          }}
        ></ui-date>
        <span class="text-muted">—</span>
        <ui-date
          class="flex-1 min-w-0"
          size="sm"
          .value=${this.dateTo}
          format=${this.format}
          @value-changed=${(e: DateEvent) => {
            e.stopPropagation();
            this._setTo(e.detail.value);
          }}
        ></ui-date>
      </div>
    `;
  }

  // ── Режим одиниці ───────────────────────────────────

  /** Вкладки в оголошеному порядку; `custom` — завжди останній. */
  private get _tabs(): Array<PeriodPickUnit | "custom"> {
    return this.#choice.custom
      ? [...this.#choice.units, "custom" as const]
      : [...this.#choice.units];
  }

  /**
   * Одиниця, якою зараз названо період: узята з САМОГО періоду, якщо він
   * рівно їй дорівнює й вона оголошена, інакше — перша оголошена. Тобто поле,
   * відкрите на «III квартал 2026», показує сітку кварталів, а не місяців.
   */
  private get _activeUnit(): PeriodPickUnit {
    const actual = periodUnit(this._period);
    const declared = this.#choice.units;
    return actual && (declared as string[]).includes(actual)
      ? actual as PeriodPickUnit
      : declared[0];
  }

  /** Відкрита вкладка: вибрана людиною, інакше виведена з періоду. */
  private get _activeTab(): PeriodPickUnit | "custom" {
    if (this._tab) return this._tab;
    // Довільний відрізок відкриває вкладку «довільний», якщо вона є: показати
    // на ньому сітку місяців означало б запропонувати стерти те, що вибрано.
    if (this.#choice.custom && periodUnit(this._period) === null && this.dateFrom) return "custom";
    return this._activeUnit;
  }

  /** Рік, показаний у сітці: перегорнутий, інакше з періоду, інакше поточний. */
  private get _year(): number {
    if (this._navYear) return this._navYear;
    return toParts(this.dateFrom)?.year ?? toParts(todayIso())!.year;
  }

  /** Блок років для сітки років — рівно 12, вирівняні: 2016–2027, 2028–2039. */
  private get _yearBlock(): number {
    const y = this._year;
    return y - ((y % 12) + 12) % 12;
  }

  private _pickUnitValue(iso: string, unit: PeriodPickUnit) {
    this._set(periodOf(unit, iso));
    this._open = false;
  }

  private _renderUnitBody(): TemplateResult {
    const tabs = this._tabs;
    const active = this._activeTab;
    const TAB_KEY: Record<string, string> = {
      month: "period.unitMonth",
      quarter: "period.unitQuarter",
      year: "period.unitYear",
      custom: "period.custom",
    };

    return html`
      ${tabs.length > 1
        ? html`
          <div class="flex gap-1 mb-2">
            ${tabs.map((tab) =>
              html`
                <button type="button"
                  class="btn btn-xs flex-1 font-normal ${tab === active ? "btn-primary" : "btn-ghost"}"
                  @click=${() => this._tab = tab}>${t(TAB_KEY[tab])}</button>
              `
            )}
          </div>
        `
        : nothing}
      ${active === "custom" ? this._renderCustomRange() : this._renderUnitGrid(active)}
    `;
  }

  /**
   * Навігатор і сітка. Крок навігатора — одиниця САМОЇ сітки: місяцями й
   * кварталами гортають РОКИ, роками — блоки по 12; інакше «попередній» у
   * сітці років означав би те саме, що клацнути сусідню комірку.
   */
  private _renderUnitGrid(unit: PeriodPickUnit): TemplateResult {
    const step = unit === "year" ? 12 : 1;
    const title = unit === "year"
      ? `${this._yearBlock} — ${this._yearBlock + 11}`
      : String(this._year);

    return html`
      <div class="flex items-center gap-1 mb-2">
        <button type="button" class="btn btn-xs btn-ghost btn-square"
          title=${t("period.earlier")}
          @click=${() => this._navYear = this._year - step}>‹</button>
        <span class="flex-1 text-center text-sm font-semibold">${title}</span>
        <button type="button" class="btn btn-xs btn-ghost btn-square"
          title=${t("period.later")}
          @click=${() => this._navYear = this._year + step}>›</button>
      </div>
      <div class="grid ${unit === "quarter" ? "grid-cols-2" : "grid-cols-3"} gap-1">
        ${this._cells(unit).map((cell) => {
          const p = periodOf(unit, cell.iso);
          const on = p.dateFrom === this.dateFrom && p.dateTo === this.dateTo;
          return html`
            <button type="button"
              class="btn btn-xs font-normal whitespace-nowrap ${on ? "btn-primary" : "btn-ghost"}"
              @click=${() => this._pickUnitValue(cell.iso, unit)}>${cell.label}</button>
          `;
        })}
      </div>
    `;
  }

  /** Комірки сітки: 12 місяців, 4 квартали або 12 років. */
  private _cells(unit: PeriodPickUnit): Array<{ iso: string; label: string }> {
    const pad = (n: number) => String(n).padStart(2, "0");

    if (unit === "month") {
      return monthNames().map((label, i) => ({ iso: `${this._year}-${pad(i + 1)}-01`, label }));
    }
    if (unit === "quarter") {
      return QUARTER_ROMAN.map((roman, i) => ({
        iso: `${this._year}-${pad(i * 3 + 1)}-01`,
        label: t("period.quarterShort", { q: roman }),
      }));
    }
    const first = this._yearBlock;
    return Array.from({ length: 12 }, (_, i) => ({
      iso: `${first + i}-01-01`,
      label: String(first + i),
    }));
  }

  // ── Рендер ────────────────────────────────────────────────────────────────

  override render(): TemplateResult {
    if (!this.visible) return html``;

    const btn = this.size ? `btn-${this.size}` : "";
    const group = html`
      <div class="join">
        <button type="button" class="btn btn-square join-item ${btn}"
          title=${t("period.prev")}
          ?disabled=${this.disabled}
          @click=${() => this._shift(-1)}>‹</button>
        <button type="button"
          class="btn join-item ${btn} flex-1 min-w-36 whitespace-nowrap font-normal"
          ?disabled=${this.disabled}
          @click=${this._toggle}>
          ${periodLabel(this._period, this.format) ||
            html`<span class="text-muted">${t("period.label")}</span>`}
        </button>
        <button type="button" class="btn btn-square join-item ${btn}"
          title=${t("period.next")}
          ?disabled=${this.disabled}
          @click=${() => this._shift(1)}>›</button>
      </div>
    `;

    const style = this.width ? `width:${this.width}` : "";

    return html`
      ${this.labelPosition === "left"
        ? html`
          <div class="flex items-center gap-2" style=${style}>
            ${this.label
              ? html`<span class="label text-sm whitespace-nowrap">${this.label}</span>`
              : nothing}
            ${group}
          </div>
        `
        : html`
          <div class="flex flex-col gap-1" style=${style}>
            ${this.label
              ? html`<span class="label text-sm leading-none">${this.label}</span>`
              : nothing}
            ${group}
          </div>
        `}
      ${this._renderPopover()}
    `;
  }
}
