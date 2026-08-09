import { html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "../base/gsle.ts";
import { t } from "../../locale.ts";
import { blobUrl, formatFileSize, isImageMime, uploadBlob } from "../../shared/blob.ts";
import { apiFetch } from "../../data/api.ts";
import { icons } from "../icons.ts";

interface AttachmentRow {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt?: string;
  /** Токен доступу — підставляє рантайм замість ключа доступу. */
  token: string;
}

/**
 * Список вкладень запису — і документа, і довідника.
 *
 * Вкладення зберігаються одразу при виборі файлу (окремо від моделі), тому
 * запис повинен уже мати id: інакше нема до чого прив'язувати. Поки `owner-id`
 * порожній, компонент показує підказку «спершу збережіть запис» — це чесніше,
 * ніж мовчазна черга незбережених файлів.
 *
 * ```html
 * <ui-attachments
 *   owner-model="invoice"
 *   .ownerId=${item.id ?? ""}
 *   .label=${t("invoice.attachments")}
 * ></ui-attachments>
 * ```
 */
@customElement("ui-attachments")
export class UiAttachments extends GlobalStyledLitElement {
  @property({ type: String }) label = "";
  @property({ type: Boolean }) disabled = false;
  @property({ type: String, attribute: "owner-model" }) ownerModel = "";
  @property({ type: String, attribute: "owner-id" }) ownerId = "";
  @property({ type: String }) accept = "";
  @property({ type: Number, attribute: "max-size-mb" }) maxSizeMb = 10;

  @state() private _rows: AttachmentRow[] = [];
  @state() private _busy = false;
  @state() private _error = "";

  @query("input[type=file]") private _input?: HTMLInputElement;

  override connectedCallback() {
    super.connectedCallback();
    if (this.ownerId) void this.reload();
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    // Форма спершу малюється порожньою, а id приходить після get/save —
    // перечитуємо список саме на зміну власника, а не в кожному оновленні.
    if (changed.has("ownerId") || changed.has("ownerModel")) {
      if (this.ownerId && this.ownerModel) void this.reload();
      else this._rows = [];
    }
  }

  /** Перечитати список. Публічний — форма кличе його після збереження. */
  async reload(): Promise<void> {
    if (!this.ownerId || !this.ownerModel) return;

    try {
      const response = await apiFetch("/api/model/attachment/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerModel: this.ownerModel, ownerId: this.ownerId }),
      });
      const envelope = await response.json();
      this._rows = (envelope?.data?.rows ?? []) as AttachmentRow[];
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    }
  }

  private _pick() {
    this._error = "";
    this._input?.click();
  }

  private async _onFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length) return;

    this._busy = true;
    this._error = "";
    try {
      for (const file of files) {
        if (file.size > this.maxSizeMb * 1024 * 1024) {
          this._error = t("blob.tooLarge", { size: formatFileSize(this.maxSizeMb * 1024 * 1024) });
          continue;
        }
        await uploadBlob(file, { model: this.ownerModel, id: this.ownerId });
      }
      await this.reload();
      this._emitChanged();
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    } finally {
      this._busy = false;
    }
  }

  private async _remove(row: AttachmentRow) {
    if (!globalThis.confirm(`${t("common.confirmDelete")}: ${row.name}?`)) return;

    this._busy = true;
    try {
      await apiFetch("/api/model/attachment/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      await this.reload();
      this._emitChanged();
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    } finally {
      this._busy = false;
    }
  }

  private _emitChanged() {
    this.dispatchEvent(new CustomEvent("attachments-changed", {
      detail: { count: this._rows.length },
      bubbles: true,
      composed: true,
    }));
  }

  override render(): TemplateResult {
    const canAdd = Boolean(this.ownerId && this.ownerModel) && !this.disabled && !this._busy;

    return html`
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="font-semibold text-sm">
            ${this.label || t("blob.attachments")}
            ${this._rows.length ? html`<span class="opacity-50">(${this._rows.length})</span>` : ""}
          </span>
          <button class="btn btn-sm" ?disabled=${!canAdd} @click=${this._pick}>
            ${this._busy ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
            + ${t("blob.add")}
          </button>
        </div>

        ${!this.ownerId
          ? html`<div class="text-sm text-muted">${t("blob.saveFirst")}</div>`
          : this._rows.length === 0
          ? html`<div class="text-sm text-muted">${t("common.noData")}</div>`
          : html`
            <table class="table table-sm w-full">
              <tbody>
                ${this._rows.map((row) => html`
                  <tr>
                    <td class="w-10">
                      ${isImageMime(row.mime)
                        ? html`<img
                            src=${blobUrl(row.id, row.token)}
                            alt=${row.name}
                            class="w-8 h-8 object-cover rounded"
                          />`
                        : html`<span class="text-muted">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                              stroke="currentColor" stroke-width="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                              <polyline points="14 2 14 8 20 8"/>
                            </svg>
                          </span>`}
                    </td>
                    <td>
                      <a
                        class="link link-hover"
                        href=${blobUrl(row.id, row.token, "attachment")}
                        download=${row.name}
                      >${row.name}</a>
                    </td>
                    <td class="w-24 text-right tabular-nums text-muted">
                      ${formatFileSize(row.size)}
                    </td>
                    <td class="w-10 text-center">
                      <button
                        class="btn btn-ghost btn-xs text-error"
                        title=${t("common.delete")}
                        ?disabled=${this.disabled || this._busy}
                        @click=${() => this._remove(row)}
                      >
                        ${icons.delete}
                      </button>
                    </td>
                  </tr>
                `)}
              </tbody>
            </table>`}

        ${this._error ? html`<span class="text-xs text-error">${this._error}</span>` : ""}

        <input
          type="file"
          class="hidden"
          multiple
          accept=${this.accept || "*/*"}
          @change=${this._onFiles}
        />
      </div>
    `;
  }
}
