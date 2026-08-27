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
  /** Відповідь демо-пікера дерева (события picker.select / picker.cancel). */
  @state() private treePickResult = "";
  /** Множинний вибір у демо-пікері дерева. */
  @state() private treePickMultiple = false;

  #unsubTreePick: (() => void)[] = [];
  /** Що віддало поле періоду — по одному рядку на кожен із трьох варіантів. */
  @state() private periodResult: Record<string, string> = {};
  /** Значення полів: без них вибір не видно — кнопка лишалася б із підписом «Період». */
  @state() private monthValue = "";
  @state() private anyUnit: { dateFrom: string; dateTo: string } = { dateFrom: "", dateTo: "" };
  @state() private plain: { dateFrom: string; dateTo: string } = { dateFrom: "", dateTo: "" };

  override connectedCallback() {
    super.connectedCallback();
    // Демо дерева елементів вантажаться ліниво: за ModelTreeListBase їде вся
    // механіка списків (model-list-base разом із деревом груп і xlsx), і
    // статичний імпорт поклав би її в головний бандл кожного входу. Елементи
    // в розмітці нижче «оживають», щойно модулі зареєструють їх.
    void import("./home-tree-demo.ts");
    void import("./home-tree-picker-demo.ts");

    // Інлайн-демо пікера шле ті самі события, що модалка, — слухаємо їх тут,
    // щоб показати відповідь діалогу.
    this.#unsubTreePick = [
      bus.on("picker.select", (msg) => {
        if (msg.callbackId !== "home-tree-picker-demo") return;
        const values = msg.values ?? (msg.value ? [msg.value] : []);
        this.treePickResult = values.map((v) => `${v?.label} (id=${v?.id})`).join(", ");
      }),
      bus.on("picker.cancel", (msg) => {
        if (msg.callbackId !== "home-tree-picker-demo") return;
        this.treePickResult = "скасовано";
      }),
    ];
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    for (const unsub of this.#unsubTreePick) unsub();
    this.#unsubTreePick = [];
  }

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

        <div class="card bg-base-200 border border-base-300 p-4 w-full max-w-2xl">
          <h4 class="text-sm font-semibold mb-3 text-muted">
            Тест дерева елементів — ModelTreeListBase (демо-дані, без сервера)
          </h4>
          <div class="h-96 border border-base-300 bg-base-100 overflow-hidden">
            <home-tree-demo></home-tree-demo>
          </div>
          <div class="mt-2 text-xs text-muted">
            Трикутник або ←/→ згортає й розгортає вузол; пошук перемикає в
            плоский список із пагінацією, очищення повертає дерево; сортування
            впорядковує братів і сестер усередині вузла.
          </div>
        </div>

        <div class="card bg-base-200 border border-base-300 p-4 w-full max-w-2xl">
          <h4 class="text-sm font-semibold mb-3 text-muted">
            Тест дерева в діалозі підбору — ModelTreePickerBase (демо-дані, без модалки)
          </h4>
          <div class="h-96 border border-base-300 bg-base-100 overflow-hidden">
            <home-tree-picker-demo
              .callbackId=${"home-tree-picker-demo"}
              .multiple=${this.treePickMultiple}>
            </home-tree-picker-demo>
          </div>
          <div class="mt-2 flex items-center gap-4">
            <label class="flex items-center gap-2 text-xs">
              <input type="checkbox" class="checkbox checkbox-xs"
                .checked=${this.treePickMultiple}
                @change=${(e: Event) => {
                  this.treePickMultiple = (e.target as HTMLInputElement).checked;
                }} />
              <span>множинний вибір (pickMany)</span>
            </label>
            ${this.treePickResult ? html`
              <div class="text-xs text-success">${this.treePickResult}</div>
            ` : ""}
          </div>
          <div class="mt-1 text-xs text-muted">
            Подвійний клік або Enter вибирає вузол (у множинному — позначає);
            «До поточного» показує, як пікер розгортає шлях до вже вибраного
            значення поля.
          </div>
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
