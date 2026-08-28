import { css, html, type CSSResultGroup, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "../base/gsle.ts";
import { t } from "../../locale.ts";
import { apiFetch } from "../../data/api.ts";
import { formatFileSize, isImageMime } from "../../shared/blob.ts";
import { icons } from "../icons.ts";
import { placePopover, POPOVER_ANCHORED_STYLE } from "../popover.ts";
import type { FileOpenDetail, ViewerFile } from "./ui-file-dock.ts";

/**
 * Кнопка командної панелі «переглянути вкладення».
 *
 * ЩО ВОНА ВИРІШУЄ. Вкладення й раніше було видно списком у формі — але ім'я
 * файлу там посилання на ЗАВАНТАЖЕННЯ, тобто подивитися скан можна було лише
 * вийшовши із застосунку в переглядач ОС і повернувшись назад. Для звірки
 * розпізнаного документа це найгірший із можливих шляхів: звіряють, дивлячись
 * на обидва одночасно.
 *
 * ОДИН ФАЙЛ — ВІДКРИВАЄМО ОДРАЗУ, КІЛЬКА — ПИТАЄМО. Меню з одного пункта це
 * зайвий клік на кожному документі, а вгадувати «потрібний» із трьох не можна:
 * до накладної прикріплюють і скан, і лист, і платіжку.
 *
 * ПЕРЕЛІК ЧИТАЄТЬСЯ НАПЕРЕД, а не по натисканню: кнопка мусить знати, чи є що
 * показувати, — інакше вона обіцяє дію, якої немає. Це той самий запит, що
 * робить `<ui-attachments>`, і він дешевий (метадані без байтів).
 *
 * ПОКАЗУЄ НЕ ВОНА. Вибраний файл їде подією `ui-file-open` до `<ui-file-dock>`,
 * у який форма загорнута; кнопка не знає ані про розкладку, ані про смугу
 * розділення. Тому вона й лишається кнопкою командної панелі, а не другим
 * місцем, де вирішують, як показувати документи.
 *
 * ```ts
 * import "@client/ui-kit/components/ui-attachment-button.ts";
 *
 * protected override renderAuxActions() {
 *   return html`
 *     <ui-attachment-button owner-model="invoice" .ownerId=${this.$root.item.id ?? ""}>
 *     </ui-attachment-button>`;
 * }
 * ```
 */
@customElement("ui-attachment-button")
export class UiAttachmentButton extends GlobalStyledLitElement {
  @property({ type: String, attribute: "owner-model" }) ownerModel = "";
  @property({ type: String, attribute: "owner-id" }) ownerId = "";
  /** Підпис кнопки. Без нього — «Перегляд». */
  @property({ type: String }) label = "";
  @property({ type: Boolean }) disabled = false;

  @state() private _files: ViewerFile[] = [];

  @query(".menu-popover") private _popover?: HTMLElement;
  @query("button") private _button?: HTMLButtonElement;

  static override styles: CSSResultGroup = [
    ...(GlobalStyledLitElement.styles as CSSResultGroup[]),
    css`
      :host { display: inline-block; }
      .menu-popover {
        min-width: 16rem;
        max-width: 28rem;
        max-height: 60vh;
        overflow-y: auto;
      }
      .file-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ];

  override connectedCallback() {
    super.connectedCallback();
    // Список міняє сусідній `<ui-attachments>` на тій самій формі. Подія
    // composed, тож доходить до документа; звужувати її до свого власника нема
    // за чим — у ній лише кількість, а зайве перечитування коштує одного
    // запиту метаданих.
    globalThis.document.addEventListener("attachments-changed", this.#onAttachmentsChanged);
  }

  override disconnectedCallback() {
    globalThis.document.removeEventListener("attachments-changed", this.#onAttachmentsChanged);
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("ownerId") || changed.has("ownerModel")) void this.reload();
  }

  #onAttachmentsChanged = () => void this.reload();

  /** Перечитати перелік. Публічний — форма може покликати після збереження. */
  async reload(): Promise<void> {
    if (!this.ownerId || !this.ownerModel) {
      this._files = [];
      return;
    }

    try {
      const response = await apiFetch("/api/model/attachment/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerModel: this.ownerModel, ownerId: this.ownerId }),
      });
      const envelope = await response.json();
      this._files = (envelope?.data?.rows ?? []) as ViewerFile[];
    } catch {
      // Мовчки: кнопка перегляду не та річ, заради якої варто ставити банер
      // на форму. Немає переліку — немає й кнопки.
      this._files = [];
    }

  }

  #show(file: ViewerFile) {
    // Тільки якщо меню справді відкрите: `hidePopover()` на схованому кидає
    // InvalidStateError, а сюди приходять обидва шляхи — і вибір із меню, і
    // єдине вкладення, яке відкривається без меню взагалі.
    if (this._popover?.matches(":popover-open")) this._popover.hidePopover();

    const shown = !this.dispatchEvent(
      new CustomEvent<FileOpenDetail>("ui-file-open", {
        detail: { file },
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );

    // Ніхто не взяв — отже форму не загорнули в `<ui-file-dock>`. Мовчати про
    // це не можна: клік нічого не робить, і виглядає це як зламана кнопка.
    if (!shown) {
      console.warn(
        "[ui-attachment-button] показати файл нема кому: загорни каркас форми в <ui-file-dock>",
      );
    }
  }

  #onClick() {
    if (this._files.length === 1) {
      this.#show(this._files[0]);
      return;
    }

    const popover = this._popover;
    const button = this._button;
    if (!popover || !button) return;

    // Розміщення — ПІСЛЯ показу: у схованого елемента немає розмірів, а без
    // них нема чого притискати до краю екрана (див. popover.ts).
    popover.showPopover();
    placePopover(popover, button);
  }

  override render(): TemplateResult {
    const count = this._files.length;

    return html`
      <button
        type="button"
        class="btn btn-sm btn-outline"
        ?disabled=${this.disabled || count === 0}
        title=${t("blob.view")}
        @click=${this.#onClick}
      >
        ${icons.attachment}
        ${this.label || t("blob.view")}
        ${count > 1 ? html`<span class="text-muted">(${count})</span>` : ""}
      </button>

      <ul
        popover
        class="menu rounded-box shadow-md p-1 menu-popover"
        style=${`${POPOVER_ANCHORED_STYLE} background-color: var(--color-base-100, #fff); border: 1px solid var(--app-border-field, #b8c3cc);`}
      >
        ${this._files.map((file) => html`
          <li>
            <button type="button" @click=${() => this.#show(file)}>
              ${isImageMime(file.mime) ? icons.camera : icons.attachment}
              <span class="file-name">${file.name}</span>
              <span class="text-muted tabular-nums">${formatFileSize(file.size)}</span>
            </button>
          </li>
        `)}
      </ul>
    `;
  }
}
