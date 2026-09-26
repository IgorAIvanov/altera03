/**
 * Хост модальних діалогів шини — `bus.confirm()` (так/ні) і `bus.choose()`
 * (довільні кнопки, напр. «Зберегти / Не зберігати / Скасувати»). За зразком
 * picker-host: живе в оболонці (tab-controller), слухає `confirm.open` /
 * `choice.open`, відповідає `confirm.result` / `choice.result`. Форми з ним
 * не розмовляють напряму — лише через шину.
 *
 * Вигляд — контракт `.app-dialog-*` у темі + іконка за типом питання
 * (знак питання / оклику / хрест / «i»), як у діалогах A2v10.
 *
 * Клавіатура, поки вікно відкрите, належить ЙОМУ цілком (див. #onKeyDown):
 * Enter — кнопка у фокусі (спершу це головна), ←/→ і Tab/Shift+Tab — між
 * кнопками по колу, Esc або клік повз вікно — відмова. Після закриття фокус
 * повертається туди, де стояв до відкриття.
 */
import { css, type CSSResultGroup, html, nothing, svg, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "./base/gsle.ts";
import { tw } from "../shared/styles.ts";
import { bus } from "../bus/bus.ts";
import type { ChoiceButton, DialogIcon } from "../bus/bus.types.ts";
import { t } from "../locale.ts";
import { deepActiveElement } from "./focus-order.ts";

interface PendingDialog {
  kind: "confirm" | "choice";
  text: string;
  callbackId: string;
  buttons: ChoiceButton[];
  icon: DialogIcon;
}

/** Іконки діалогів. Кольори — літералами тієї ж гами, що й у темі.
    Літерал доводиться звіряти руками: `--color-error` уже раз розійшовся з
    цим файлом, коли колір помилки підняли до порога контрасту. */
const icons: Record<DialogIcon, TemplateResult> = {
  question: svg`<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#2f5f8f" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12" y2="17.01" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  warning: svg`<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.6"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="17" x2="12" y2="17.01" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  error: svg`<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15" stroke-width="2" stroke-linecap="round"/><line x1="9" y1="9" x2="15" y2="15" stroke-width="2" stroke-linecap="round"/></svg>`,
  info: svg`<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#2f5f8f" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="8" x2="12" y2="8.01" stroke-width="2.4" stroke-linecap="round"/></svg>`,
};

export const tagName = "confirm-host";

@customElement(tagName)
export class ConfirmHost extends GlobalStyledLitElement {
  // Вигляд вікна — контракт .app-dialog-* у темі (client/styles/theme.css):
  // один на всі діалоги застосунку, тут лише :host.
  static override styles: CSSResultGroup = [tw, css`
    :host { display: contents; }
    /* Нативний <dialog> лише як носій верхнього шару: рамку, фон і розміри
       дає картка .app-dialog. Центрування — правило теми dialog:modal. */
    dialog {
      border: 0;
      padding: 0;
      background: none;
      overflow: visible;
      max-width: 92vw;
      max-height: 88vh;
    }
    dialog::backdrop { background: rgba(36, 55, 70, .45); }
  `];

  @state() private current: PendingDialog | null = null;

  /**
   * Де стояв фокус до відкриття. Вікно зникає з DOM при закритті, а з ним і
   * головна кнопка разом із фокусом, і без
   * повернення він падав на `body` — «Видалити рядок? Так» лишало таблицю без
   * фокуса, і клавіатура переставала працювати до кліку мишею.
   */
  #returnFocus: HTMLElement | null = null;

  #remember() {
    const el = deepActiveElement();
    // Фокус у самому вікні — це відкриття поверх попереднього: повертатися
    // треба туди, куди повернувся б перший, а його вже переніс #finish.
    if (el && !this.renderRoot.contains(el)) this.#returnFocus = el;
  }

  #unsub: Array<() => void> = [];

  override connectedCallback() {
    super.connectedCallback();
    // Другий діалог поверх першого — помилка виклику; перший чесно
    // відхиляємо, щоб його промис не завис назавжди.
    this.#unsub.push(bus.on("confirm.open", (msg) => {
      if (this.current) this.#finish(null);
      this.#remember();
      this.current = {
        kind: "confirm",
        text: msg.text,
        callbackId: msg.callbackId,
        icon: msg.icon ?? "question",
        buttons: [
          { key: "cancel", labelKey: "common.cancel" },
          { key: "ok", labelKey: msg.okKey ?? "common.yes", primary: true },
        ],
      };
    }));
    this.#unsub.push(bus.on("choice.open", (msg) => {
      if (this.current) this.#finish(null);
      this.#remember();
      this.current = {
        kind: "choice",
        text: msg.text,
        callbackId: msg.callbackId,
        icon: msg.icon ?? "question",
        buttons: msg.buttons,
      };
    }));
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#unsub.forEach((fn) => fn());
    this.#unsub = [];
    document.removeEventListener("keydown", this.#onKeyDown, true);
    this.#shown = null;
    if (this.current) this.#finish(null);
  }

  /** Вікно, для якого вже поставлено початковий фокус і слухача клавіш. */
  #shown: PendingDialog | null = null;

  /**
   * Вікно — нативний `<dialog>` через `showModal()`, тобто ВЕРХНІЙ ШАР браузера.
   *
   * Доти це був звичайний оверлей із `position: fixed`, і з відкритого
   * `<ui-dialog>` (той теж `showModal()`) підтвердження з'являлося ПІД вікном:
   * над верхнім шаром звичайний елемент не піднімає жоден `z-index`, а модальний
   * `<dialog>` ще й робить решту документа інертною — кнопки підтвердження не
   * приймали кліку. Новий модальний `<dialog>` стає над уже відкритим і сам
   * інертним не буває, звідки б його не показали.
   */
  #dialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector("dialog");
  }

  protected override updated() {
    // Той самий <dialog> Lit лишає й тоді, коли одне вікно змінюється іншим, —
    // showModal() на вже відкритому кидає, тож звіряємося з його станом.
    const el = this.#dialog();
    if (el && !el.open) el.showModal();

    if (this.current === this.#shown) return;
    this.#shown = this.current;
    if (this.current) {
      document.addEventListener("keydown", this.#onKeyDown, true);
      // Фокус — ОДИН раз при відкритті. Доти він ставився на кожне оновлення,
      // тож вибрана стрілкою кнопка поверталася на головну.
      this.#actions()[this.#primaryIndex()]?.focus();
    } else {
      document.removeEventListener("keydown", this.#onKeyDown, true);
    }
  }

  #actions(): HTMLButtonElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLButtonElement>(".app-dialog-actions button")];
  }

  #primaryIndex(): number {
    const i = this.current?.buttons.findIndex((b) => b.primary) ?? -1;
    return i < 0 ? 0 : i;
  }

  /** null — відмова (Esc/хрестик/повз вікно). */
  #finish(key: string | null) {
    const dialog = this.current;
    this.current = null;
    if (!dialog) return;
    const back = this.#returnFocus;
    this.#returnFocus = null;
    if (back) {
      void this.updateComplete.then(() => {
        // Слідом відкрили нове вікно — воно й поверне фокус, коли закриється.
        if (this.current) this.#returnFocus ??= back;
        // Лише якщо фокус пропав: після «Так» форма могла сама поставити
        // його, куди треба (сусідній рядок замість видаленого).
        else if (back.isConnected && !deepActiveElement()) back.focus();
      });
    }
    if (dialog.kind === "confirm") {
      bus.emit({ type: "confirm.result", callbackId: dialog.callbackId, value: key === "ok" });
    } else {
      bus.emit({ type: "choice.result", callbackId: dialog.callbackId, value: key });
    }
  }

  /**
   * Клавіші модального вікна — на ФАЗІ ПЕРЕХОПЛЕННЯ документа, а не на оверлеї.
   *
   * Слухач на оверлеї чув клавішу лише тоді, коли фокус усередині вікна. А
   * фокус звідти відбирається легко й непомітно — відкладеним фокусуванням
   * поля чи комірки, яке спрацьовує вже після відкриття, — і тоді Enter/Esc
   * летіли у форму ПІД вікном: вікно висить, а клавіатура діє за ним. Модальне
   * вікно забирає клавіатуру цілком, тож і слухає її раніше за всіх, і далі
   * не пропускає нічого.
   *
   * Enter натискає кнопку У ФОКУСІ, а не завжди головну: доти вибрана Tab-ом
   * «Не зберігати» по Enter усе одно зберігала.
   */
  #onKeyDown = (e: KeyboardEvent) => {
    const dialog = this.current;
    if (!dialog) return;
    // Модифікатори самі по собі нічого не роблять — не заважаємо сполученням.
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();

    const actions = this.#actions();
    const focused = actions.indexOf(this.shadowRoot?.activeElement as HTMLButtonElement);

    if (e.key === "Escape") {
      this.#finish(null);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      const index = focused >= 0 ? focused : this.#primaryIndex();
      const button = dialog.buttons[index];
      if (button) this.#finish(button.key);
      return;
    }
    const step = e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)
      ? 1
      : e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)
      ? -1
      : 0;
    if (step && actions.length) {
      const from = focused >= 0 ? focused : this.#primaryIndex();
      actions[(from + step + actions.length) % actions.length].focus();
    }
  };

  override render(): TemplateResult | typeof nothing {
    if (!this.current) return nothing;
    return html`
      <dialog
        @cancel=${(e: Event) => { e.preventDefault(); this.#finish(null); }}
        @click=${(e: Event) => { if (e.target === e.currentTarget) this.#finish(null); }}>
        <div class="app-dialog">
          <div class="app-dialog-title">
            <span>${t("common.confirmTitle")}</span>
            <button type="button" class="app-dialog-close" aria-label=${t("common.close")}
              @click=${() => this.#finish(null)}>×</button>
          </div>
          <div class="app-dialog-body">
            <div class="flex items-center gap-4 py-1">
              <span class="shrink-0">${icons[this.current.icon]}</span>
              <span>${this.current.text}</span>
            </div>
          </div>
          <div class="app-dialog-actions">
            ${this.current.buttons.map((b) => html`
              <button class="btn btn-sm ${b.primary ? "btn-primary" : ""}"
                @click=${() => this.#finish(b.key)}>
                ${t(b.labelKey)}
              </button>
            `)}
          </div>
        </div>
      </dialog>
    `;
  }
}
