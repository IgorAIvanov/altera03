import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { tw } from "@client/shared/styles.ts";
import "@client/ui-kit/components/ui-picker.ts";

export const tagName = "invoice-edit";

type RefObj = { id: string; name: string } | null;

interface LineForm {
  id: string | null;
  lineNo: number;
  bankId: string;
  bank?: RefObj;
  qty: number;
  price: number;
}

interface InvoiceForm {
  id: string | null;
  number: string;
  invoiceDate: string;
  counterpartyId: string;
  counterparty?: RefObj;
  lines: LineForm[];
}

type PickEvent = CustomEvent<{ id: string; label: string }>;

const emptyForm = (): InvoiceForm => ({
  id: null,
  number: "",
  invoiceDate: "",
  counterpartyId: "",
  counterparty: null,
  lines: [],
});

@customElement(tagName)
export class InvoiceEdit extends SignalWatcher(LitElement) {
  static styles = [tw];

  @property({ type: String }) modelId: string | null = null;

  @state() private item: InvoiceForm = emptyForm();
  @state() private loading = false;
  @state() private saving = false;

  connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  async load() {
    this.loading = true;
    try {
      const data = await bus.request("data.load", {
        model: "invoice",
        command: "get",
        payload: { id: this.modelId },
      }) as { data?: { item?: InvoiceForm } };
      this.item = data?.data?.item ?? emptyForm();
      this.item.lines ??= [];
    } finally {
      this.loading = false;
    }
  }

  async save() {
    this.saving = true;
    try {
      await bus.request("data.save", {
        model: "invoice",
        command: "save",
        payload: { item: this.item },
      });
    } finally {
      this.saving = false;
    }
  }

  private setField<K extends keyof InvoiceForm>(field: K, value: InvoiceForm[K]) {
    this.item = { ...this.item, [field]: value };
  }

  private setLine(index: number, patch: Partial<LineForm>) {
    const lines = this.item.lines.map((l, i) => (i === index ? { ...l, ...patch } : l));
    this.item = { ...this.item, lines };
  }

  private addLine() {
    const lineNo = this.item.lines.length + 1;
    this.item = {
      ...this.item,
      lines: [...this.item.lines, { id: null, lineNo, bankId: "", bank: null, qty: 0, price: 0 }],
    };
  }

  private removeLine(index: number) {
    const lines = this.item.lines
      .filter((_, i) => i !== index)
      .map((l, i) => ({ ...l, lineNo: i + 1 }));
    this.item = { ...this.item, lines };
  }

  private get total(): number {
    return this.item.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  }

  render() {
    if (this.loading) return html`
      <div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
    `;

    return html`
      <div class="p-4 max-w-3xl">
        <!-- Шапка -->
        <div class="grid grid-cols-3 gap-4 mb-4">
          <div class="form-control">
            <label class="label"><span class="label-text">${t("invoice.number")}</span></label>
            <input class="input input-bordered" .value=${this.item.number}
              @input=${(e: Event) => this.setField("number", (e.target as HTMLInputElement).value)} />
          </div>
          <div class="form-control">
            <label class="label"><span class="label-text">${t("invoice.date")}</span></label>
            <input type="date" class="input input-bordered" .value=${this.item.invoiceDate ?? ""}
              @input=${(e: Event) => this.setField("invoiceDate", (e.target as HTMLInputElement).value)} />
          </div>
          <ui-picker
            .label=${t("invoice.counterparty")}
            url="/api/model/counterparty"
            .displayValue=${this.item.counterparty?.name ?? ""}
            .selectedId=${this.item.counterpartyId ?? ""}
            show-clear
            @item-selected=${(e: PickEvent) => {
              this.setField("counterpartyId", e.detail.id);
              this.item = { ...this.item, counterparty: { id: e.detail.id, name: e.detail.label } };
            }}
            @item-cleared=${() => {
              this.setField("counterpartyId", "");
              this.item = { ...this.item, counterparty: null };
            }}
          ></ui-picker>
        </div>

        <!-- Табличная часть -->
        <div class="flex items-center justify-between mb-2">
          <span class="font-semibold">${t("invoice.lines")}</span>
          <button class="btn btn-sm" @click=${this.addLine}>+ ${t("invoice.addLine")}</button>
        </div>

        <table class="table table-sm w-full">
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
            ${this.item.lines.map((line, i) => html`
              <tr>
                <td>${line.lineNo}</td>
                <td>
                  <ui-picker
                    url="/api/model/bank"
                    .displayValue=${line.bank?.name ?? ""}
                    .selectedId=${line.bankId ?? ""}
                    @item-selected=${(e: PickEvent) =>
                      this.setLine(i, { bankId: e.detail.id, bank: { id: e.detail.id, name: e.detail.label } })}
                    @item-cleared=${() => this.setLine(i, { bankId: "", bank: null })}
                  ></ui-picker>
                </td>
                <td>
                  <input type="number" class="input input-bordered input-sm w-full text-right"
                    .value=${String(line.qty)}
                    @input=${(e: Event) => this.setLine(i, { qty: Number((e.target as HTMLInputElement).value) })} />
                </td>
                <td>
                  <input type="number" class="input input-bordered input-sm w-full text-right"
                    .value=${String(line.price)}
                    @input=${(e: Event) => this.setLine(i, { price: Number((e.target as HTMLInputElement).value) })} />
                </td>
                <td class="text-right tabular-nums">
                  ${((Number(line.qty) || 0) * (Number(line.price) || 0)).toFixed(2)}
                </td>
                <td class="text-center">
                  <button class="btn btn-ghost btn-xs text-error" title=${t("common.delete")}
                    @click=${() => this.removeLine(i)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                  </button>
                </td>
              </tr>
            `)}
            ${this.item.lines.length === 0
              ? html`<tr><td colspan="6" class="text-center text-base-content/40 py-4">${t("common.noData")}</td></tr>`
              : ""}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="4" class="text-right">${t("invoice.total")}</th>
              <th class="text-right tabular-nums">${this.total.toFixed(2)}</th>
              <th></th>
            </tr>
          </tfoot>
        </table>

        <div class="flex gap-2 mt-6">
          <button class="btn btn-primary" ?disabled=${this.saving} @click=${this.save}>
            ${this.saving ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
            ${t("common.save")}
          </button>
        </div>
      </div>
    `;
  }
}
