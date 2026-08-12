import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t } from "@client/locale.ts";
import { BaseUI, type FormSection } from "@client/ui-kit/base/base-ui.ts";
import { dec, TabularSection } from "@client/ui-kit/tabular/tabular-section.ts";
import {
  InvoiceEditRootSchema,
  type InvoiceEditRoot,
  type InvoiceForm,
} from "./invoice.schema.ts";
import { dateFormat } from "@client/shared/datetime.ts";
import { currentOrg } from "@shared/current-organization.ts";
import "@client/ui-kit/components/ui-picker.ts";
import type { PickerChangeEvent } from "@client/ui-kit/components/ui-picker.ts";
import "@client/ui-kit/components/ui-date.ts";
import "@client/ui-kit/components/ui-attachments.ts";
import "@client/ui-kit/tabular/ui-tabular-table.ts";
import "@client/ui-kit/tabular/ui-tabular-toolbar.ts";
import { icons } from "@client/ui-kit/icons.ts";
import { movementsButton } from "@shared/document-movements.ts";

export const tagName = "invoice-edit";

/** Точність десяткових полів табличної частини. */
const QTY_PRECISION = 3;
const MONEY_PRECISION = 2;

type InvoiceLine = InvoiceForm["lines"][number];

/** `data.extra` відповіді TS-команди printPdf. */
interface PrintPdfExtra {
  fileName?: string;
  mimeType?: string;
  pdfBase64?: string;
}

type DateEvent = CustomEvent<{ value: string }>;

@customElement(tagName)
export class InvoiceEdit extends BaseUI<InvoiceEditRoot> {
  protected model = "invoice";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  /**
   * Таблична частина: логіка (рядки, підсумки, клавіатура) — у примітиві,
   * форма лише описує колонки. Подання — <ui-tabular-table> і
   * <ui-tabular-toolbar> у render().
   */
  private lines = new TabularSection<InvoiceLine>(this, {
    rows: () => this.$root.item.lines,
    setRows: (lines) => { this.$root.item = { ...this.$root.item, lines }; },
    // Режим перегляду секція бере у форми: каскад fieldset[disabled] у shadow
    // root таблиці не проходить, а права — сигнал, тож читаємо на кожен рендер.
    readonly: () => this.readonlyMode,
    createLine: () => ({
      id: null,
      lineNo: 0,
      bankId: "",
      bank: null,
      qty: "0.000",
      price: "0.00",
    }),
    columns: [
      {
        kind: "picker", key: "bankId", refKey: "bank", title: "invoice.bank",
        url: "catalog/bank", required: true,
      },
      {
        kind: "decimal", key: "qty", title: "invoice.qty",
        precision: QTY_PRECISION, width: "7rem",
        // Не `required`: нуль — заповнене значення, порожнім його не назвеш.
        // Умова «більше за нуль» — саме той випадок, для якого є `check`.
        check: (v) => dec(v).gt(0) ? null : t("invoice.qtyPositive"),
      },
      { kind: "decimal", key: "price", title: "invoice.price", precision: MONEY_PRECISION, width: "7rem" },
      {
        kind: "computed", title: "invoice.amount", width: "7rem", total: true,
        precision: MONEY_PRECISION,
        value: (l) => dec(l.qty).mul(dec(l.price)).toFixed(MONEY_PRECISION),
      },
    ],
  });

  constructor() {
    // $root ← Value.Create(InvoiceEditRootSchema) = { item: <порожня форма>, options: {} }
    super(InvoiceEditRootSchema);
  }

  /** Рядки перевіряються разом із полями шапки — правила в конфізі колонок. */
  protected override sections(): FormSection[] {
    return [this.lines];
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
    else this.applyDefaultOrg();
  }

  /** Новий документ — підставляємо поточну організацію застосунку. */
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
    // get повертає data = { item, options }; item === null → notFound
    if (!await this.loadInto("get", { id: this.modelId })) return;
    this.$root.item.lines ??= [];
    // SQL віддає numeric → JSON number; у формі десяткові поля живуть як рядки
    this.$root.item = { ...this.$root.item, lines: this.normalizedLines() };
    // Нормалізація міняє $root ПІСЛЯ знімка loadInto — перезнімаємо, інакше
    // щойно відкрита форма виглядала б зміненою.
    this.markClean();
  }

  /**
   * Перед записом нормалізуємо десяткові поля (раптом рядок не втратив фокус),
   * після — повертаємо їх у рядковий вигляд форми: SQL віддає numeric числами.
   */
  protected override async saveItem(): Promise<boolean> {
    this.$root.item = { ...this.$root.item, lines: this.normalizedLines() };
    const ok = await super.saveItem();
    this.$root.item = { ...this.$root.item, lines: this.normalizedLines() };
    if (ok) this.markClean();
    return ok;
  }

  /** Проведений документ форма показує, але не дає правити — тільки розпровести. */
  protected override get locked(): boolean {
    return this.$root.item.isPosted === true;
  }

  /**
   * Проведення. Команда повертає оновлений item (уже з isPosted і денормалізо-
   * ваною шапкою), тому форму не перечитуємо окремим get.
   *
   * `"save"` — щоб журнал у сусідній вкладці перемалював значок стану.
   */
  private async post() {
    await this.loadInto("post", { id: this.$root.item.id }, "save");
    this.$root.item = { ...this.$root.item, lines: this.normalizedLines() };
    this.markClean();
  }

  private async unpost() {
    await this.loadInto("unpost", { id: this.$root.item.id }, "save");
    this.$root.item = { ...this.$root.item, lines: this.normalizedLines() };
    this.markClean();
  }

  /** Усі рядки з qty/price у канонічному вигляді — рахує примітив за колонками. */
  private normalizedLines(): InvoiceForm["lines"] {
    return this.lines.normalizedRows();
  }

  private setField<K extends keyof InvoiceForm>(field: K, value: InvoiceForm[K]) {
    this.$root.item = { ...this.$root.item, [field]: value };
  }

  /**
   * Друк: бекенд повертає PDF у base64 (`data.extra`), відкриваємо його в
   * новій вкладці. Вікно відкриваємо ДО await — інакше браузер вважає це
   * не-користувацькою дією і блокує попап.
   */
  private async printPdf() {
    const id = this.$root.item.id;
    if (!id) {
      this.messages = [{ type: "error", text: t("invoice.saveBeforePrint") }];
      return;
    }

    const preview = globalThis.open("", "_blank");

    const env = await this.run<{ extra?: PrintPdfExtra }>("printPdf", { id });
    const pdfBase64 = env.data?.extra?.pdfBase64;
    if (!env.ok || !pdfBase64) {
      preview?.close();
      return;
    }

    const binary = atob(pdfBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: env.data?.extra?.mimeType ?? "application/pdf" }));

    if (preview) {
      preview.location.href = url;
    } else {
      globalThis.open(url, "_blank");
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** Дії над самим документом — ліворуч, за стандартними кнопками запису. */
  protected override renderActions() {
    const item = this.$root.item;
    if (item.isPosted) {
      return this.may("unpost")
        ? html`
          <button class="btn btn-sm btn-outline" ?disabled=${this.busy} @click=${this.unpost}>
            ${this.running === "unpost"
              ? html`<span class="loading loading-spinner loading-xs"></span>`
              : icons.unpost}
            ${t("document.unpost")}
          </button>`
        : "";
    }
    return this.may("post")
      ? html`
        <button class="btn btn-sm btn-secondary" ?disabled=${this.busy || !item.id} @click=${this.post}>
          ${this.running === "post"
            ? html`<span class="loading loading-spinner loading-xs"></span>`
            : icons.post}
          ${t("document.post")}
        </button>`
      : "";
  }

  /**
   * Друк і рух документа — за роздільником: обидві дії нічого не змінюють у
   * записі, а видають назовні те, що з нього вийшло.
   */
  protected override renderAuxActions() {
    const item = this.$root.item;
    return html`
      <button class="btn btn-sm btn-outline" ?disabled=${this.busy || !item.id}
        @click=${this.printPdf}>
        ${this.running === "printPdf"
          ? html`<span class="loading loading-spinner loading-xs"></span>`
          : icons.print}
        ${t("common.print")}
      </button>
      ${movementsButton(item.id, item.isPosted, "btn-outline")}
    `;
  }

  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
    `;

    const item = this.$root.item;

    return this.renderForm(html`
          <!-- Шапка -->
          <div class="mb-4">
            <!-- номер + дата — в одній рамці -->
            <fieldset class="border border-base-700 rounded-lg px-4 pb-3 mb-4 bg-base-100">
              <legend class="px-2 text-sm text-muted">${t("invoice.titleOne")}</legend>
              <div class="grid grid-cols-2 gap-4">
                ${this.renderField(
                  t("invoice.number"),
                  // Порожній номер підставить app.doc_next_number при записі.
                  html`<input class="input input-bordered w-full" placeholder=${t("document.numberAuto")}
                    .value=${item.number ?? ""}
                    @input=${(e: Event) => this.setField("number", (e.target as HTMLInputElement).value)} />`,
                  { field: "number" },
                )}
                <ui-date
                  ?disabled=${this.readonlyMode}
                  .label=${t("invoice.date")}
                  ?required=${this.isRequired("docDate")}
                  .value=${item.docDate ?? ""}
                  format=${dateFormat.dateTime}
                  @value-changed=${(e: DateEvent) => this.setField("docDate", e.detail.value)}
                ></ui-date>
              </div>
            </fieldset>

            <ui-picker
              ?disabled=${this.readonlyMode}
              .label=${t("document.organization")}
              ?required=${this.isRequired("organizationId")}
              url="catalog/organization"
              .value=${item.organization ?? null}
              @value-changed=${(e: PickerChangeEvent) => this.setRef("organization", e.detail.value)}
            ></ui-picker>

            <ui-picker
              ?disabled=${this.readonlyMode}
              .label=${t("invoice.counterparty")}
              ?required=${this.isRequired("counterpartyId")}
              url="catalog/counterparty"
              show-clear
              .value=${item.counterparty ?? null}
              @value-changed=${(e: PickerChangeEvent) => this.setRef("counterparty", e.detail.value)}
            ></ui-picker>
          </div>

          <!-- Табличная часть: логіка й розмітка — у примітиві (колонки оголошені
               в конструкторі секції). Тулбар — окремий компонент, можна замінити
               своїм або прибрати. -->
          <div class="flex items-center justify-between mb-2">
            <span class="font-semibold">${t("invoice.lines")}</span>
            <ui-tabular-toolbar .section=${this.lines}></ui-tabular-toolbar>
          </div>
          <ui-tabular-table .section=${this.lines}></ui-tabular-table>

          <!-- Вкладення документа: скани, рахунки, листування.
               Прив'язуються до вже збереженого документа, тому до першого
               save компонент показує підказку замість кнопки. -->
          <div class="mt-4">
            <ui-attachments
              ?disabled=${this.readonlyMode}
              owner-model="invoice"
              .ownerId=${item.id ?? ""}
              .label=${t("invoice.attachments")}
            ></ui-attachments>
          </div>
    `);
  }
}
