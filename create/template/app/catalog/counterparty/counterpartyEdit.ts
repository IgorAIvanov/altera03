import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import {
  CounterpartyEditRootSchema,
  type CounterpartyEditRoot,
} from "./counterparty.schema.ts";

export const tagName = "counterparty-edit";

/** `data.extra` відповіді команди ядра printPdf. */
interface PrintPdfExtra {
  fileName?: string;
  mimeType?: string;
  pdfBase64?: string;
}

/**
 * Форма демо-довідника.
 *
 * `$root` засівається зі схеми через `super(...)` — рукописного «порожнього
 * об'єкта» тут немає навмисно. Підпис поля малює лише `renderField`, а весь
 * каркас — `renderForm()`: командна панель угорі, банер, поля. Обидва знають
 * про обов'язковість і режим перегляду, тож писати їх руками не треба.
 */
@customElement(tagName)
export class CounterpartyEdit extends BaseUI<CounterpartyEditRoot> {
  protected model = "counterparty";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(CounterpartyEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  /**
   * Друк. Клієнт нічого не рендерить: `printPdf` — команда ядра, вона бере
   * шаблон із бази, дані — з `counterparty_print_data` і повертає готовий PDF.
   */
  private async printPdf() {
    const id = this.$root.item.id;
    if (!id) {
      this.messages = [{ type: "error", text: this.t("counterparty.saveBeforePrint") }];
      return;
    }

    // Вікно — ДО await: інакше браузер вважає popup не ініційованим користувачем
    // і блокує його.
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
    const url = URL.createObjectURL(
      new Blob([bytes], { type: env.data?.extra?.mimeType ?? "application/pdf" }),
    );

    if (preview) preview.location.href = url;
    else globalThis.open(url, "_blank");

    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** Обов'язковість — правилом форми, а не лише схемою: тут видно умову. */
  protected override fieldRules() {
    return {
      code: true,
      name: true,
      // ЄДРПОУ не обов'язковий, але якщо заповнений — рівно 8 або 10 цифр.
      // `check` повертає null, коли все гаразд, і текст помилки, коли ні.
      edrpou: {
        check: (value: unknown) => {
          const text = String(value ?? "").trim();
          if (!text) return null;
          return /^\d{8}$|^\d{10}$/.test(text) ? null : this.t("counterparty.edrpouInvalid");
        },
      },
    };
  }

  /**
   * Друк — за роздільником командної панелі: він нічого не змінює в записі, а
   * видає його назовні. Дії НАД записом (провести, скопіювати) йшли б у
   * `renderActions()`, ліворуч, одразу за кнопками запису.
   */
  protected override renderAuxActions() {
    return html`
      <button class="btn btn-sm btn-outline" ?disabled=${this.busy || !this.$root.item.id}
        @click=${this.printPdf}>
        ${this.running === "printPdf"
          ? html`<span class="loading loading-spinner loading-xs"></span>`
          : ""}
        ${this.t("counterparty.print")}
      </button>
    `;
  }

  override render() {
    if (this.running === "get") {
      return html`<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>`;
    }

    const item = this.$root.item;

    // Каркас малює база: командна панель угорі, банер, поля в `renderFields()`.
    // Своє тут — самі поля.
    return this.renderForm(html`
      <div class="flex flex-col gap-2">
          ${this.renderField(
            this.t("common.code"),
            html`<input class="input input-bordered w-full" .value=${item.code ?? ""}
              @input=${this.bindTo(item, "code")} />`,
            { field: "code" },
          )}

          ${this.renderField(
            this.t("common.name"),
            html`<input class="input input-bordered w-full" .value=${item.name ?? ""}
              @input=${this.bindTo(item, "name")} />`,
            { field: "name" },
          )}

          ${this.renderField(
            this.t("counterparty.edrpou"),
            html`<input class="input input-bordered w-full" .value=${item.edrpou ?? ""}
              @input=${this.bindTo(item, "edrpou")} />`,
            { field: "edrpou" },
          )}
      </div>
    `);
  }
}
