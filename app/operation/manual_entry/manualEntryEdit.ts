import { html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import { dec, TabularSection } from "@client/ui-kit/tabular/tabular-section.ts";
import { dateFormat } from "@client/shared/datetime.ts";
import { viewFamily } from "@shared/view-route.ts";
import { currentOrg } from "@shared/current-organization.ts";
import {
  ManualEntryEditRootSchema,
  type AccountAnalytic,
  type ManualEntryEditRoot,
  type ManualEntryForm,
  type ManualEntryFormLine,
} from "./manual_entry.schema.ts";
import "@client/ui-kit/components/ui-picker.ts";
import "@client/ui-kit/components/ui-decimal.ts";
import "@client/ui-kit/components/ui-date.ts";
import "@client/ui-kit/tabular/ui-tabular-table.ts";
import "@client/ui-kit/tabular/ui-tabular-toolbar.ts";

export const tagName = "manual-entry-edit";

const MONEY_PRECISION = 2;
const QTY_PRECISION = 3;

type PickEvent = CustomEvent<{ id: string; label: string }>;
type DecimalEvent = CustomEvent<{ value: string }>;
type DateEvent = CustomEvent<{ value: string }>;
type Side = "debit" | "credit";

/** Конфігурація рахунку для рядка проводки (rows + ознаки з extra). */
interface AccountConfig {
  analytics: AccountAnalytic[];
  isCurrency: boolean;
  isQuantitative: boolean;
}

/**
 * Куди веде пікер субконто. Родину моделі беремо з view-manifest, а не
 * вгадуємо як `catalog/<model>`: вимір може вказувати на модель з іншої
 * родини (ручна операція живе в `operation/`).
 */
function viewPath(modelKey: string): string {
  return `${viewFamily(modelKey) ?? "catalog"}/${modelKey}`;
}

@customElement(tagName)
export class ManualEntryEdit extends BaseUI<ManualEntryEditRoot> {
  protected model = "manual_entry";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  /**
   * Конфігурація рахунку за кодом: субконто + ознаки валютного/кількісного
   * обліку. Набір полів у рядку проводки залежить від рахунку, тому тягнемо це
   * з chart_of_account/analytics і кешуємо — у документі той самий рахунок
   * зустрічається в багатьох рядках.
   */
  @state() private slots = new Map<string, AccountConfig>();

  /**
   * Форма не показується, доки конфігурація рахунків усіх рядків не
   * завантажена: інакше субконто й валютні колонки «доїжджали» через мить
   * після появи форми — видима двоетапна відрисовка.
   */
  @state() private slotsReady = false;

  /**
   * Таблична частина: каркас (номер, дії над рядками, підсумок, клавіатура) —
   * у примітиві. Рахунки й субконто — custom-комірки: набір пікерів у них
   * залежить від рахунку рядка, готовим видом це не описується. Валютні
   * колонки умовні (visible) — показуються, коли хоч один рядок їх потребує.
   */
  private entries = new TabularSection<ManualEntryFormLine>(this, {
    rows: () => this.$root.item.entries,
    setRows: (entries) => { this.$root.item = { ...this.$root.item, entries }; },
    // Режим перегляду секція бере у форми: каскад fieldset[disabled] у shadow
    // root таблиці не проходить, а права — сигнал, тож читаємо на кожен рендер.
    readonly: () => this.readonlyMode,
    createLine: () => ({
      id: null,
      lineNo: 0,
      debitAccount: "",
      debitAnalytics: {},
      creditAccount: "",
      creditAnalytics: {},
      amount: "0.00",
      currencyId: "",
      currency: null,
      currencyAmount: "0.00",
      quantity: "0.000",
      description: "",
    }),
    // Декум-канон покриває лише decimal-колонки; custom-комірки (валюта,
    // кількість) канонізуються тут — разом із `analytics ?? {}`.
    normalizeLine: (l) => ({
      ...l,
      currencyAmount: dec(l.currencyAmount).toFixed(MONEY_PRECISION),
      quantity: dec(l.quantity).toFixed(QTY_PRECISION),
      debitAnalytics: l.debitAnalytics ?? {},
      creditAnalytics: l.creditAnalytics ?? {},
    }),
    // Багаторядковий запис (стиль 1С): рахунок — у сітці, субконто —
    // другим рядом ПІД своїм рахунком (row: 2, span: 1). Підрядок без
    // title, тому окремого ряду заголовків для нього немає.
    columns: [
      { kind: "custom", title: "manualEntry.debit", render: (l, i) => this.renderAccount(l, i, "debit") },
      { kind: "custom", title: "manualEntry.credit", render: (l, i) => this.renderAccount(l, i, "credit") },
      { kind: "decimal", key: "amount", title: "invoice.amount", precision: MONEY_PRECISION, width: "8rem", total: true },
      {
        kind: "custom", title: "manualEntry.currency", width: "5rem",
        visible: () => this.showCurrency,
        render: (l, i) => this.renderCurrencyPicker(l, i),
      },
      {
        kind: "custom", title: "manualEntry.currencyAmount", width: "7rem", align: "right",
        visible: () => this.showCurrency,
        render: (l, i) => this.renderCurrencyAmount(l, i),
      },
      {
        kind: "custom", title: "manualEntry.quantity", width: "7rem", align: "right",
        visible: () => this.showQuantity,
        render: (l, i) => this.renderQuantity(l, i),
      },
      { kind: "custom", row: 2, span: 1, render: (l, i) => this.renderAnalytics(l, i, "debit") },
      { kind: "custom", row: 2, span: 1, render: (l, i) => this.renderAnalytics(l, i, "credit") },
    ],
  });

  constructor() {
    super(ManualEntryEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) {
      this.load();
    } else {
      this.applyDefaultOrg();
      this.slotsReady = true;
    }
  }

  /** Нова операція — підставляємо поточну організацію застосунку. */
  private applyDefaultOrg() {
    const org = currentOrg();
    if (!org || this.$root.item.organizationId) return;
    this.$root.item = {
      ...this.$root.item,
      organizationId: org.id,
      organization: { id: org.id, name: org.name },
    };
  }

  private async load() {
    if (!await this.loadInto("get", { id: this.modelId })) {
      this.slotsReady = true;
      return;
    }
    this.$root.item.entries ??= [];
    this.$root.item = { ...this.$root.item, entries: this.normalizedEntries() };
    // Конфігурації всіх рахунків — паралельно і ДО показу форми (slotsReady).
    const accounts = new Set<string>();
    for (const line of this.$root.item.entries) {
      if (line.debitAccount) accounts.add(line.debitAccount);
      if (line.creditAccount) accounts.add(line.creditAccount);
    }
    await Promise.all([...accounts].map((a) => this.ensureSlots(a)));
    this.slotsReady = true;
    // Нормалізація міняє $root ПІСЛЯ знімка loadInto — перезнімаємо, інакше
    // щойно відкрита форма виглядала б зміненою.
    this.markClean();
  }

  protected override async saveItem(): Promise<boolean> {
    this.$root.item = { ...this.$root.item, entries: this.normalizedEntries() };
    const ok = await super.saveItem();
    this.$root.item = { ...this.$root.item, entries: this.normalizedEntries() };
    if (ok) this.markClean();
    return ok;
  }

  private async post() {
    await this.loadInto("post", { id: this.$root.item.id });
    this.$root.item = { ...this.$root.item, entries: this.normalizedEntries() };
    this.markClean();
  }

  private async unpost() {
    await this.loadInto("unpost", { id: this.$root.item.id });
    this.$root.item = { ...this.$root.item, entries: this.normalizedEntries() };
    this.markClean();
  }

  /** Суми в канонічному вигляді — рахує примітив (колонки + normalizeLine). */
  private normalizedEntries(): ManualEntryForm["entries"] {
    return this.entries.normalizedRows();
  }

  /** Підвантажити конфігурацію рахунку (субконто + ознаки) — один раз на код. */
  private async ensureSlots(account: string | undefined) {
    if (!account || this.slots.has(account)) return;
    // Кладемо заглушку одразу — інакше паралельні рядки з тим самим рахунком
    // пошлють по запиту кожен.
    const empty: AccountConfig = { analytics: [], isCurrency: false, isQuantitative: false };
    this.slots.set(account, empty);
    const env = await bus.request("data.load", {
      model: "chart_of_account",
      command: "analytics",
      payload: { code: account },
    }) as { data?: { rows?: AccountAnalytic[]; extra?: { isCurrency?: boolean; isQuantitative?: boolean } } } | undefined;
    this.slots = new Map(this.slots).set(account, {
      analytics: env?.data?.rows ?? [],
      isCurrency: env?.data?.extra?.isCurrency ?? false,
      isQuantitative: env?.data?.extra?.isQuantitative ?? false,
    });
    // Комірки субконто й умовні валютні колонки читають slots — стан форми,
    // не $root: таблиця сама про його зміну не дізнається.
    this.entries.refresh();
  }

  /** Чи веде рахунок рядка (будь-який бік) валютний / кількісний облік. */
  private lineNeeds(line: ManualEntryFormLine, kind: "currency" | "quantity"): boolean {
    const key = kind === "currency" ? "isCurrency" : "isQuantitative";
    const d = this.slots.get(line.debitAccount ?? "")?.[key] ?? false;
    const c = this.slots.get(line.creditAccount ?? "")?.[key] ?? false;
    return d || c;
  }

  /** Хоч один рядок потребує колонки валюти / кількості — тоді показуємо її. */
  private get showCurrency(): boolean {
    return this.$root.item.entries.some((l) => this.lineNeeds(l, "currency"));
  }
  private get showQuantity(): boolean {
    return this.$root.item.entries.some((l) => this.lineNeeds(l, "quantity"));
  }

  private setField<K extends keyof ManualEntryForm>(field: K, value: ManualEntryForm[K]) {
    this.$root.item = { ...this.$root.item, [field]: value };
  }

  private setLine(index: number, patch: Partial<ManualEntryFormLine>) {
    this.entries.patch(index, patch);
  }

  /**
   * Зміна рахунку скидає субконто цієї сторони: набір вимірів у нового рахунку
   * інший, і лишати старі значення означало б відправити на проведення
   * субконто, якого рахунок не веде.
   */
  private setAccount(index: number, side: Side, code: string) {
    this.ensureSlots(code);
    this.setLine(index, side === "debit"
      ? { debitAccount: code, debitAnalytics: {} }
      : { creditAccount: code, creditAnalytics: {} });
  }

  private setAnalytic(index: number, side: Side, dimension: string, value: { id: string; name: string } | null) {
    const line = this.$root.item.entries[index];
    const current = { ...(side === "debit" ? line.debitAnalytics : line.creditAnalytics) };
    if (value) current[dimension] = value;
    else delete current[dimension];
    this.setLine(index, side === "debit" ? { debitAnalytics: current } : { creditAnalytics: current });
  }

  /** Комірка рахунку: пікер плану рахунків (групи в нього не потрапляють). */
  private renderAccount(line: ManualEntryFormLine, index: number, side: Side): TemplateResult {
    const code = side === "debit" ? line.debitAccount : line.creditAccount;
    return html`
      <ui-picker
        ?disabled=${this.readonlyMode}
        cell
        url="catalog/chart_of_account"
        fetch="lookup"
        display-field="code"
        hint-field="name"
        .displayValue=${code ?? ""}
        .selectedId=${code ?? ""}
        @item-selected=${(e: PickEvent) => this.setAccount(index, side, e.detail.label)}
        @item-cleared=${() => this.setAccount(index, side, "")}
      ></ui-picker>
    `;
  }

  /**
   * Комірка субконто: по одному пікеру на кожен слот, який веде рахунок.
   * Порожньо, поки рахунок не обрано або він не веде аналітики.
   */
  private renderAnalytics(line: ManualEntryFormLine, index: number, side: Side): TemplateResult {
    const code = side === "debit" ? line.debitAccount : line.creditAccount;
    const values = (side === "debit" ? line.debitAnalytics : line.creditAnalytics) ?? {};
    const slots = this.slots.get(code ?? "")?.analytics ?? [];
    if (!slots.length) return html`<span class="text-base-content/30 text-xs px-1">—</span>`;

    return html`
      <div class="flex flex-col">
        ${slots.map((slot) => html`
          <ui-picker
            ?disabled=${this.readonlyMode}
            cell
            title=${slot.dimensionName}
            url=${viewPath(slot.modelKey)}
            fetch="lookup"
            placeholder=${slot.dimensionName}
            .displayValue=${values[slot.dimensionCode]?.name ?? ""}
            .selectedId=${values[slot.dimensionCode]?.id ?? ""}
            show-clear
            @item-selected=${(e: PickEvent) =>
              this.setAnalytic(index, side, slot.dimensionCode, { id: e.detail.id, name: e.detail.label })}
            @item-cleared=${() => this.setAnalytic(index, side, slot.dimensionCode, null)}
          ></ui-picker>
        `)}
      </div>
    `;
  }

  /**
   * Комірки валюти й суми у валюті — порожні (тире), якщо рахунки рядка валюту
   * не ведуть: колонка показана заради інших рядків, але цей її не потребує.
   * Custom-комірки примітива повертають вміст `<td>`, не сам `<td>`.
   */
  private renderCurrencyPicker(line: ManualEntryFormLine, index: number): TemplateResult {
    if (!this.lineNeeds(line, "currency")) {
      return html`<span class="text-base-content/20 px-2">—</span>`;
    }
    return html`
      <ui-picker
        ?disabled=${this.readonlyMode}
        cell
        url="catalog/currency"
        fetch="lookup"
        display-field="code"
        hint-field="name"
        .displayValue=${line.currency?.name ?? ""}
        .selectedId=${line.currencyId ?? ""}
        @item-selected=${(e: PickEvent) =>
          this.setLine(index, { currencyId: e.detail.id, currency: { id: e.detail.id, name: e.detail.label } })}
        @item-cleared=${() => this.setLine(index, { currencyId: "", currency: null })}
      ></ui-picker>
    `;
  }

  private renderCurrencyAmount(line: ManualEntryFormLine, index: number): TemplateResult {
    if (!this.lineNeeds(line, "currency")) return html``;
    return html`
      <ui-decimal
        ?disabled=${this.readonlyMode}
        cell
        .precision=${MONEY_PRECISION}
        .value=${line.currencyAmount}
        @value-input=${(e: DecimalEvent) => this.setLine(index, { currencyAmount: e.detail.value })}
        @value-changed=${(e: DecimalEvent) => this.setLine(index, { currencyAmount: e.detail.value })}
      ></ui-decimal>
    `;
  }

  private renderQuantity(line: ManualEntryFormLine, index: number): TemplateResult {
    if (!this.lineNeeds(line, "quantity")) {
      return html`<span class="text-base-content/20 px-2">—</span>`;
    }
    return html`
      <ui-decimal
        ?disabled=${this.readonlyMode}
        cell
        .precision=${QTY_PRECISION}
        .value=${line.quantity}
        @value-input=${(e: DecimalEvent) => this.setLine(index, { quantity: e.detail.value })}
        @value-changed=${(e: DecimalEvent) => this.setLine(index, { quantity: e.detail.value })}
      ></ui-decimal>
    `;
  }

  override render() {
    if (this.running === "get" || !this.slotsReady) return html`
      <div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
    `;

    const item = this.$root.item;

    return html`
      <div class="p-4 max-w-5xl flex flex-col gap-2">
        ${this.renderNotice()}
        ${this.renderFields(html`
          <div class="flex gap-2">
            ${this.renderField(
              t("invoice.number"),
              html`<input class="input input-bordered w-full" placeholder=${t("document.numberAuto")}
                .value=${item.number ?? ""}
                @input=${(e: Event) => this.setField("number", (e.target as HTMLInputElement).value)} />`,
              { class: "w-40", field: "number" },
            )}
            <ui-date
              ?disabled=${this.readonlyMode}
              .label=${t("invoice.date")}
              ?required=${this.isRequired("docDate")}
              .value=${item.docDate ?? ""}
              format=${dateFormat.dateTime}
              @value-changed=${(e: DateEvent) => this.setField("docDate", e.detail.value)}
            ></ui-date>
            <ui-picker
              ?disabled=${this.readonlyMode}
              .label=${t("document.organization")}
              ?required=${this.isRequired("organizationId")}
              url="catalog/organization"
              fetch="lookup"
              .displayValue=${item.organization?.name ?? ""}
              .selectedId=${item.organizationId ?? ""}
              @item-selected=${(e: PickEvent) => {
                this.setField("organizationId", e.detail.id);
                this.$root.item = { ...this.$root.item, organization: { id: e.detail.id, name: e.detail.label } };
              }}
            ></ui-picker>
          </div>

          ${this.renderField(
            t("manualEntry.description"),
            html`<input class="input input-bordered w-full" .value=${item.description ?? ""}
              @input=${(e: Event) => this.setField("description", (e.target as HTMLInputElement).value)} />`,
          )}

          ${item.isPosted
            ? html`<div class="badge badge-success badge-sm self-start">${t("document.posted")}</div>`
            : ""}

          <!-- Табличная часть: каркас — у примітиві (колонки оголошені в
               конструкторі секції), рахунки/субконто — custom-комірки вище. -->
          <div class="flex items-center justify-between mt-2 mb-1">
            <span class="font-semibold">${t("manualEntry.entries")}</span>
            <ui-tabular-toolbar .section=${this.entries}></ui-tabular-toolbar>
          </div>
          <ui-tabular-table .section=${this.entries}></ui-tabular-table>
        `)}

        ${this.renderFormActions(html`
          ${item.isPosted
            ? this.may("unpost")
              ? html`
                <button class="btn btn-outline" ?disabled=${this.busy} @click=${this.unpost}>
                  ${this.running === "unpost" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
                  ${t("document.unpost")}
                </button>`
              : ""
            : this.may("post")
            ? html`
              <button class="btn btn-secondary" ?disabled=${this.busy || !item.id} @click=${this.post}>
                ${this.running === "post" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
                ${t("document.post")}
              </button>`
            : ""}
        `)}
      </div>
    `;
  }
}
