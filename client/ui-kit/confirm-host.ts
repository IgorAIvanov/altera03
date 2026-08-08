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
 * Клавіатура: Enter — підтвердити (у choose — кнопка з primary), Esc або
 * клік повз вікно — відмова. Фокус одразу на головній кнопці.
 */
import { css, type CSSResultGroup, html, nothing, svg, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "./base/gsle.ts";
import { tw } from "../shared/styles.ts";
import { bus } from "../bus/bus.ts";
import type { ChoiceButton, DialogIcon } from "../bus/bus.types.ts";
import { t } from "../locale.ts";

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
  `];

  @state() private current: PendingDialog | null = null;

  #unsub: Array<() => void> = [];

  override connectedCallback() {
    super.connectedCallback();
    // Другий діалог поверх першого — помилка виклику; перший чесно
    // відхиляємо, щоб його промис не завис назавжди.
    this.#unsub.push(bus.on("confirm.open", (msg) => {
      if (this.current) this.#finish(null);
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
    if (this.current) this.#finish(null);
  }

  protected override updated() {
    if (this.current) {
      this.renderRoot.querySelector<HTMLButtonElement>("button.btn-primary")?.focus();
    }
  }

  /** null — відмова (Esc/хрестик/повз вікно). */
  #finish(key: string | null) {
    const dialog = this.current;
    this.current = null;
    if (!dialog) return;
    if (dialog.kind === "confirm") {
      bus.emit({ type: "confirm.result", callbackId: dialog.callbackId, value: key === "ok" });
    } else {
      bus.emit({ type: "choice.result", callbackId: dialog.callbackId, value: key });
    }
  }

  #onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      this.#finish(null);
    }
    if (e.key === "Enter") {
      e.stopPropagation();
      const primary = this.current?.buttons.find((b) => b.primary);
      if (primary) this.#finish(primary.key);
    }
  };

  override render(): TemplateResult | typeof nothing {
    if (!this.current) return nothing;
    return html`
      <div class="app-dialog-overlay" @keydown=${this.#onKeyDown}
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
      </div>
    `;
  }
}
