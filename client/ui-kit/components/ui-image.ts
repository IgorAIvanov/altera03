import { html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "../base/gsle.ts";
import { t } from "../../locale.ts";
import { bindBlobOwner, blobUrl, formatFileSize, uploadBlob } from "../../shared/blob.ts";

/**
 * Зображення моделі (логотип, фото, скан) з попереднім переглядом.
 *
 * Значення — пара `value-id` / `value-token`: id вкладення живе в моделі й
 * зберігається разом із нею, токен приходить із сервера і потрібен лише щоб
 * показати картинку в поточній сесії.
 *
 * Компонент НЕ зберігає модель: він вантажить байти й повідомляє новий id
 * подією `value-changed` — форма кладе id у свій `$root.item` і пише його
 * звичайним `save`.
 *
 * ```html
 * <ui-image
 *   .label=${t("organization.logo")}
 *   .valueId=${item.logoId ?? ""}
 *   .valueToken=${item.logoToken ?? ""}
 *   owner-model="organization"
 *   .ownerId=${item.id ?? ""}
 *   @value-changed=${(e) => { item.logoId = e.detail.id; item.logoToken = e.detail.token; }}
 * ></ui-image>
 * ```
 */
@customElement("ui-image")
export class UiImage extends GlobalStyledLitElement {
  @property({ type: String }) label = "";
  @property({ type: Boolean }) required = false;
  @property({ type: Boolean }) disabled = false;

  /** id вкладення з моделі (`logoId`). Порожній рядок — зображення немає. */
  @property({ type: String, attribute: "value-id" }) valueId = "";
  /** Токен доступу з конверта моделі (`logoToken`). */
  @property({ type: String, attribute: "value-token" }) valueToken = "";

  /**
   * Власник вкладення. Якщо запис ще не збережений (`ownerId` порожній),
   * вкладення створюється «сиротою» — прив'яжеться при збереженні моделі.
   */
  @property({ type: String, attribute: "owner-model" }) ownerModel = "";
  @property({ type: String, attribute: "owner-id" }) ownerId = "";

  @property({ type: String }) accept = "image/*";
  /** Попередня перевірка розміру на клієнті; сервер перевіряє незалежно. */
  @property({ type: Number, attribute: "max-size-mb" }) maxSizeMb = 10;
  /** Сторона прев'ю, px. */
  @property({ type: Number }) size = 128;

  @state() private _busy = false;
  @state() private _error = "";

  /**
   * Вкладення, завантажене до того, як запис отримав id («сирота»).
   * Щойно `owner-id` з'явиться — прив'язуємо, інакше планове очищення
   * (app.attachment_gc) видалить файл, на який модель уже посилається.
   */
  private _orphanId: string | null = null;

  @query("input[type=file]") private _input?: HTMLInputElement;

  private get _hasValue() {
    return Boolean(this.valueId && this.valueToken);
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("ownerId") && this.ownerId && this.ownerModel && this._orphanId) {
      const attachmentId = this._orphanId;
      this._orphanId = null;
      void bindBlobOwner(attachmentId, { model: this.ownerModel, id: this.ownerId });
    }
  }

  private _pick() {
    this._error = "";
    this._input?.click();
  }

  private async _onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Скидаємо одразу: інакше повторний вибір того самого файлу не дасть change.
    input.value = "";
    if (!file) return;

    if (file.size > this.maxSizeMb * 1024 * 1024) {
      this._error = t("blob.tooLarge").replace("{size}", formatFileSize(this.maxSizeMb * 1024 * 1024));
      return;
    }

    this._busy = true;
    this._error = "";
    try {
      const ref = await uploadBlob(file, { model: this.ownerModel, id: this.ownerId });
      this._orphanId = this.ownerId ? null : ref.id;
      this.valueId = ref.id;
      this.valueToken = ref.token;
      this._emit(ref.id, ref.token, ref.name, ref.mime, ref.size);
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    } finally {
      this._busy = false;
    }
  }

  /**
   * Очищення прибирає посилання з моделі, але не видаляє саме вкладення:
   * рішення «видалити файл назавжди» приймає модель при збереженні, інакше
   * скасована правка форми знищила б чужі байти.
   */
  private _clear() {
    this.valueId = "";
    this.valueToken = "";
    this._emit(null, null);
  }

  private _emit(
    id: string | null,
    token: string | null,
    name?: string,
    mime?: string,
    size?: number,
  ) {
    this.dispatchEvent(new CustomEvent("value-changed", {
      detail: { id, token, name, mime, size },
      bubbles: true,
      composed: true,
    }));
  }

  override render(): TemplateResult {
    const box = `width:${this.size}px;height:${this.size}px`;

    return html`
      <div class="flex flex-col gap-1">
        ${this.label
          ? html`<span class="label text-sm leading-none">
              ${this.label}${this.required ? html`<span class="text-error ml-0.5">*</span>` : ""}
            </span>`
          : ""}

        <div class="flex items-start gap-3">
          <div
            class="border border-base-300 rounded-lg bg-base-200 flex items-center justify-center overflow-hidden"
            style=${box}
          >
            ${this._busy
              ? html`<span class="loading loading-spinner"></span>`
              : this._hasValue
              ? html`<img
                  src=${blobUrl(this.valueId, this.valueToken)}
                  alt=${this.label}
                  class="max-w-full max-h-full object-contain"
                />`
              : html`<span class="text-xs text-muted px-2 text-center">
                  ${t("blob.noImage")}
                </span>`}
          </div>

          <div class="flex flex-col gap-1">
            <button
              class="btn btn-sm"
              ?disabled=${this.disabled || this._busy}
              @click=${this._pick}
            >
              ${this._hasValue ? t("blob.replace") : t("blob.choose")}
            </button>
            ${this._hasValue
              ? html`
                <a
                  class="btn btn-sm btn-ghost"
                  href=${blobUrl(this.valueId, this.valueToken, "attachment")}
                  download
                >${t("blob.download")}</a>
                <button
                  class="btn btn-sm btn-ghost text-error"
                  ?disabled=${this.disabled || this._busy}
                  @click=${this._clear}
                >${t("blob.clear")}</button>`
              : ""}
          </div>
        </div>

        ${this._error ? html`<span class="text-xs text-error">${this._error}</span>` : ""}

        <input type="file" class="hidden" accept=${this.accept} @change=${this._onFile} />
      </div>
    `;
  }
}
