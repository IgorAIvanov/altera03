import { GlobalStyledLitElement } from "../base/gsle.ts";
import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { t } from "../../locale.ts";
import { dateFormat, formatDate } from "../../shared/datetime.ts";

/**
 * Поле-секрет (`x-secret` у схемі): токен API банку, ключ зовнішнього сервісу.
 *
 * Значення секрету форма не бачить НІКОЛИ — сервер його не віддає (див.
 * `server/modules/secret/`). Тому контрол показує не значення, а стан: «задано
 * · змінено 07.10.26 14:05» чи «не задано», і дві дії — задати новий або
 * очистити. Поле вводу з'являється лише на час набору й має тип `password`.
 *
 * Значення в моделі — НАМІР, а не секрет:
 *  - `undefined` або `""` — не змінювати (форма не шле старого значення;
 *    порожній набір теж «не змінювати», стерти можна лише явною кнопкою);
 *  - непорожній рядок — записати новий;
 *  - `null` — очистити.
 *
 * Подія `value-changed` (`detail.value`) — на кожну зміну наміру, включно з
 * відміною (знову `undefined`).
 */
@customElement("ui-secret")
export class UiSecret extends GlobalStyledLitElement {
  static override shadowRootOptions: ShadowRootInit = {
    ...GlobalStyledLitElement.shadowRootOptions,
    delegatesFocus: true,
  };

  /** Намір: `undefined` — не змінювати, рядок — новий секрет, `null` — очистити. */
  @property({ attribute: false }) value: string | null | undefined = undefined;
  /** Чи задано секрет на сервері — `<поле>Set` із відповіді `get`. */
  @property({ type: Boolean, attribute: "is-set" }) isSet = false;
  /** Коли змінено — `<поле>ChangedAt` (ISO з `Z`). */
  @property({ type: String, attribute: "changed-at" }) changedAt = "";
  @property({ type: Boolean }) disabled = false;
  @property({ type: String }) placeholder = "";
  /** Текст помилки поля; непорожній — рамка червона (як у решти контролів). */
  @property({ type: String, reflect: true }) invalid = "";

  /** Відкрито поле вводу нового значення. */
  @state() private _editing = false;

  @query("input") private _input?: HTMLInputElement;

  private _emit(value: string | null | undefined) {
    this.value = value;
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value }, bubbles: true, composed: true }));
  }

  private async _startEdit() {
    this._editing = true;
    await this.updateComplete;
    this._input?.focus();
  }

  private _cancel() {
    this._editing = false;
    this._emit(undefined);
  }

  private _onInput(e: Event) {
    // Порожній набір їде як `""` — рантайм читає його як «не змінювати». Не
    // `undefined`: той приходить лише ЗЗОВНІ (запис збережено чи перечитано) і
    // закриває поле вводу, а стерти набране — ще не привід його закривати.
    this._emit((e.target as HTMLInputElement).value);
  }

  private _onKeyDown(e: KeyboardEvent) {
    if (e.code === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this._cancel();
    }
  }

  private _status() {
    if (this.value === null) return t("core.secret.willClear");
    if (!this.isSet) return t("core.secret.notSet");
    if (!this.changedAt) return t("core.secret.set");
    return t("core.secret.setAt", { at: formatDate(new Date(this.changedAt), dateFormat.dateTime) });
  }

  override render(): TemplateResult {
    if (this._editing) {
      return html`
        <div class="join w-full">
          <input
            class="input input-sm join-item w-full"
            type="password"
            autocomplete="new-password"
            spellcheck="false"
            placeholder=${this.placeholder || t("core.secret.placeholder")}
            aria-invalid=${this.invalid ? "true" : "false"}
            .value=${typeof this.value === "string" ? this.value : ""}
            ?disabled=${this.disabled}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
          />
          <button type="button" class="btn btn-sm join-item" ?disabled=${this.disabled} @click=${this._cancel}>
            ${t("core.secret.cancel")}
          </button>
        </div>
      `;
    }

    const pendingClear = this.value === null;
    return html`
      <div class="flex items-center gap-2 min-h-8">
        <span class="text-sm ${this.isSet && !pendingClear ? "" : "text-base-content/70"}">${this._status()}</span>
        ${pendingClear
          ? html`<button type="button" class="btn btn-sm" ?disabled=${this.disabled} @click=${this._cancel}>
              ${t("core.secret.cancel")}
            </button>`
          : html`
            <button type="button" class="btn btn-sm" ?disabled=${this.disabled} @click=${this._startEdit}>
              ${this.isSet ? t("core.secret.change") : t("core.secret.setNew")}
            </button>
            ${this.isSet
              ? html`<button type="button" class="btn btn-sm" ?disabled=${this.disabled} @click=${() => this._emit(null)}>
                  ${t("core.secret.clear")}
                </button>`
              : nothing}
          `}
      </div>
    `;
  }

  /** Запис збережено чи перечитано (намір знову `undefined`) — поле вводу закрити. */
  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("value") && this.value === undefined) this._editing = false;
  }
}
