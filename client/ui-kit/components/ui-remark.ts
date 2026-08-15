import { GlobalStyledLitElement } from "../base/gsle.ts";
import { SignalWatcher } from "@lit-labs/signals";
import { css, html, type CSSResultGroup, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { bus } from "../../bus/bus.ts";
import { t } from "../../locale.ts";
import { icons } from "../icons.ts";
import { appVersion } from "../../auth/session.ts";
import { activeTab } from "../../tabs/active-tab.ts";
import { removeUserScoped } from "../../shared/user-storage.ts";
import { capturing, grabFrame, startCapture, stopCapture } from "../../shell/screen-capture.ts";
import { uploadBlob } from "../../shared/blob.ts";
import "./ui-dialog.ts";

/** Типи зауваження — той самий перелік, що в app.remark (ck_remark_kind). */
const KINDS = ["error", "question", "wish", "order"] as const;
type Kind = typeof KINDS[number];

/**
 * Ключ чернетки в сховищі — лишився ТІЛЬКИ щоб прибрати за попередніми версіями.
 *
 * Чернетку в localStorage прибрано зовсім. Задумувалася вона як страховка від
 * втрати тексту, а на ділі раз за разом підсовувала людині вчорашні слова у
 * вікні, яке та щойно відкрила як нове, — і жодне уточнення правил («писати
 * лише при згортанні», «читати лише позначене») цього не вилікувало, бо
 * помилковим було саме припущення: набраний текст мусить жити рівно стільки,
 * скільки видно вікно, у якому його набирають.
 *
 * Свою задачу згорнуте вікно закриває без сховища: воно тримає текст у пам'яті,
 * поки сторінка відкрита, а саме це й потрібно, щоб піти подивитися сусідній
 * екран.
 */
const LEGACY_DRAFT_KEY = "altera.remark-draft";

/** Знімок разом з адресою для показу — щоб було що відкликати. */
interface Shot {
  file: File;
  url: string;
}

/**
 * JPEG → PNG для буфера обміну.
 *
 * Буфер приймає від сторінки лише `image/png` — JPEG туди просто не кладеться,
 * хоча кадри ми зберігаємо саме в ньому (учетверо менші). Тому перекодовуємо на
 * місці, і повертаємо ПРОМІС: `ClipboardItem` уміє його чекати, а от `await`
 * перед самим записом з'їдає жест користувача, без якого браузер запис забороняє.
 */
function toPngBlob(file: File): Promise<Blob> {
  return createImageBitmap(file).then((bitmap) => {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error("canvas.toBlob")), "image/png")
    );
  });
}

const Base: typeof GlobalStyledLitElement = SignalWatcher(GlobalStyledLitElement);

/**
 * Кнопка «Зауваження» плюс вікно швидкого запису.
 *
 * Стоїть у шапці застосунку — там, де решта загальних дій. Зауваження стосується
 * всього застосунку, а не вкладки, і в смузі вкладок воно виглядало б дією над
 * вкладкою. Контекст випадку компонент бере сам, із сигналу активної вкладки.
 *
 * ТРИ СТАНИ, і середній тут головний. Випадок рідко вміщається в один екран:
 * щоб показати «ось тут увів, а ось тут вилізло», потрібно кілька знімків, а
 * зробити їх, поки поверх системи висить модальне вікно, неможливо — та й
 * система під ним не працює. Тому вікно **згортається в куток**: набраний текст
 * лишається, застосунок повністю живий, а в кутку лишаються рівно дві дії —
 * зняти ще кадр і розгорнути назад.
 *
 * Згорнуте вікно не модальне навмисно: модальність — це й є те, що заважає.
 *
 * ДОЗВІЛ НА ЕКРАН живе рівно стільки, скільки саме зауваження: питається при
 * відкритті вікна, знімається при закритті. Тобто ціна — одне системне вікно
 * «чим поділитися» на кожне зауваження замість одного на весь сеанс перевірки;
 * взамін екран не лишається розшареним увесь день, а в шапці немає ані
 * перемикача, ані індикатора, за яким треба стежити.
 */
@customElement("ui-remark")
export class UiRemark extends Base {
  @state() private mode: "closed" | "open" | "min" = "closed";
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
  /**
   * Кадри цього зауваження. Перший знімається в мить натискання кнопки — ДО
   * того, як відкрилося вікно; решту людина додає зі згорнутого стану, уже
   * дійшовши до потрібного екрана.
   */
  @state() private shots: Shot[] = [];
  /** Який кадр щойно скопійовано — щоб дія не виглядала беззвучною. */
  @state() private copied = -1;

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

      .shots { display: flex; gap: 8px; flex-wrap: wrap; }
      .shot { position: relative; }
      .shot img {
        height: 64px; display: block;
        border: 1px solid var(--app-border, #b8c3cc); border-radius: 3px;
      }
      .shot-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .shot-actions .hint { font-size: 12px; color: var(--app-muted, #5a6b7a); }
      /* Копіювання — на самій мініатюрі: кнопка поруч зі списком не сказала б,
         який саме кадр вона візьме. */
      .shot .tools {
        position: absolute; left: 3px; bottom: 3px;
        display: flex; gap: 3px;
      }
      .shot .tools .btn {
        padding: 0 4px; min-height: 0; height: 18px; line-height: 16px;
        font-size: 11px;
      }
      .shot .drop {
        position: absolute; top: -7px; right: -7px;
        width: 18px; height: 18px; line-height: 15px; padding: 0;
        border-radius: 50%; border: 1px solid var(--app-border-strong, #98a7b4);
        background: var(--color-base-100, #fff); cursor: pointer; font-size: 12px;
      }

      /* Згорнуте вікно. position: fixed — воно належить екрану, а не шапці, у
         якій компонент стоїть. z-index нижчий за модальні вікна: згорнуте не
         має накривати те, що людина відкриє далі. */
      .mini {
        position: fixed; right: 14px; bottom: 14px; z-index: 40;
        display: flex; align-items: center; gap: 4px;
        padding: 4px 6px; border-radius: 6px;
        background: var(--color-base-100, #fff);
        border: 1px solid var(--app-border-strong, #98a7b4);
        box-shadow: 0 6px 20px rgba(0, 0, 0, .25);
        color: var(--color-base-content, #1f2937);
      }
      .mini .count { font-size: 12px; color: var(--app-muted, #5a6b7a); min-width: 10px; }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    // Прибирання за попередніми версіями: чернетки в сховищі більше немає.
    removeUserScoped(LEGACY_DRAFT_KEY);
    this.#loadUnread();
    // Відповідь виконавця приходить не в цю вкладку, а в базу. Перечитуємо
    // лічильник, коли модель мінялася де завгодно в застосунку.
    this.#off = bus.on("model.changed", (m) => {
      if ((m as { model?: string }).model === "remark") this.#loadUnread();
    });
    // Вікно живе в тіньовому корені компонента, тож слухач тут ловить і вставку
    // всередині нього.
    this.addEventListener("paste", this.#onPaste as EventListener);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#off?.();
    this.removeEventListener("paste", this.#onPaste as EventListener);
    this.#dropShots();
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

  /** Кадри живуть рівно одне зауваження: чернетка тексту переживає, знімки — ні. */
  #dropShots(): void {
    this.shots.forEach((s) => URL.revokeObjectURL(s.url));
    this.shots = [];
  }

  #dropShot(index: number): void {
    const shot = this.shots[index];
    if (!shot) return;
    URL.revokeObjectURL(shot.url);
    this.shots = this.shots.filter((_, i) => i !== index);
  }

  #addShot = async (): Promise<void> => {
    if (!capturing() && !await startCapture()) {
      this.error = t("core.remark.captureRefused");
      return;
    }
    const file = await grabFrame();
    if (!file) return;
    this.#addFile(file);
  };

  /**
   * Кадр у буфер — щоб дорисувати стрілку в будь-якому редакторі й повернути
   * назад. Це дешевший шлях, ніж власне полотно для малювання, і працює з тим
   * інструментом, до якого людина звикла.
   */
  #copyShot = async (index: number): Promise<void> => {
    const shot = this.shots[index];
    if (!shot) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": toPngBlob(shot.file) }),
      ]);
      this.copied = index;
      setTimeout(() => { if (this.copied === index) this.copied = -1; }, 1500);
    } catch {
      this.error = t("core.remark.clipboardDenied");
    }
  };

  /**
   * Зберегти кадр файлом.
   *
   * Буфер обміну виявився не універсальним шляхом: Windows Snipping Tool —
   * інструмент ЗАХОПЛЕННЯ, а не редактор, і картинку ззовні він не приймає
   * взагалі. Файл приймають усі, тож коло замикається й без буфера: зберегти →
   * дорисувати чим завгодно → повернути файлом.
   */
  #saveShot(index: number): void {
    const shot = this.shots[index];
    if (!shot) return;
    const a = document.createElement("a");
    a.href = shot.url;
    a.download = shot.file.name;
    a.click();
  }

  /** Повернути дорисований кадр файлом — або додати будь-яку свою картинку. */
  #pickFiles = (e: Event) => {
    const input = e.target as HTMLInputElement;
    Array.from(input.files ?? [])
      .filter((f) => f.type.startsWith("image/"))
      .forEach((f) => this.#addFile(f));
    // Той самий файл мають приймати двічі поспіль — без цього другий вибір
    // не дає події зовсім.
    input.value = "";
  };

  /** Додати картинку з буфера — сюди повертається дорисований кадр. */
  #pasteShot = async (): Promise<void> => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((x) => x.startsWith("image/"));
        if (!type) continue;
        this.#addFile(new File([await item.getType(type)], `remark-paste.${type.split("/")[1]}`, { type }));
        return;
      }
      this.error = t("core.remark.pasteEmpty");
    } catch {
      this.error = t("core.remark.clipboardDenied");
    }
  };

  /**
   * Ctrl+V у вікні — той самий шлях, але без дозволу на читання буфера: подія
   * приносить дані сама. Текст не чіпаємо — інакше вставка в поле опису
   * перестала б працювати.
   */
  #onPaste = (e: ClipboardEvent) => {
    const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    this.#addFile(file);
  };

  #addFile(file: File): void {
    // Вставлене лишається тим, чим прийшло: у дорисованому кадрі стрілки й
    // підписи, а JPEG псує саме такі краї.
    this.shots = [...this.shots, { file, url: URL.createObjectURL(file) }];
  }

  /**
   * Відкрити вікно.
   *
   * Зі згорнутого стану — просто розгорнути: новий кадр тут був би зайвим, бо
   * людина щойно сама вирішувала, що знімати. З закритого — зняти екран, на який
   * скаржаться, ДО того як вікно його затулить.
   */
  #show = async () => {
    this.error = "";
    if (this.mode === "min") {
      this.mode = "open";
      return;
    }
    this.#dropShots();
    // Дозвіл питаємо тут — до того, як вікно затулить екран, і саме тому ж
    // одразу знімаємо перший кадр. Відмова не заважає: зауваження без картинки
    // це звичайне зауваження, а не помилка.
    if (await startCapture()) await this.#addShot();
    this.mode = "open";
    this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLInputElement>("#remark-title")?.focus();
    });
  };

  /** Згорнути. Текст лишається в пам'яті вікна — сховище тут ні до чого. */
  #minimize = () => {
    this.mode = "min";
  };

  #close = () => {
    // Закрити — це відмовитися: набране зникає разом із вікном.
    this.summary = "";
    this.body = "";
    this.kind = "error";
    this.#dropShots();
    // Дозвіл живе рівно стільки, скільки саме зауваження: згорнуте вікно його
    // тримає (там і роблять другий кадр), закрите — віддає. Постійно ввімкнений
    // доступ до екрана людина терпіти не мусить.
    stopCapture();
    this.mode = "closed";
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
            ctxSolution: appVersion().solution ?? null,
            ctxFramework: appVersion().framework ?? null,
            ctxUserAgent: navigator.userAgent,
          },
        },
      }) as { ok?: boolean; messages?: { text?: string }[] } | undefined;

      if (!env?.ok) {
        this.error = env?.messages?.[0]?.text ?? t("core.remark.sendFailed");
        return;
      }

      // Кадри — окремим каналом і ПІСЛЯ запису: власника вкладення треба знати,
      // а id зауваження з'являється лише тут. Невдале завантаження зауваження не
      // скасовує — текст важливіший за картинку.
      const id = (env as { data?: { item?: { id?: string } } }).data?.item?.id;
      if (id) {
        for (const shot of this.shots) {
          try {
            await uploadBlob(shot.file, { model: "remark", id });
          } catch {
            // мовчки: зауваження вже прийняте
          }
        }
      }

      this.summary = "";
      this.body = "";
        this.#dropShots();
      stopCapture();
        this.mode = "closed";
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

      ${this.mode === "min" ? this.#renderMini() : ""}
      ${this.#renderDialog()}
    `;
  }

  /** Куток: зняти ще кадр і розгорнути. Більше тут нічого бути не мусить. */
  #renderMini(): TemplateResult {
    return html`
      <div class="mini">
        <button type="button" class="btn btn-ghost btn-xs px-1"
          title=${t("core.remark.shotAdd")} aria-label=${t("core.remark.shotAdd")}
          @click=${this.#addShot}>
          ${icons.camera}
        </button>
        <span class="count">${this.shots.length || ""}</span>
        <button type="button" class="btn btn-ghost btn-xs px-1"
          title=${t("core.remark.restore")} aria-label=${t("core.remark.restore")}
          @click=${this.#show}>
          ${icons.expand}
        </button>
      </div>
    `;
  }

  #renderDialog(): TemplateResult {
    return html`
      <ui-dialog
        .open=${this.mode === "open"}
        heading=${t("core.remark.button")}
        style="--ui-dialog-width: 40rem"
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

          <div class="shot-actions">
            <button type="button" class="btn btn-sm" @click=${this.#pasteShot}>
              ${icons.paste} ${t("core.remark.shotPaste")}
            </button>
            <button type="button" class="btn btn-sm"
              @click=${() => this.renderRoot.querySelector<HTMLInputElement>("#remark-file")?.click()}>
              ${icons.import} ${t("core.remark.shotFile")}
            </button>
            <input id="remark-file" type="file" accept="image/*" multiple hidden
              @change=${this.#pickFiles} />
            <span class="hint">${t("core.remark.shotPasteHint")}</span>
          </div>

          ${this.shots.length
            ? html`
              <div class="shots">
                ${this.shots.map((shot, i) => html`
                  <div class="shot">
                    <img src=${shot.url} alt=${t("core.remark.shot")} />
                    <button type="button" class="drop" title=${t("core.remark.shotDrop")}
                      @click=${() => this.#dropShot(i)}>×</button>
                    <div class="tools">
                      <button type="button" class="btn btn-xs"
                        title=${t("core.remark.shotCopy")} aria-label=${t("core.remark.shotCopy")}
                        @click=${() => this.#copyShot(i)}>
                        ${this.copied === i ? t("core.remark.shotCopied") : icons.copy}
                      </button>
                      <button type="button" class="btn btn-xs"
                        title=${t("core.remark.shotSave")} aria-label=${t("core.remark.shotSave")}
                        @click=${() => this.#saveShot(i)}>
                        ${icons.export}
                      </button>
                    </div>
                  </div>
                `)}
              </div>`
            : ""}

          <div class="ctx">${this.#contextRoute() ?? t("core.remark.noContext")}</div>
          ${this.error ? html`<div class="err">${this.error}</div>` : ""}
        </div>

        <div slot="actions">
          <!-- Згорнути — головна дія цього вікна, а не службова: саме нею
               роблять другий і третій знімок. -->
          <button class="btn btn-sm" ?disabled=${this.busy} @click=${this.#minimize}>
            ${icons.collapse} ${t("core.remark.minimize")}
          </button>
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
