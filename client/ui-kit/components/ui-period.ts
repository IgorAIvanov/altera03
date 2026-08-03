import { GlobalStyledLitElement } from "../base/gsle.ts";
import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { t } from "../../locale.ts";
import { dateFormat } from "../../shared/datetime.ts";
import {
  type Period,
  periodLabel,
  periodOf,
  type PeriodUnit,
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
 * ту другу. Подія `period-changed` з `detail: { dateFrom, dateTo }` — на кожну
 * зміну.
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

  @state() private _open = false;

  @query("[popover]") private _popover?: HTMLElement;
  @query(".join") private _anchor?: HTMLElement;

  private get _period(): Period {
    return { dateFrom: this.dateFrom, dateTo: this.dateTo };
  }

  private _set(p: Period) {
    if (p.dateFrom === this.dateFrom && p.dateTo === this.dateTo) return;
    this.dateFrom = p.dateFrom;
    this.dateTo = p.dateTo;
    this.dispatchEvent(new CustomEvent("period-changed", {
      detail: { dateFrom: this.dateFrom, dateTo: this.dateTo },
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
  }

  /** Синхронізує popover із `_open` і тримає його під полем (як в ui-date). */
  protected override updated() {
    const pop = this._popover;
    if (!pop) return;
    const shown = pop.matches(":popover-open");
    if (this._open && !shown) {
      const rect = this._anchor?.getBoundingClientRect();
      if (rect) {
        pop.style.top = `${rect.bottom + 2}px`;
        pop.style.left = `${rect.left}px`;
      }
      pop.showPopover();
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
        style="position:fixed; margin:0; inset:unset; width:19rem; background:var(--color-base-100,#ffffff); border:1px solid var(--color-base-300,#d1d5db);"
      >
        ${this._open ? this._renderPopoverBody() : ""}
      </div>
    `;
  }

  private _renderPopoverBody(): TemplateResult {
    type DateEvent = CustomEvent<{ value: string }>;
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
        <div class="text-xs text-base-content/60 mb-1">${t("period.custom")}</div>
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
          <span class="text-base-content/40">—</span>
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
      </div>
    `;
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
            html`<span class="text-base-content/40">${t("period.label")}</span>`}
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
