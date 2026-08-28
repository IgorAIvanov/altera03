import { css, html, type CSSResultGroup, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "../base/gsle.ts";
import { t } from "../../locale.ts";
import { blobUrl, formatFileSize, isImageMime } from "../../shared/blob.ts";
import { readUserScoped, writeUserScoped } from "../../shared/user-storage.ts";
import { clampRatio, ratioAfterDrag, restoreSplit, type SplitState } from "../split-geometry.ts";
import { clampWindow, restoreWindow, type WindowGeometry } from "../window-geometry.ts";
import { icons } from "../icons.ts";

/** Файл, який показуємо: рівно рядок відповіді `attachment/list`. */
export interface ViewerFile {
  id: string;
  token: string;
  name: string;
  mime: string;
  size?: number;
}

/** Подія «покажи цей файл» — її шле `<ui-attachment-button>`. */
export interface FileOpenDetail {
  file: ViewerFile;
}

/**
 * Ключі роздільні, бо роздільні й самі стани: розкладка (частка, порядок,
 * режим) живе, поки людина працює; геометрія плавучого вікна має сенс лише в
 * своєму режимі. Один запис означав би, що зміна розміру вікна переписує й
 * налаштування розділення.
 */
const SPLIT_KEY = "ui.file-dock";
const WINDOW_KEY = "ui.file-window";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4];

/** Розміри вікна браузера — єдине місце, де їх читають із globalThis. */
function viewport() {
  return { width: globalThis.innerWidth, height: globalThis.innerHeight };
}

/**
 * Перегляд вкладення поруч із формою — у двох режимах.
 *
 * РЕЖИМІВ ДВА, І ЦЕ НЕ ДУБЛЬ. Вони відповідають на різні питання, і кожен
 * програє там, де сильний інший:
 *
 * · **розділення** (умовчання) — звірка рядок за рядком. Екран ділиться навпіл
 *   смугою, форма СТИСКАЄТЬСЯ до своєї половини й отримує власну прокрутку.
 *   Саме цього не вміє вікно поверх форми: воно її не стискає, а ховає, і
 *   табличну частину посеред сторінки розсунути нема куди;
 * · **плавуче вікно** — «глянути, що це». Форма лишається цілою, вікно
 *   пересувають і міняють у розмірі, а коли воно заважає — відсувають, а не
 *   перебудовують екран.
 *
 * Перемикач — у смузі заголовка; вибір запам'ятовується на користувача разом із
 * положенням смуги, порядком половин і геометрією вікна.
 *
 * ЯК ЙОГО СТАВЛЯТЬ. Компонент обгортає каркас форми, а не стоїть поруч:
 *
 * ```ts
 * override render() {
 *   return html`
 *     <ui-file-dock owner-model="invoice" .ownerId=${this.$root.item.id ?? ""}>
 *       ${this.renderForm(html`…поля…`)}
 *     </ui-file-dock>`;
 * }
 * ```
 *
 * Доки файл не відкрито, він не малює НІЧОГО, крім слота: порожній екран
 * виглядає точно так само, як без нього, і місця не займає.
 *
 * ВИСОТА — УМОВА РОБОТИ. Розділення ділить те, що йому дали, тож компонент
 * мусить отримати висоту цілком: `:host { height: 100% }` тут, і те саме для
 * форми в `BaseUI`. Доти висота хоста форми була `auto`, `h-full` у каркасі не
 * розв'язувався, і прокручувалася вся панель вкладки разом із командною
 * панеллю — тією самою, якій скіл велить лишатися вгорі.
 *
 * ЧОМУ ВОНО ХОВАЄТЬСЯ РАЗОМ ІЗ ВКЛАДКОЮ. Панель вкладки — `position: absolute;
 * overflow: auto` без `transform`, тому `position: fixed` усередині неї не
 * ріжеться прокруткою, а неактивна вкладка гасне цілком (`display: none`) і
 * забирає вікно з собою. Скан чужого документа поверх чужої форми — готова
 * помилка вводу, тож це вимога, а не побічний ефект.
 */
@customElement("ui-file-dock")
export class UiFileDock extends GlobalStyledLitElement {
  @property({ type: String, attribute: "owner-model" }) ownerModel = "";
  @property({ type: String, attribute: "owner-id" }) ownerId = "";

  @state() private _file: ViewerFile | null = null;
  @state() private _split: SplitState = restoreSplit(readUserScoped(SPLIT_KEY));
  @state() private _window: WindowGeometry = restoreWindow(readUserScoped(WINDOW_KEY), viewport());
  /** Масштаб зображення; `null` — вписати. PDF масштабує сам браузер. */
  @state() private _zoom: number | null = null;
  /** Під час перетягу гасимо події у вмісті — інакше їх ловить iframe. */
  @state() private _dragging = false;

  static override styles: CSSResultGroup = [
    ...(GlobalStyledLitElement.styles as CSSResultGroup[]),
    css`
      /* Розділення ділить висоту, яку йому дали, — отже мусить її мати. */
      :host { display: block; height: 100%; }

      .split,
      .frame {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      /* Файл унизу — той самий каркас, перевернутий: смуга лишається між
         панелями, а знак руху миші перевертає split-geometry. */
      .split.file-last { flex-direction: column-reverse; }

      .pane {
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .pane-form { flex: 1 1 auto; }
      /* Каркас форми всередині слота отримує рівно висоту панелі — далі він
         сам вирішує, що прокручувати (у нього прокручується область полів). */
      .pane-form ::slotted(*),
      .frame ::slotted(*) { flex: 1 1 auto; min-height: 0; }

      .pane-file {
        flex: none;
        background-color: var(--app-surface, #eef2f5);
        overflow: hidden;
      }

      /* Плавуче вікно. Рамку й тінь бере діалогова тема, розміри — людина. */
      .window {
        position: fixed;
        z-index: 40;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .window.app-dialog { max-width: none; min-width: 0; }

      .file-body {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        background-color: var(--app-surface, #eef2f5);
      }
      .file-body.busy { pointer-events: none; }
      .file-body iframe {
        width: 100%;
        height: 100%;
        border: 0;
        background-color: #ffffff;
      }
      .file-body img { display: block; }
      .file-body img.fit { max-width: 100%; max-height: 100%; object-fit: contain; }

      .file-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 6px;
        background-color: var(--color-primary, #2f5f8f);
        color: var(--color-primary-content, #ffffff);
        user-select: none;
      }
      .window .file-head { cursor: move; }
      .file-name {
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
      }
      .file-actions { display: flex; align-items: center; gap: 2px; flex: none; }

      .note {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        margin: auto;
        padding: 24px;
        text-align: center;
      }

      /* Смуга розділення. Тонка сама, з широкою зоною захоплення: цілитися
         мишею в три пікселі — робота, а не керування. */
      .splitter {
        flex: none;
        height: 7px;
        cursor: row-resize;
        background-color: var(--app-border-field, #b8c3cc);
        border-top: 1px solid var(--app-surface, #eef2f5);
        border-bottom: 1px solid var(--app-surface, #eef2f5);
        touch-action: none;
      }
      .splitter:hover,
      .splitter.active { background-color: var(--color-primary, #2f5f8f); }

      /* Кут захоплення вікна. Своя ручка, а не CSS resize: той не дає події,
         тобто розмір нікуди було б записати. (Зворотні лапки в цьому файлі
         заборонені — вони закривають css-шаблон.) */
      .grip {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 14px;
        height: 14px;
        cursor: nwse-resize;
        touch-action: none;
      }
      .grip::after {
        content: "";
        position: absolute;
        right: 3px;
        bottom: 3px;
        width: 7px;
        height: 7px;
        border-right: 2px solid var(--app-border-strong, #98a7b4);
        border-bottom: 2px solid var(--app-border-strong, #98a7b4);
      }
    `,
  ];

  override connectedCallback() {
    super.connectedCallback();
    // Подія приходить із кнопки, що стоїть у командній панелі форми — тобто
    // з середини слота. Composed-подія з shadow root форми піднімається сюди
    // звичайним спливанням, тож ані шини, ані посилань на компонент не треба.
    this.addEventListener("ui-file-open", this.#onFileOpen as EventListener);
    globalThis.addEventListener("resize", this.#onWindowResize);
  }

  override disconnectedCallback() {
    this.removeEventListener("ui-file-open", this.#onFileOpen as EventListener);
    globalThis.removeEventListener("resize", this.#onWindowResize);
    super.disconnectedCallback();
  }

  #onFileOpen = (event: CustomEvent<FileOpenDetail>) => {
    // Позначаємо ОБРОБЛЕНОЮ: кнопка за цим і розрізняє «показали» від «форму
    // не загорнули в док», і мовчазної діри в налаштуванні не лишається.
    event.preventDefault();

    const file = event.detail?.file;
    if (!file) return;

    // Новий файл — новий масштаб: 400% від попереднього скана на цьому не
    // означають нічого, окрім розгубленості.
    if (file.id !== this._file?.id) this._zoom = null;
    // Геометрію звіряємо з екраном на кожному відкритті: вона могла приїхати з
    // іншого монітора, і вікно опинилося б за краєм цілком.
    this._window = clampWindow(this._window, viewport());
    this._file = file;
  };

  #onWindowResize = () => {
    if (this._file && this._split.mode === "float") {
      this._window = clampWindow(this._window, viewport());
    }
  };

  #persistSplit() {
    writeUserScoped(SPLIT_KEY, this._split);
  }

  #close = () => {
    this._file = null;
  };

  #swap = () => {
    this._split = { ...this._split, fileFirst: !this._split.fileFirst };
    this.#persistSplit();
  };

  #toggleMode = () => {
    this._split = { ...this._split, mode: this._split.mode === "float" ? "split" : "float" };
    if (this._split.mode === "float") this._window = clampWindow(this._window, viewport());
    this.#persistSplit();
  };

  #height(): number {
    return this.renderRoot.querySelector(".split")?.getBoundingClientRect().height ?? 0;
  }

  /**
   * Захоплення вказівника — спільне для смуги, перетягу вікна й кута.
   *
   * Воно тут не деталь: під усіма трьома лежить `<iframe>` з PDF, і без
   * захоплення миша, зайшовши на нього, забирає події собі — жест зривається на
   * першому ж русі. Захоплення може й відмовити (жест перервали, подія
   * синтетична), тому воно в `try`: виняток убив би весь обробник, і вікно
   * просто не рушило б, не лишивши сліду про причину.
   */
  #beginGesture(
    event: PointerEvent,
    onMove: (moveEvent: PointerEvent) => void,
    onDone: () => void,
  ) {
    const handle = event.currentTarget as HTMLElement;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Без захоплення жест теж працює, доки вказівник не зайде на iframe;
      // саме тому на час жесту вміст гасне (`pointer-events: none`).
    }

    this._dragging = true;

    const finish = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      this._dragging = false;
      onDone();
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  #beginSplitDrag(event: PointerEvent) {
    const startY = event.clientY;
    const startRatio = this._split.ratio;
    const height = this.#height();

    this.#beginGesture(
      event,
      (moveEvent) => {
        this._split = {
          ...this._split,
          ratio: ratioAfterDrag(startRatio, moveEvent.clientY - startY, height, this._split.fileFirst),
        };
      },
      () => this.#persistSplit(),
    );
  }

  #beginWindowGesture(event: PointerEvent, mode: "move" | "resize") {
    // За кнопки заголовка вікно не тягнемо: там натискають, а не переміщують.
    if (mode === "move" && (event.target as HTMLElement).closest("button, a")) return;

    // Точка натискання й геометрія на її момент — окремими іменами: зсув
    // рахується від ПОЧАТКУ жесту, а не від попереднього кадру, інакше
    // похибка накопичується.
    const from = { pointerX: event.clientX, pointerY: event.clientY, ...this._window };

    this.#beginGesture(
      event,
      (moveEvent) => {
        const dx = moveEvent.clientX - from.pointerX;
        const dy = moveEvent.clientY - from.pointerY;

        this._window = clampWindow(
          mode === "move"
            ? { ...from, x: from.x + dx, y: from.y + dy }
            : { ...from, w: from.w + dx, h: from.h + dy },
          viewport(),
        );
      },
      () => writeUserScoped(WINDOW_KEY, this._window),
    );
  }

  #zoomBy(direction: 1 | -1) {
    const current = this._zoom ?? 1;
    const index = ZOOM_STEPS.findIndex((step) => step >= current - 0.001);
    this._zoom = ZOOM_STEPS[Math.max(0, Math.min(index + direction, ZOOM_STEPS.length - 1))];
  }

  override render(): TemplateResult {
    const file = this._file;

    // Без файлу компонент не малює нічого зайвого: екран виглядає так само, як
    // без нього, і місця не займає.
    if (!file) return html`<slot></slot>`;

    return this._split.mode === "float" ? this.#renderFloating(file) : this.#renderSplit(file);
  }

  #renderSplit(file: ViewerFile): TemplateResult {
    const percent = `${(clampRatio(this._split.ratio, this.#height() || 0) * 100).toFixed(2)}%`;

    return html`
      <div class=${`split${this._split.fileFirst ? "" : " file-last"}`}>
        <section class="pane pane-file" style=${`height:${percent}`}>
          ${this.#renderHead(file)}
          <div class=${`file-body${this._dragging ? " busy" : ""}`}>${this.#renderFile(file)}</div>
        </section>

        <div
          class=${`splitter${this._dragging ? " active" : ""}`}
          role="separator"
          aria-orientation="horizontal"
          aria-label=${t("blob.splitter")}
          @pointerdown=${(e: PointerEvent) => this.#beginSplitDrag(e)}
        ></div>

        <section class="pane pane-form"><slot></slot></section>
      </div>
    `;
  }

  #renderFloating(file: ViewerFile): TemplateResult {
    const { x, y, w, h } = this._window;

    return html`
      <div class="frame"><slot></slot></div>

      <div
        class="app-dialog window"
        style=${`left:${x}px; top:${y}px; width:${w}px; height:${h}px;`}
        role="dialog"
        aria-label=${file.name}
      >
        ${this.#renderHead(file, (e: PointerEvent) => this.#beginWindowGesture(e, "move"))}
        <div class=${`file-body${this._dragging ? " busy" : ""}`}>${this.#renderFile(file)}</div>
        <div class="grip" @pointerdown=${(e: PointerEvent) => this.#beginWindowGesture(e, "resize")}></div>
      </div>
    `;
  }

  /** Смуга заголовка спільна для обох режимів — різниця лише в перетягу. */
  #renderHead(file: ViewerFile, onPointerDown?: (event: PointerEvent) => void): TemplateResult {
    const floating = this._split.mode === "float";

    return html`
      <div class="file-head" @pointerdown=${onPointerDown ?? nothingHandler}>
        <span class="file-name" title=${file.name}>${file.name}</span>
        <span class="file-actions">
          ${isImageMime(file.mime)
            ? html`
              <button type="button" class="app-dialog-close" title=${t("blob.zoomOut")}
                aria-label=${t("blob.zoomOut")} @click=${() => this.#zoomBy(-1)}>${icons.zoomOut}</button>
              <button type="button" class="app-dialog-close" title=${t("blob.fit")}
                aria-label=${t("blob.fit")} @click=${() => this._zoom = null}>${icons.fit}</button>
              <button type="button" class="app-dialog-close" title=${t("blob.zoomIn")}
                aria-label=${t("blob.zoomIn")} @click=${() => this.#zoomBy(1)}>${icons.zoomIn}</button>`
            : ""}
          ${floating ? "" : html`
            <button type="button" class="app-dialog-close" title=${t("blob.swap")}
              aria-label=${t("blob.swap")} @click=${this.#swap}>${icons.swap}</button>`}
          <button type="button" class="app-dialog-close"
            title=${floating ? t("blob.dockBack") : t("blob.undock")}
            aria-label=${floating ? t("blob.dockBack") : t("blob.undock")}
            @click=${this.#toggleMode}
          >${floating ? icons.dock : icons.undock}</button>
          <a class="app-dialog-close" href=${blobUrl(file.id, file.token, "attachment")}
            download=${file.name} title=${t("blob.download")} aria-label=${t("blob.download")}
          >${icons.download}</a>
          <button type="button" class="app-dialog-close" title=${t("common.close")}
            aria-label=${t("common.close")} @click=${this.#close}>×</button>
        </span>
      </div>
    `;
  }

  #renderFile(file: ViewerFile): TemplateResult {
    const source = blobUrl(file.id, file.token);

    if (file.mime === "application/pdf") {
      // Саме `<iframe>`, а не власний рендерер: багатосторінковість, пошук,
      // друк і масштаб уже є у вбудованому переглядачі браузера. Сервер віддає
      // PDF із `Content-Disposition: inline` (тип у білому списку).
      return html`<iframe src=${source} title=${file.name}></iframe>`;
    }

    if (isImageMime(file.mime)) {
      return this._zoom === null
        ? html`<img class="fit" src=${source} alt=${file.name} />`
        : html`<img src=${source} alt=${file.name} style=${`width:${this._zoom * 100}%`} />`;
    }

    // Тип, який не показати, — не помилка й не привід мовчати: файл є, просто
    // дивитися його треба в чомусь іншому.
    return html`
      <div class="note">
        <span class="text-muted">${t("blob.noPreview")}</span>
        <a class="btn btn-sm" href=${blobUrl(file.id, file.token, "attachment")} download=${file.name}>
          ${icons.download} ${t("blob.download")}
          ${file.size ? html`<span class="text-muted">(${formatFileSize(file.size)})</span>` : ""}
        </a>
      </div>
    `;
  }
}

/** У режимі розділення смугу заголовка не тягають — вішати нічого. */
const nothingHandler = () => {};
