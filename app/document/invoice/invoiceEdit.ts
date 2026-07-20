import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Decimal } from "decimal.js";
import { t } from "@client/locale.ts";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import {
  InvoiceEditRootSchema,
  type InvoiceEditRoot,
  type InvoiceForm,
} from "./invoice.schema.ts";
import "@client/ui-kit/components/ui-picker.ts";
import "@client/ui-kit/components/ui-decimal.ts";

export const tagName = "invoice-edit";

/** Точність десяткових полів табличної частини. */
const QTY_PRECISION = 3;
const MONEY_PRECISION = 2;

type PickEvent = CustomEvent<{ id: string; label: string }>;
type DecimalEvent = CustomEvent<{ value: string }>;

/** Безпечний парсинг рядка з форми у Decimal (порожнє / сміття → 0). */
function dec(raw: unknown): Decimal {
  try {
    return new Decimal(String(raw ?? "").replace(",", ".") || 0);
  } catch {
    return new Decimal(0);
  }
}

@customElement(tagName)
export class InvoiceEdit extends BaseUI<InvoiceEditRoot> {
  protected model = "invoice";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    // $root ← Value.Create(InvoiceEditRootSchema) = { item: <порожня форма>, options: {} }
    super(InvoiceEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    // get повертає data = { item, options }; item === null → notFound
    if (!await this.loadInto("get", { id: this.modelId })) return;
    this.$root.item.lines ??= [];
    // SQL віддає numeric → JSON number; у формі десяткові поля живуть як рядки
    this.$root.item = { ...this.$root.item, lines: this.normalizedLines() };
  }

  private async save() {
    // страховка: нормалізуємо десяткові поля ще раз (раптом рядок не втратив фокус)
    const item = { ...this.$root.item, lines: this.normalizedLines() };
    this.$root.item = item;
    await this.run("save", { item }, "save");
  }

  /** Усі рядки з qty/price у канонічному вигляді. */
  private normalizedLines(): InvoiceForm["lines"] {
    return this.$root.item.lines.map((l) => ({
      ...l,
      qty: dec(l.qty).toFixed(QTY_PRECISION),
      price: dec(l.price).toFixed(MONEY_PRECISION),
    }));
  }

  private setField<K extends keyof InvoiceForm>(field: K, value: InvoiceForm[K]) {
    this.$root.item = { ...this.$root.item, [field]: value };
  }

  private setLine(index: number, patch: Partial<InvoiceForm["lines"][number]>) {
    const lines = this.$root.item.lines.map((l, i) => (i === index ? { ...l, ...patch } : l));
    this.$root.item = { ...this.$root.item, lines };
  }

  private addLine() {
    const lineNo = this.$root.item.lines.length + 1;
    this.$root.item = {
      ...this.$root.item,
      lines: [...this.$root.item.lines, {
        id: null,
        lineNo,
        bankId: "",
        bank: null,
        qty: new Decimal(0).toFixed(QTY_PRECISION),
        price: new Decimal(0).toFixed(MONEY_PRECISION),
      }],
    };
  }

  private removeLine(index: number) {
    const lines = this.$root.item.lines
      .filter((_, i) => i !== index)
      .map((l, i) => ({ ...l, lineNo: i + 1 }));
    this.$root.item = { ...this.$root.item, lines };
  }

  /** Сума рядка = кількість × ціна (точна десяткова арифметика). */
  private lineAmount(line: InvoiceForm["lines"][number]): string {
    return dec(line.qty).mul(dec(line.price)).toFixed(MONEY_PRECISION);
  }

  private get total(): string {
    return this.$root.item.lines
      .reduce((s, l) => s.plus(dec(l.qty).mul(dec(l.price))), new Decimal(0))
      .toFixed(MONEY_PRECISION);
  }

  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
    `;

    const item = this.$root.item;

    return html`
      <div class="p-4 max-w-3xl">
        ${this.renderNotice()}
        <!-- Шапка -->
        <div class="grid grid-cols-3 gap-4 mb-4">
          <div class="form-control">
            <label class="label"><span class="label-text">${t("invoice.number")}</span></label>
            <input class="input input-bordered" .value=${item.number}
              @input=${(e: Event) => this.setField("number", (e.target as HTMLInputElement).value)} />
          </div>
          <div class="form-control">
            <label class="label"><span class="label-text">${t("invoice.date")}</span></label>
            <input type="date" class="input input-bordered" .value=${item.invoiceDate ?? ""}
              @input=${(e: Event) => this.setField("invoiceDate", (e.target as HTMLInputElement).value)} />
          </div>
          <ui-picker
            .label=${t("invoice.counterparty")}
            url="catalog/counterparty"
            fetch="lookup"
            .displayValue=${item.counterparty?.name ?? ""}
            .selectedId=${item.counterpartyId ?? ""}
            show-clear
            @item-selected=${(e: PickEvent) => {
              this.setField("counterpartyId", e.detail.id);
              this.$root.item = { ...this.$root.item, counterparty: { id: e.detail.id, name: e.detail.label } };
            }}
            @item-cleared=${() => {
              this.setField("counterpartyId", "");
              this.$root.item = { ...this.$root.item, counterparty: null };
            }}
          ></ui-picker>
        </div>

        <!-- Табличная часть -->
        <div class="flex items-center justify-between mb-2">
          <span class="font-semibold">${t("invoice.lines")}</span>
          <button class="btn btn-sm" @click=${this.addLine}>+ ${t("invoice.addLine")}</button>
        </div>

        <!-- table-tabular: контракт табличної частини (client/styles/tailwind.css).
             Комірки з контролами — без класу (падінг 0), текстові — cell-text. -->
        <table class="table table-sm w-full table-tabular">
          <thead>
            <tr>
              <th class="w-10">#</th>
              <th>${t("invoice.bank")}</th>
              <th class="w-28 text-right">${t("invoice.qty")}</th>
              <th class="w-28 text-right">${t("invoice.price")}</th>
              <th class="w-28 text-right">${t("invoice.amount")}</th>
              <th class="w-10"></th>
            </tr>
          </thead>
          <tbody>
            ${item.lines.map((line, i) => html`
              <tr>
                <td class="cell-text">${line.lineNo}</td>
                <td>
                  <ui-picker
                    cell
                    url="catalog/bank"
                    fetch="lookup"
                    .displayValue=${line.bank?.name ?? ""}
                    .selectedId=${line.bankId ?? ""}
                    @item-selected=${(e: PickEvent) =>
                      this.setLine(i, { bankId: e.detail.id, bank: { id: e.detail.id, name: e.detail.label } })}
                    @item-cleared=${() => this.setLine(i, { bankId: "", bank: null })}
                  ></ui-picker>
                </td>
                <td>
                  <ui-decimal
                    cell
                    .precision=${QTY_PRECISION}
                    .value=${line.qty}
                    @value-input=${(e: DecimalEvent) => this.setLine(i, { qty: e.detail.value })}
                    @value-changed=${(e: DecimalEvent) => this.setLine(i, { qty: e.detail.value })}
                  ></ui-decimal>
                </td>
                <td>
                  <ui-decimal
                    cell
                    .precision=${MONEY_PRECISION}
                    .value=${line.price}
                    @value-input=${(e: DecimalEvent) => this.setLine(i, { price: e.detail.value })}
                    @value-changed=${(e: DecimalEvent) => this.setLine(i, { price: e.detail.value })}
                  ></ui-decimal>
                </td>
                <td class="cell-text text-right tabular-nums">
                  ${this.lineAmount(line)}
                </td>
                <td class="text-center">
                  <button class="btn btn-ghost btn-xs text-error" title=${t("common.delete")}
                    @click=${() => this.removeLine(i)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                  </button>
                </td>
              </tr>
            `)}
            ${item.lines.length === 0
              ? html`<tr><td colspan="6" class="text-center text-base-content/40 py-4">${t("common.noData")}</td></tr>`
              : ""}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="4" class="text-right">${t("invoice.total")}</th>
              <th class="text-right tabular-nums">${this.total}</th>
              <th></th>
            </tr>
          </tfoot>
        </table>

        <div class="flex gap-2 mt-6">
          <button class="btn btn-primary" ?disabled=${!this.canSave} @click=${this.save}>
            ${this.running === "save" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
            ${t("common.save")}
          </button>
        </div>
      </div>
    `;
  }
}
