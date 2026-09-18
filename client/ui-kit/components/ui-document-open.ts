import { GlobalStyledLitElement } from "../base/gsle.ts";
import { css, html, type CSSResultGroup, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { t } from "../../locale.ts";
import { openDocumentByCode } from "../../tabs/open-document.ts";

/**
 * Поле «відкрити документ за кодом» — для шапки застосунку.
 *
 * Сценарій складу: прийшов папір — відсканували штрихкод з бланка — відкрилася
 * форма документа. Сканер — це клавіатура: «друкує» код у поле з фокусом і
 * закінчує `Enter`. Тому тут звичайне поле, без перехоплення клавіатури на
 * всьому вікні: `Enter` віддає код, поле очищається, фокус лишається — під
 * наступний папір.
 *
 * Шапка належить застосунку, тож поле туди ставить він, як `<ui-remark>`:
 *
 * ```ts
 * import "@client/ui-kit/components/ui-document-open.ts";
 * html`<div class="right"><ui-document-open></ui-document-open> …</div>`
 * ```
 *
 * Кольори — від шапки (`currentColor`), а не з теми: поле стоїть на темній
 * смузі, де звичайний `.input` виглядав би латкою.
 */
@customElement("ui-document-open")
export class UiDocumentOpen extends GlobalStyledLitElement {
  @state() private _busy = false;

  static override styles: CSSResultGroup = [
    ...(GlobalStyledLitElement.styles as CSSResultGroup[]),
    css`
      :host { display: inline-flex; align-items: center; }
      input {
        width: 10rem; height: 22px; padding: 0 8px;
        font: inherit; font-family: ui-monospace, monospace; font-size: 12px;
        color: inherit; background-color: rgba(255, 255, 255, .12);
        border: 1px solid rgba(255, 255, 255, .28); border-radius: 3px;
      }
      input::placeholder { color: inherit; opacity: .7; font-family: "Roboto", sans-serif; }
      input:hover { background-color: rgba(255, 255, 255, .18); }
      input:focus { outline: 1px solid currentColor; outline-offset: 1px; background-color: rgba(255, 255, 255, .22); }
      input[aria-busy="true"] { cursor: progress; }
    `,
  ];

  // `keydown`, а не `change`: `change` на Enter спрацьовує лише тоді, коли
  // значення змінилося, а той самий код, відсканований удруге (закрили вкладку
  // й передумали), має відкрити документ знову.
  #onKeyDown = async (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.isComposing) return;
    // Обробив — познач: інакше Enter піде далі (оболонка, «Enter — далі»).
    e.preventDefault();
    if (this._busy) return;

    const input = e.target as HTMLInputElement;
    const code = input.value;
    if (!code.trim()) return;
    input.value = "";

    this._busy = true;
    try {
      await openDocumentByCode(code);
    } finally {
      this._busy = false;
    }
  };

  override render(): TemplateResult {
    return html`
      <input type="text" inputmode="numeric" autocomplete="off" spellcheck="false"
        placeholder=${t("core.documentLocate.placeholder")}
        title=${t("core.documentLocate.hint")}
        aria-label=${t("core.documentLocate.placeholder")}
        aria-busy=${this._busy ? "true" : "false"}
        @keydown=${this.#onKeyDown}>
    `;
  }
}
