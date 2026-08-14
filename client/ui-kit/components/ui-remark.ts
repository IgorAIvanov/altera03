import { GlobalStyledLitElement } from "../base/gsle.ts";
import { css, html, type CSSResultGroup, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { bus } from "../../bus/bus.ts";
import { t } from "../../locale.ts";
import { readUserScoped, removeUserScoped, writeUserScoped } from "../../shared/user-storage.ts";

/** Типи зауваження — той самий перелік, що в `app.remark` (ck_remark_kind). */
const KINDS = ["error", "question", "wish", "order"] as const;
type Kind = typeof KINDS[number];

/** Чернетка переживає перезавантаження: абзац, написаний двічі, не пишуть. */
const DRAFT_KEY = "altera.remark-draft";

/**
 * Кнопка «Зауваження» в оболонці плюс діалог швидкого запису.
 *
 * Живе у фреймворку й малюється оболонкою, а не шапкою застосунку, з двох
 * причин. Контекст випадку (маршрут вкладки й id запису) знає `tab-controller`,
 * і саме він передає його сюди; а зауваження найчастіше стосується зламаного
 * екрана — тому механізм не має права бути частиною того екрана. Тут він
 * переживе будь-яку поламку в панелі вкладки.
 *
 * Компонент нічого не знає про те, ЯК влаштована модель `remark`: він шле
 * звичайну команду моделі через шину. Немає таблиці в базі — команда відмовить
 * конвертом, а не зламає оболонку.
 */
@customElement("ui-remark")
export class UiRemark extends GlobalStyledLitElement {
  /** Маршрут активної вкладки — `document/invoice/edit`. */
  @property({ type: String }) route = "";
  /** Id запису активної вкладки, якщо вкладка його має. */
  @property({ type: String, attribute: "model-id" }) modelId: string | null = null;

  @state() private open = false;
  @state() private kind: Kind = "error";
  /** НЕ `title`: так зветься властивість HTMLElement, і приватним полем її
   *  перекрити не можна — клас перестає бути HTMLElement для декоратора. */
  @state() private summary = "";
  @state() private body = "";
  @state() private busy = false;
  @state() private error = "";
  /** Скільки відповідей людина ще не прочитала — значок біля кнопки. */
  @state() private unread = 0;

  static override styles: CSSResultGroup = [
    ...(GlobalStyledLitElement.styles as CSSResultGroup[]),
    css`
      :host { display: inline-flex; align-items: center; }
      .trigger {
        display: inline-flex; align-items: center; gap: 6px;
        background: none; border: 0; cursor: pointer;
        color: inherit; font: inherit; padding: 2px 6px; border-radius: 4px;
      }
      .trigger:hover { background: rgba(255, 255, 255, 0.12); }
      .badge-unread {
        min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
        background: #2563eb; color: #fff; font-size: 11px; line-height: 16px;
        text-align: center;
      }
      /* Центрування дає правило теми dialog:modal; тут лише розміри. Довгий
         текст зауваження не має виштовхувати кнопки за екран, звідси max-height
         і прокрутка всередині. (Зворотних лапок у коментарі всередині css-шаблона
         бути не може — вони обривають сам шаблонний рядок.) */
      dialog {
        width: min(460px, 92vw);
        max-height: 88vh;
        border: 0; border-radius: 10px; padding: 0;
      }
      .body { overflow: auto; }
      dialog::backdrop { background: rgba(0, 0, 0, 0.45); }
      .body { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
      .kinds { display: flex; gap: 6px; flex-wrap: wrap; }
      .ctx {
        font-family: ui-monospace, monospace; font-size: 11px;
        opacity: 0.7; word-break: break-all;
      }
      .foot { display: flex; align-items: center; gap: 8px; }
      .spacer { flex: 1; }
      .err { color: #b42318; font-size: 13px; }
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
      // так само, тому мовчимо, а не показуємо помилку в шапці.
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

  #dialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector("dialog");
  }

  #show = () => {
    this.open = true;
    this.error = "";
    this.updateComplete.then(() => {
      this.#dialog()?.showModal();
      this.renderRoot.querySelector<HTMLInputElement>("#remark-title")?.focus();
    });
  };

  #close = () => {
    this.#saveDraft();
    this.#dialog()?.close();
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
            ctxModel: this.route.split("/")[1] ?? null,
            ctxRecordId: this.modelId,
            ctxUserAgent: navigator.userAgent,
          },
        },
      }) as { ok?: boolean; messages?: { text?: string }[] } | undefined;

      if (!env?.ok) {
        this.error = env?.messages?.[0]?.text ?? t("core.remark.sendFailed");
        return;
      }
      // Надіслане — більше не чернетка.
      this.summary = "";
      this.body = "";
      removeUserScoped(DRAFT_KEY);
      this.#dialog()?.close();
      this.open = false;
    } finally {
      this.busy = false;
    }
  }

  /** `document/invoice/edit/412` — рівно те, чим вкладка описана у сховищі. */
  #contextRoute(): string | null {
    if (!this.route) return null;
    return this.modelId ? `${this.route}/${this.modelId}` : this.route;
  }

  override render(): TemplateResult {
    return html`
      <button class="trigger" @click=${this.#show} title=${t("core.remark.hint")}>
        <span>${t("core.remark.button")}</span>
        ${this.unread > 0 ? html`<span class="badge-unread">${this.unread}</span>` : ""}
      </button>
      ${this.open ? this.#renderDialog() : ""}
    `;
  }

  #renderDialog(): TemplateResult {
    return html`
      <dialog @close=${() => { this.open = false; }} @cancel=${this.#close}>
        <div class="body">
          <div class="kinds">
            ${KINDS.map((k) => html`
              <button class="btn btn-sm ${this.kind === k ? "btn-primary" : ""}"
                @click=${() => { this.kind = k; }}>
                ${t(`core.remark.kind.${k}`)}
              </button>
            `)}
          </div>

          <input id="remark-title" class="input input-bordered w-full"
            placeholder=${t("core.remark.titlePlaceholder")}
            .value=${this.summary}
            @input=${(e: Event) => { this.summary = (e.target as HTMLInputElement).value; }} />

          <textarea class="textarea textarea-bordered w-full" rows="4"
            placeholder=${t("core.remark.bodyPlaceholder")}
            .value=${this.body}
            @input=${(e: Event) => { this.body = (e.target as HTMLTextAreaElement).value; }}></textarea>

          <div class="ctx">${this.#contextRoute() ?? t("core.remark.noContext")}</div>
          ${this.error ? html`<div class="err">${this.error}</div>` : ""}

          <div class="foot">
            <button class="btn btn-sm btn-primary" ?disabled=${this.busy} @click=${this.#send}>
              ${t("core.remark.send")}
            </button>
            <button class="btn btn-sm" ?disabled=${this.busy} @click=${this.#close}>
              ${t("common.cancel")}
            </button>
            <span class="spacer"></span>
          </div>
        </div>
      </dialog>
    `;
  }
}
