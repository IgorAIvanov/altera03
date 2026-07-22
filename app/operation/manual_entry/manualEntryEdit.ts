import { html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Decimal } from "decimal.js";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
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

function dec(raw: unknown): Decimal {
  try {
    return new Decimal(String(raw ?? "").replace(",", ".") || 0);
  } catch {
    return new Decimal(0);
  }
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

  constructor() {
    super(ManualEntryEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
    else this.applyDefaultOrg();
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
    if (!await this.loadInto("get", { id: this.modelId })) return;
    this.$root.item.entries ??= [];
    this.$root.item = { ...this.$root.item, entries: this.normalizedEntries() };
    for (const line of this.$root.item.entries) {
      this.ensureSlots(line.debitAccount);
      this.ensureSlots(line.creditAccount);
    }
  }

  protected override async saveItem(): Promise<boolean> {
    this.$root.item = { ...this.$root.item, entries: this.normalizedEntries() };
    const ok = await super.saveItem();
    this.$root.item = { ...this.$root.item, entries: this.normalizedEntries() };
    return ok;
  }

  private async post() {
    await this.loadInto("post", { id: this.$root.item.id });
    this.$root.item = { ...this.$root.item, entries: this.normalizedEntries() };
  }

  private async unpost() {
    await this.loadInto("unpost", { id: this.$root.item.id });
    this.$root.item = { ...this.$root.item, entries: this.normalizedEntries() };
  }

  /** Суми в канонічному вигляді: SQL віддає numeric числом, форма тримає рядок. */
  private normalizedEntries(): ManualEntryForm["entries"] {
    return (this.$root.item.entries ?? []).map((l) => ({
      ...l,
      amount: dec(l.amount).toFixed(MONEY_PRECISION),
      currencyAmount: dec(l.currencyAmount).toFixed(MONEY_PRECISION),
      quantity: dec(l.quantity).toFixed(QTY_PRECISION),
      debitAnalytics: l.debitAnalytics ?? {},
      creditAnalytics: l.creditAnalytics ?? {},
    }));
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
    const entries = this.$root.item.entries.map((l, i) => (i === index ? { ...l, ...patch } : l));
    this.$root.item = { ...this.$root.item, entries };
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

  private addLine() {
    this.$root.item = {
      ...this.$root.item,
      entries: [...this.$root.item.entries, {
        id: null,
        lineNo: this.$root.item.entries.length + 1,
        debitAccount: "",
        debitAnalytics: {},
        creditAccount: "",
        creditAnalytics: {},
        amount: new Decimal(0).toFixed(MONEY_PRECISION),
        currencyId: "",
        currency: null,
        currencyAmount: new Decimal(0).toFixed(MONEY_PRECISION),
        quantity: new Decimal(0).toFixed(QTY_PRECISION),
        description: "",
      }],
    };
  }

  private removeLine(index: number) {
    const entries = this.$root.item.entries
      .filter((_, i) => i !== index)
      .map((l, i) => ({ ...l, lineNo: i + 1 }));
    this.$root.item = { ...this.$root.item, entries };
  }

  private get total(): string {
    return this.$root.item.entries
      .reduce((s, l) => s.plus(dec(l.amount)), new Decimal(0))
      .toFixed(MONEY_PRECISION);
  }

  /** Комірка рахунку: пікер плану рахунків (групи в нього не потрапляють). */
  private renderAccount(line: ManualEntryFormLine, index: number, side: Side): TemplateResult {
    const code = side === "debit" ? line.debitAccount : line.creditAccount;
    return html`
      <ui-picker
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
   * Комірки валюти + суми у валюті. Порожні, якщо рахунки рядка валюту не
   * ведуть: колонка показана заради інших рядків, але цей її не потребує.
   */
  private renderCurrencyCells(line: ManualEntryFormLine, index: number): TemplateResult {
    if (!this.lineNeeds(line, "currency")) {
      return html`<td class="cell-text text-base-content/20 text-center">—</td><td></td>`;
    }
    return html`
      <td>
        <ui-picker
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
      </td>
      <td>
        <ui-decimal
          cell
          .precision=${MONEY_PRECISION}
          .value=${line.currencyAmount}
          @value-input=${(e: DecimalEvent) => this.setLine(index, { currencyAmount: e.detail.value })}
          @value-changed=${(e: DecimalEvent) => this.setLine(index, { currencyAmount: e.detail.value })}
        ></ui-decimal>
      </td>
    `;
  }

  private renderQuantityCell(line: ManualEntryFormLine, index: number): TemplateResult {
    if (!this.lineNeeds(line, "quantity")) {
      return html`<td class="cell-text text-base-content/20 text-center">—</td>`;
    }
    return html`
      <td>
        <ui-decimal
          cell
          .precision=${QTY_PRECISION}
          .value=${line.quantity}
          @value-input=${(e: DecimalEvent) => this.setLine(index, { quantity: e.detail.value })}
          @value-changed=${(e: DecimalEvent) => this.setLine(index, { quantity: e.detail.value })}
        ></ui-decimal>
      </td>
    `;
  }

  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
    `;

    const item = this.$root.item;

    return html`
      <div class="p-4 max-w-5xl flex flex-col gap-2">
        ${this.renderNotice()}

        <div class="flex gap-2">
          ${this.renderField(
            t("invoice.number"),
            html`<input class="input input-bordered w-full" placeholder=${t("document.numberAuto")}
              .value=${item.number ?? ""}
              @input=${(e: Event) => this.setField("number", (e.target as HTMLInputElement).value)} />`,
            { class: "w-40", field: "number" },
          )}
          <ui-date
            .label=${t("invoice.date")}
            ?required=${this.isRequired("docDate")}
            .value=${item.docDate ?? ""}
            format=${dateFormat.dateTime}
            @value-changed=${(e: DateEvent) => this.setField("docDate", e.detail.value)}
          ></ui-date>
          <ui-picker
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

        <div class="flex items-center justify-between mt-2 mb-1">
          <span class="font-semibold">${t("manualEntry.entries")}</span>
          <button class="btn btn-sm" @click=${this.addLine}>+ ${t("invoice.addLine")}</button>
        </div>

        <table class="table table-sm w-full table-tabular">
          <thead>
            <tr>
              <th class="w-10">#</th>
              <th class="w-24">${t("manualEntry.debit")}</th>
              <th>${t("manualEntry.debitAnalytics")}</th>
              <th class="w-24">${t("manualEntry.credit")}</th>
              <th>${t("manualEntry.creditAnalytics")}</th>
              <th class="w-32 text-right">${t("invoice.amount")}</th>
              ${this.showCurrency ? html`
                <th class="w-20">${t("manualEntry.currency")}</th>
                <th class="w-28 text-right">${t("manualEntry.currencyAmount")}</th>` : ""}
              ${this.showQuantity ? html`<th class="w-28 text-right">${t("manualEntry.quantity")}</th>` : ""}
              <th class="w-10"></th>
            </tr>
          </thead>
          <tbody>
            ${item.entries.map((line, i) => html`
              <tr>
                <td class="cell-text">${line.lineNo}</td>
                <td>${this.renderAccount(line, i, "debit")}</td>
                <td>${this.renderAnalytics(line, i, "debit")}</td>
                <td>${this.renderAccount(line, i, "credit")}</td>
                <td>${this.renderAnalytics(line, i, "credit")}</td>
                <td>
                  <ui-decimal
                    cell
                    .precision=${MONEY_PRECISION}
                    .value=${line.amount}
                    @value-input=${(e: DecimalEvent) => this.setLine(i, { amount: e.detail.value })}
                    @value-changed=${(e: DecimalEvent) => this.setLine(i, { amount: e.detail.value })}
                  ></ui-decimal>
                </td>
                ${this.showCurrency ? this.renderCurrencyCells(line, i) : ""}
                ${this.showQuantity ? this.renderQuantityCell(line, i) : ""}
                <td class="text-center">
                  <button class="btn btn-ghost btn-xs text-error" title=${t("common.delete")}
                    @click=${() => this.removeLine(i)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                  </button>
                </td>
              </tr>
            `)}
            ${item.entries.length === 0
              ? html`<tr><td colspan="7" class="text-center text-base-content/40 py-4">${t("common.noData")}</td></tr>`
              : ""}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="5" class="text-right">${t("invoice.total")}</th>
              <th class="text-right tabular-nums">${this.total}</th>
              ${this.showCurrency ? html`<th></th><th></th>` : ""}
              ${this.showQuantity ? html`<th></th>` : ""}
              <th></th>
            </tr>
          </tfoot>
        </table>

        ${this.renderFormActions(html`
          ${item.isPosted
            ? html`
              <button class="btn btn-outline" ?disabled=${this.busy} @click=${this.unpost}>
                ${this.running === "unpost" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
                ${t("document.unpost")}
              </button>`
            : html`
              <button class="btn btn-secondary" ?disabled=${this.busy || !item.id} @click=${this.post}>
                ${this.running === "post" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
                ${t("document.post")}
              </button>`}
        `)}
      </div>
    `;
  }
}
