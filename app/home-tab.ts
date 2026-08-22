import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { bus } from "@client/bus/bus.ts";
import { tw } from "@client/shared/styles.ts";
import "@client/ui-kit/components/ui-picker.ts";
import type { PickerChangeEvent } from "@client/ui-kit/components/ui-picker.ts";
import "@client/ui-kit/components/ui-select.ts";
import "@client/ui-kit/components/ui-period.ts";

/** Подія періоду: третє поле — одиниця, якій період дорівнює РІВНО. */
type PeriodEvent = CustomEvent<{ dateFrom: string; dateTo: string; unit: string | null }>;

const testSelectOptions = [
  { value: "draft", label: "Чернетка" },
  { value: "active", label: "Активний" },
  { value: "archived", label: "Архів" },
];

@customElement("home-tab")
export class HomeTab extends LitElement {
  static override styles = [css`:host { display: block; height: 100%; }`, tw];

  @state() private pickerResult = "";
  @state() private selectResult = "";
  /** Що віддало поле періоду — по одному рядку на кожен із трьох варіантів. */
  @state() private periodResult: Record<string, string> = {};
  /** Значення полів: без них вибір не видно — кнопка лишалася б із підписом «Період». */
  @state() private monthValue = "";
  @state() private anyUnit: { dateFrom: string; dateTo: string } = { dateFrom: "", dateTo: "" };
  @state() private plain: { dateFrom: string; dateTo: string } = { dateFrom: "", dateTo: "" };

  private open(route: string, id?: string) {
    bus.emit({ type: "tab.open", route, id: id ?? null });
  }

  private said(key: string, e: PeriodEvent) {
    const { dateFrom, dateTo, unit } = e.detail;
    this.periodResult = {
      ...this.periodResult,
      [key]: `${dateFrom || "—"} .. ${dateTo || "—"} · unit=${unit ?? "null"}`,
    };
  }

  override render() {
    return html`
      <div class="flex flex-col items-center justify-start h-full gap-6 overflow-auto py-6">
        <h3 class="text-lg font-semibold text-base-content">Тестові форми</h3>

        <div class="flex flex-wrap gap-3 justify-center">
          <button class="btn" @click=${() => this.open("catalog/bank/list")}>Банки (список)</button>
          <button class="btn" @click=${() => this.open("catalog/bank/edit")}>Банк (новий)</button>
          <button class="btn" @click=${() => this.open("catalog/bank/edit", "1")}>Банк edit id=1</button>
        </div>

        <div class="card bg-base-200 border border-base-300 p-4 w-80">
          <h4 class="text-sm font-semibold mb-3 text-muted">Тест ui-picker (bank)</h4>
          <ui-picker
            url="catalog/bank"
            label="Банк"
            placeholder="Введіть назву або МФО..."
            ?show-clear=${true}
            label-position="left"
            @value-changed=${(e: PickerChangeEvent) => {
              const v = e.detail.value;
              this.pickerResult = v ? `id=${v.id}, label=${v.name}` : "";
            }}
          ></ui-picker>
          ${this.pickerResult ? html`
            <div class="mt-2 text-xs text-success">${this.pickerResult}</div>
          ` : ""}
        </div>

        <div class="card bg-base-200 border border-base-300 p-4 w-80">
          <h4 class="text-sm font-semibold mb-3 text-muted">Тест ui-select</h4>
          <ui-select
            .value=${this.selectResult}
            .options=${testSelectOptions}
            placeholder="Оберіть стан..."
            label="Стан"
            label-position="left"
            @value-changed=${(e: CustomEvent<{ value: string }>) => {
              this.selectResult = e.detail.value;
            }}
          ></ui-select>
          ${this.selectResult ? html`
            <div class="mt-2 text-xs text-success">value=${this.selectResult}</div>
          ` : ""}
        </div>

        <div class="card bg-base-200 border border-base-300 p-4 w-80">
          <h4 class="text-sm font-semibold mb-3 text-muted">
            Тест ui-period — режим одиниці
          </h4>

          <!-- Одна одиниця: смуги вкладок немає взагалі, одразу сітка місяців.
               Так стоїть у трьох довідках закриття місяця. -->
          <div class="text-xs text-muted mb-1">units="month" (value — одна дата)</div>
          <ui-period
            units="month"
            label="Місяць"
            label-position="left"
            .value=${this.monthValue}
            @period-changed=${(e: PeriodEvent) => {
              this.monthValue = e.detail.dateFrom;
              this.said("month", e);
            }}
          ></ui-period>
          ${this.periodResult.month ? html`
            <div class="mt-1 text-xs text-success">${this.periodResult.month}</div>
          ` : ""}

          <!-- Кілька одиниць плюс довільний відрізок: смуга вкладок, навігатор
               років, сітка 12 / 4 / 12. -->
          <div class="text-xs text-muted mt-4 mb-1">units="month,quarter,year,custom"</div>
          <ui-period
            units="month,quarter,year,custom"
            label="Період"
            label-position="left"
            .dateFrom=${this.anyUnit.dateFrom}
            .dateTo=${this.anyUnit.dateTo}
            @period-changed=${(e: PeriodEvent) => {
              this.anyUnit = { dateFrom: e.detail.dateFrom, dateTo: e.detail.dateTo };
              this.said("any", e);
            }}
          ></ui-period>
          ${this.periodResult.any ? html`
            <div class="mt-1 text-xs text-success">${this.periodResult.any}</div>
          ` : ""}

          <!-- Без units — те, що було: вісім пресетів і пара ui-date. Стоїть
               поруч навмисно: видно, що старий вигляд не змінився. -->
          <div class="text-xs text-muted mt-4 mb-1">без units — пресети, як було</div>
          <ui-period
            label="Період"
            label-position="left"
            .dateFrom=${this.plain.dateFrom}
            .dateTo=${this.plain.dateTo}
            @period-changed=${(e: PeriodEvent) => {
              this.plain = { dateFrom: e.detail.dateFrom, dateTo: e.detail.dateTo };
              this.said("plain", e);
            }}
          ></ui-period>
          ${this.periodResult.plain ? html`
            <div class="mt-1 text-xs text-success">${this.periodResult.plain}</div>
          ` : ""}
        </div>
      </div>
    `;
  }
}
