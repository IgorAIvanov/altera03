import { css, html, nothing, type CSSResultGroup, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "../base/gsle.ts";
import { bus } from "../../bus/bus.ts";
import { getLocale, t } from "../../locale.ts";
import { formatDate } from "../../shared/datetime.ts";
import { icons } from "../icons.ts";
import { type RelatedNode, type RelatedSummary, treePrefixes } from "../related-tree.ts";
import "./ui-dialog.ts";

interface Envelope {
  ok?: boolean;
  data?: { item?: RelatedSummary | null; rows?: RelatedNode[] };
  messages?: Array<string | { type?: string; text?: string }>;
}

/**
 * Кнопка командної панелі «Пов'язані документи» і вікно з деревом.
 *
 * ЩО ПОКАЗУЄ. Дерево навколо документа: на кого він посилається, хто на нього,
 * і далі ланцюжком — від коренів униз, як «Структура підпорядкованості» в 1С.
 * Дерево будує ядро (команда `related` кожного документа, `app.document_related`);
 * ребра — усі `x-ref` документа на документ. Компонент лише малює і відкриває.
 *
 * ЧОМУ МАРШРУТ ДАЄ ЗАСТОСУНОК. Вузол приходить із кодом типу (ключем моделі), а
 * маршрут форми виводиться з view-manifest, який генерується з манифестів
 * ЗАСТОСУНКУ — фреймворк його не бачить і бачити не може (залежність іде в один
 * бік). Тому `routeOf` — властивість: без неї дерево показується, але вузли не
 * відкриваються. Та сама межа, що в `rowActions` підпорядкованого регістру.
 *
 * ЧОМУ ВІКНО, А НЕ ВКЛАДКА. Дерево — довідка до відкритого документа: глянути,
 * перейти, повернутися. Вкладка лишалася б після переходу й множилася б на
 * кожен документ; вікно закривається само, щойно вибрано вузол.
 *
 * ```ts
 * import "@client/ui-kit/components/ui-related-documents.ts";
 *
 * protected override renderAuxActions() {
 *   return html`
 *     <ui-related-documents model="invoice" .documentId=${this.$root.item.id ?? ""}
 *       .routeOf=${(code: string) => viewRoute(code)}></ui-related-documents>`;
 * }
 * ```
 */
@customElement("ui-related-documents")
export class UiRelatedDocuments extends GlobalStyledLitElement {
  /** Модель документа, чию команду `related` кликати (право — `view` на неї). */
  @property({ type: String }) model = "";
  @property({ type: String, attribute: "document-id" }) documentId = "";
  @property({ type: Boolean }) disabled = false;
  /** Маршрут форми за кодом типу документа; `null` — вузол не відкривається. */
  @property({ attribute: false }) routeOf: (typeCode: string) => string | null = () => null;

  @state() private _open = false;
  @state() private _loading = false;
  @state() private _error = "";
  @state() private _rows: RelatedNode[] = [];
  @state() private _summary: RelatedSummary | null = null;

  static override styles: CSSResultGroup = [
    ...(GlobalStyledLitElement.styles as CSSResultGroup[]),
    css`
      :host { display: inline-block; }
      /* Подання документа довге за побудовою («Розрахунок коригування
         №ДПРК-000001 від 26.03.2026, ТОВ …»), і в типовому вікні дата з сумою
         виїжджали за край — по кожну суму доводилося гортати вбік. Тому вікно
         вдвічі ширше за типове, а подання ПЕРЕНОСИТЬСЯ: дата й сума мусять
         бути видні завжди, на будь-якій ширині екрана. */
      ui-dialog { --ui-dialog-width: min(92vw, 64rem); }
      table { width: 100%; }
      td.doc { width: 100%; }
      td.date, td.total { white-space: nowrap; vertical-align: top; }
      /* Гілка — окремою колонкою рядка, а не текстом перед назвою: перенесена
         назва стає під назвою, а не під псевдографікою, і дерево читається. */
      .line { display: flex; align-items: flex-start; }
      /* Псевдографіка тримається лише на моноширинному шрифті: у
         пропорційному «│» і пробіли різної ширини, і гілки роз'їжджаються. */
      .branch { flex: none; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre; }
      .node { display: flex; align-items: flex-start; gap: .375rem; min-width: 0; }
      .node > .status { display: inline-flex; flex: none; padding-top: 1px; }
      .node .label { overflow-wrap: anywhere; }
      .node .open { text-align: left; }
    `,
  ];

  #numberFormat?: Intl.NumberFormat;
  #numberLocale = "";

  #formatTotal(value: RelatedNode["total"]): string {
    if (value === null || value === undefined) return "";
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) return String(value);
    const locale = getLocale();
    if (!this.#numberFormat || this.#numberLocale !== locale) {
      this.#numberFormat = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      this.#numberLocale = locale;
    }
    return this.#numberFormat.format(num);
  }

  async #load() {
    this._loading = true;
    this._error = "";
    try {
      const env = await bus.request("data.load", {
        model: this.model,
        command: "related",
        payload: { id: this.documentId },
      }) as Envelope | undefined;
      if (!env?.ok) {
        const message = env?.messages?.[0];
        this._error = (typeof message === "string" ? message : message?.text) ||
          t("common.requestFailed", { status: "" }).trim();
        this._rows = [];
        this._summary = null;
        return;
      }
      this._rows = env.data?.rows ?? [];
      this._summary = env.data?.item ?? null;
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    } finally {
      this._loading = false;
    }
  }

  #show = () => {
    if (!this.documentId) return;
    this._open = true;
    // Перечитуємо щоразу: між двома відкриттями документ могли пов'язати з
    // іншим, і вчорашнє дерево тут було б неправдою.
    void this.#load();
  };

  #close = () => {
    this._open = false;
  };

  #go(node: RelatedNode, route: string) {
    this._open = false;
    bus.emit({ type: "tab.open", route, id: node.id });
  }

  #status(node: RelatedNode): TemplateResult {
    const [glyph, label] = node.isDeleted
      ? [icons.recordDeleted, t("common.statusDeleted")]
      : node.isPosted
      ? [icons.recordPosted, t("common.statusPosted")]
      : [icons.recordNew, t("common.statusNew")];
    return html`<span class="status" title=${label} aria-label=${label} role="img">${glyph}</span>`;
  }

  #label(node: RelatedNode): string {
    return node.presentation?.trim() || [node.typeName, node.number].filter(Boolean).join(" ");
  }

  #node(node: RelatedNode, prefix: string): TemplateResult {
    // Недоступний вузол: вид документа і більше нічого — ні номера, ні суми,
    // ні переходу. Сервер їх і не віддав.
    if (!node.isAvailable) {
      return html`<div class="line"><span class="branch">${prefix}</span><span class="node text-muted">
        <span class="label">${node.typeName} — ${t("core.related.noAccess")}</span></span></div>`;
    }

    const route = node.id && !node.isCurrent && !node.isRepeat ? this.routeOf(node.typeCode) : null;
    const label = this.#label(node);
    // Позначки «поточний» і «показано вище» — усередині того ж блоку, що й
    // назва: переносяться разом із нею, а не окремим стовпчиком праворуч.
    const marks = html`${node.isCurrent ? html` <span class="text-muted">(${t("core.related.current")})</span>` : ""}${
      node.isRepeat ? html` <span class="text-muted">↺ ${t("core.related.repeat")}</span>` : ""
    }`;
    return html`
      <div class="line"><span class="branch">${prefix}</span><span class="node">
        ${this.#status(node)}
        <span class="label">${route
          ? html`<button type="button" class="open link link-hover" @click=${() => this.#go(node, route)}>${label}</button>`
          : html`<span class=${node.isCurrent ? "font-semibold" : ""}
              aria-current=${node.isCurrent ? "true" : nothing}>${label}</span>`}${marks}</span>
      </span></div>
    `;
  }

  #body(): TemplateResult {
    if (this._loading) {
      return html`<div class="flex justify-center p-4"><span class="loading loading-spinner"></span></div>`;
    }
    if (this._error) {
      return html`<div role="alert" class="alert alert-error text-sm">${this._error}</div>`;
    }
    // Лише сам документ — пояснюємо словами, а не показуємо дерево з одного
    // рядка: воно читалося б як «щось не довантажилося».
    if (this._rows.length <= 1) {
      return html`<p class="text-muted p-2">${t("core.related.alone")}</p>`;
    }

    const prefixes = treePrefixes(this._rows);
    return html`
      <table class="table table-xs">
        <thead>
          <tr>
            <th>${t("core.related.document")}</th>
            <th>${t("core.related.date")}</th>
            <th class="text-right">${t("core.related.total")}</th>
          </tr>
        </thead>
        <tbody>
          ${this._rows.map((node, index) => html`
            <tr>
              <td class="doc">${this.#node(node, prefixes[index])}</td>
              <td class="date tabular-nums">${node.isAvailable ? formatDate(node.docDate) : ""}</td>
              <td class="total text-right tabular-nums">${node.isAvailable ? this.#formatTotal(node.total) : ""}</td>
            </tr>
          `)}
        </tbody>
      </table>
      ${this._summary?.truncated
        ? html`<p class="text-muted text-sm px-2 pt-2">
            ${t("core.related.truncated", { count: String(this._summary.nodes) })}</p>`
        : ""}
    `;
  }

  override render(): TemplateResult {
    const title = t("core.related.title");
    const hint = this.documentId ? title : t("core.related.saveFirst");
    return html`
      <button type="button" class="btn btn-sm btn-square btn-outline"
        ?disabled=${this.disabled || !this.documentId || !this.model}
        title=${hint} aria-label=${title}
        @click=${this.#show}>
        ${icons.related}
      </button>
      <ui-dialog .open=${this._open} heading=${title} @ui-dialog-close=${this.#close}>
        ${this._open ? this.#body() : ""}
      </ui-dialog>
    `;
  }
}
