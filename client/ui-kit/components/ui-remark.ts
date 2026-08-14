import { GlobalStyledLitElement } from "../base/gsle.ts";
import { SignalWatcher } from "@lit-labs/signals";
import { css, html, type CSSResultGroup, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { bus } from "../../bus/bus.ts";
import { t } from "../../locale.ts";
import { activeTab } from "../../tabs/active-tab.ts";
import { readUserScoped, removeUserScoped, writeUserScoped } from "../../shared/user-storage.ts";
import "./ui-dialog.ts";

/** Типи зауваження — той самий перелік, що в app.remark (ck_remark_kind). */
const KINDS = ["error", "question", "wish", "order"] as const;
type Kind = typeof KINDS[number];

/** Чернетка переживає перезавантаження: абзац, написаний двічі, не пишуть. */
const DRAFT_KEY = "altera.remark-draft";

const Base: typeof GlobalStyledLitElement = SignalWatcher(GlobalStyledLitElement);

/**
 * Кнопка «Зауваження» плюс діалог швидкого запису.
 *
 * Стоїть у шапці застосунку — там, де решта загальних дій (організація,
 * користувач, вихід). Зауваження стосується всього застосунку, а не вкладки, і
 * в смузі вкладок воно виглядало б дією над вкладкою.
 *
 * Контекст випадку компонент бере сам — із сигналу активної вкладки
 * (`client/tabs/active-tab.ts`), бо між шапкою й оболонкою немає спільного
 * власника, який міг би передати його властивістю.
 *
 * Про модель `remark` компонент знає лише ім'я команди: він шле її звичайною
 * шиною. Немає таблиці в базі — команда відмовить конвертом, а шапка лишиться
 * робочою.
 */
@customElement("ui-remark")
export class UiRemark extends Base {
  @state() private open = false;
  @state() private kind: Kind = "error";
  /**
   * НЕ `title`: так зветься властивість HTMLElement, і перекрити її своєю не
   * можна — клас перестає бути HTMLElement для декоратора @customElement.
   */
  @state() private summary = "";
  @state() private body = "";
  @state() private busy = false;
  @state() private error = "";
  /** Скільки відповідей людина ще не прочитала — значок на кнопці. */
  @state() private unread = 0;

  static override styles: CSSResultGroup = [
    ...(GlobalStyledLitElement.styles as CSSResultGroup[]),
    css`
      :host { display: inline-flex; align-items: center; }
      .trigger {
        display: inline-flex; align-items: center; gap: 6px;
        background: none; border: 0; cursor: pointer;
        color: inherit; font: inherit; padding: 3px 8px; border-radius: 3px;
      }
      .trigger:hover { background: rgba(255, 255, 255, .18); }
      .trigger:focus-visible { outline: 1px solid currentColor; outline-offset: 1px; }
      .unread {
        min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
        background: #d97706; color: #fff; font-size: 11px; line-height: 16px;
        text-align: center; font-weight: 500;
      }
      .form { display: flex; flex-direction: column; gap: 10px; min-width: 24rem; }
      .kinds { display: flex; gap: 6px; flex-wrap: wrap; }
      .ctx {
        font-family: ui-monospace, monospace; font-size: 11px;
        color: var(--app-muted, #5a6b7a); word-break: break-all;
      }
      .err { color: var(--color-error, #b42318); font-size: 13px; }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    this.#restoreDraft();
    this.#loadUnread();
    // Відповідь виконавця приходить не в цю вкладку, а в базу. Перечитуємо
    // лічильник, коли модель мінялася де завгодно в застосунку.
    this.#off = bus.on("model.changed", (m) => {
      if ((m as { model?: string }).model === "remark") this.#loadUnread();
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#off?.();
  }

  #off: (() => void) | undefined;

  async #loadUnread(): Promise<void> {
    try {
      const env = await bus.request("data.load", {
        model: "remark",
        command: "unread",
        payload: {},
      }) as { ok?: boolean; data?: { totals?: { count?: number } } } | undefined;
      this.unread = env?.ok ? Number(env.data?.totals?.count ?? 0) : 0;
    } catch {
      // Лічильник — прикраса: установка без таблиці зауважень мусить працювати
      // так само, тому мовчимо, а не світимо помилкою в шапці.
      this.unread = 0;
    }
  }

  #restoreDraft(): void {
    const d = readUserScoped(DRAFT_KEY) as { kind?: Kind; title?: string; body?: string } | null;
    if (!d) return;
    this.kind = d.kind ?? "error";
    this.summary = d.title ?? "";
    this.body = d.body ?? "";
  }

  #saveDraft(): void {
    if (!this.summary && !this.body) {
      removeUserScoped(DRAFT_KEY);
      return;
    }
    writeUserScoped(DRAFT_KEY, { kind: this.kind, title: this.summary, body: this.body });
  }

  #show = () => {
    this.error = "";
    this.open = true;
    this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLInputElement>("#remark-title")?.focus();
    });
  };

  #close = () => {
    this.#saveDraft();
    this.open = false;
  };

  async #send(): Promise<void> {
    if (!this.summary.trim()) {
      this.error = t("core.remark.titleRequired");
      return;
    }
    this.busy = true;
    this.error = "";
    try {
      const env = await bus.request("data.save", {
        model: "remark",
        command: "save",
        payload: {
          item: {
            kind: this.kind,
            title: this.summary.trim(),
            body: this.body,
            ctxRoute: this.#contextRoute(),
            ctxModel: activeTab()?.route.split("/")[1] ?? null,
            ctxRecordId: activeTab()?.modelId ?? null,
            ctxUserAgent: navigator.userAgent,
          },
        },
      }) as { ok?: boolean; messages?: { text?: string }[] } | undefined;

      if (!env?.ok) {
        this.error = env?.messages?.[0]?.text ?? t("core.remark.sendFailed");
        return;
      }
      this.summary = "";
      this.body = "";
      removeUserScoped(DRAFT_KEY);
      this.open = false;
    } finally {
      this.busy = false;
    }
  }

  /** `document/invoice/edit/412` — рівно те, чим вкладка описана у сховищі. */
  #contextRoute(): string | null {
    const tab = activeTab();
    if (!tab) return null;
    return tab.modelId ? `${tab.route}/${tab.modelId}` : tab.route;
  }

  override render(): TemplateResult {
    return html`
      <button class="trigger" type="button" title=${t("core.remark.hint")} @click=${this.#show}>
        <span>${t("core.remark.button")}</span>
        ${this.unread > 0 ? html`<span class="unread">${this.unread}</span>` : ""}
      </button>

      <ui-dialog
        .open=${this.open}
        heading=${t("core.remark.button")}
        style="--ui-dialog-width: 30rem"
        @ui-dialog-close=${this.#close}
      >
        <div class="form">
          <div class="kinds">
            ${KINDS.map((k) => html`
              <button type="button" class="btn btn-sm ${this.kind === k ? "btn-primary" : ""}"
                @click=${() => { this.kind = k; }}>
                ${t(`core.remark.kind.${k}`)}
              </button>
            `)}
          </div>

          <input id="remark-title" class="input w-full"
            placeholder=${t("core.remark.titlePlaceholder")}
            .value=${this.summary}
            @input=${(e: Event) => { this.summary = (e.target as HTMLInputElement).value; }} />

          <textarea class="textarea w-full" rows="5"
            placeholder=${t("core.remark.bodyPlaceholder")}
            .value=${this.body}
            @input=${(e: Event) => { this.body = (e.target as HTMLTextAreaElement).value; }}></textarea>

          <div class="ctx">${this.#contextRoute() ?? t("core.remark.noContext")}</div>
          ${this.error ? html`<div class="err">${this.error}</div>` : ""}
        </div>

        <div slot="actions">
          <button class="btn btn-sm" ?disabled=${this.busy} @click=${this.#close}>
            ${t("common.cancel")}
          </button>
          <button class="btn btn-sm btn-primary" ?disabled=${this.busy} @click=${this.#send}>
            ${t("core.remark.send")}
          </button>
        </div>
      </ui-dialog>
    `;
  }
}
