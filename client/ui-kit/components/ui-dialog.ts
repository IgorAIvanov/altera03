import { GlobalStyledLitElement } from "../base/gsle.ts";
import { css, html, type CSSResultGroup, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t } from "../../locale.ts";

/**
 * Модальне вікно застосунку — ОДНЕ на всі діалоги.
 *
 * Вигляд (смуга заголовка кольором шапки, тіло, полиця кнопок) уже був у темі —
 * `.app-dialog*`, ним намальовані вікна шини. Але кожен, кому треба було своє
 * вікно, писав його заново: хто через `<dialog>` з класами Tailwind, хто через
 * власний оверлей. Вигляд розходився мовчки й по одному вікну за раз, а разом з
 * ним розходилася й поведінка — де Esc закриває, де ні; де фокус повертається,
 * де ні.
 *
 * Механіку бере НАТИВНИЙ `<dialog>`: top layer (вікно не ріжеться батьківським
 * `overflow`), фокус-пастка, Esc і повернення фокуса приходять від браузера.
 * Оболонка теж розраховує саме на нього — вона впізнає відкрите вікно за
 * `<dialog open>` у `composedPath()`, щоб Esc закривав вікно, а не вкладку.
 *
 * ```html
 * <ui-dialog .open=${this.open} heading="Зауваження" @ui-dialog-close=${...}>
 *   <p>тіло</p>
 *   <div slot="actions"><button class="btn btn-sm btn-primary">Гаразд</button></div>
 * </ui-dialog>
 * ```
 *
 * Ширина — змінною `--ui-dialog-width` на самому елементі: властивість тут
 * означала б, що компонент вирішує за розкладку, а вона справа того, хто вікно
 * ставить.
 */
@customElement("ui-dialog")
export class UiDialog extends GlobalStyledLitElement {
  /**
   * Заголовок. НЕ `title`: так зветься властивість HTMLElement, і перекрити її
   * своєю не можна — клас перестає бути HTMLElement для декоратора.
   */
  @property({ type: String }) heading = "";
  @property({ type: Boolean, reflect: true }) open = false;
  /** Прибрати хрестик — для вікон, які мусять дістати відповідь. */
  @property({ type: Boolean, attribute: "no-close" }) noClose = false;

  static override styles: CSSResultGroup = [
    ...(GlobalStyledLitElement.styles as CSSResultGroup[]),
    css`
      :host { display: contents; }
      /* Центрування дає правило теми dialog:modal. Тут — лише розміри:
         вікно не має ані виходити за екран, ані стискатися в смужку. */
      dialog {
        width: var(--ui-dialog-width, auto);
        max-width: min(92vw, 44rem);
        max-height: 88vh;
        border: 0;
        padding: 0;
        background: none;
        overflow: visible;
      }
      dialog::backdrop { background: rgba(36, 55, 70, .45); }
      .app-dialog { max-height: 88vh; }
      .app-dialog-body { overflow: auto; }
    `,
  ];

  #el(): HTMLDialogElement | null {
    return this.renderRoot.querySelector("dialog");
  }

  override updated(changed: Map<string, unknown>): void {
    if (!changed.has("open")) return;
    const el = this.#el();
    if (!el) return;
    // showModal() на вже відкритому вікні кидає — тому звіряємося зі станом
    // самого елемента, а не лише з властивістю.
    if (this.open && !el.open) el.showModal();
    if (!this.open && el.open) el.close();
  }

  /**
   * Закриття — завжди подія назовні, і ніколи самостійна зміна `open`.
   *
   * Власник вікна тримає стан у себе; якби компонент гасив `open` сам, після
   * Esc власник вважав би вікно відкритим і не зміг би показати його вдруге.
   */
  #close = () => {
    this.dispatchEvent(new CustomEvent("ui-dialog-close", { bubbles: true, composed: true }));
  };

  override render(): TemplateResult {
    return html`
      <dialog
        @cancel=${(e: Event) => { e.preventDefault(); this.#close(); }}
        @close=${this.#close}
      >
        <div class="app-dialog">
          <div class="app-dialog-title">
            <span>${this.heading}</span>
            ${this.noClose ? "" : html`
              <button type="button" class="app-dialog-close" aria-label=${t("common.close")}
                @click=${this.#close}>×</button>
            `}
          </div>
          <div class="app-dialog-body"><slot></slot></div>
          <div class="app-dialog-actions"><slot name="actions"></slot></div>
        </div>
      </dialog>
    `;
  }
}
