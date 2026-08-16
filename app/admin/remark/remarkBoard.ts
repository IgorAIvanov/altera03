import { css, html, nothing, type CSSResultGroup, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import { bus } from "@client/bus/bus.ts";
import { icons } from "@client/ui-kit/icons.ts";
import { dateFormat, formatDate } from "@client/shared/datetime.ts";
import {
  REMARK_KINDS,
  REMARK_STATUSES,
  RemarkBoardRootSchema,
  type RemarkBoardColumn,
  type RemarkBoardRoot,
  type RemarkRow,
} from "./remark.schema.ts";
import { remarkBadge } from "./remark-status.ts";
import "@client/ui-kit/components/ui-select.ts";

export const tagName = "remark-board";

type SelectEvent = CustomEvent<{ value: string }>;

/** Скільки карток бере одна сторінка колонки. */
const PAGE_SIZE = 20;

/**
 * Дошка зауважень: стан — колонка, запис — картка.
 *
 * Переносять картку двома способами, і обидва постійні. Перетягування — рідне
 * (HTML5 drag and drop, без жодної бібліотеки), кнопки ◀ ▶ — те, чим ту саму
 * дію робить клавіатура: перетягування їй недоступне в будь-якій реалізації,
 * тож кнопки не «до появи DnD», а назавжди.
 *
 * Ціна рідного DnD названа чесно: на дотику він не працює взагалі — `dragstart`
 * від пальця не приходить. Для облікового застосунку за столом це прийнятно, а
 * планшет має кнопки; емуляція дотику через pointer-події — це вже своя
 * реалізація перетягування, тобто рівно та легаси-латка, якої тут не хочуть.
 *
 * Колонки беруться з `REMARK_STATUSES`, а не з окремого переліку: за цим
 * масивом стоїть `ck_remark_status` у DDL, тож колонка дошки й дозволене
 * значення поля не можуть розійтися. Порядок масиву — і є порядок колонок,
 * тобто «сусідня колонка» має сенс: new → in_work → answered → fixed →
 * rejected.
 *
 * Чого тут НЕМАЄ і чому: порядку карток усередині колонки. Поля під нього в
 * `app.remark` немає, а таблиця ядрова — вигадати порядок на клієнті означало б
 * показувати те, чого не переживе перезавантаження. Картки йдуть від нових до
 * старих, як у журналі.
 */
@customElement(tagName)
export class RemarkBoard extends BaseUI<RemarkBoardRoot> {
  protected model = "remark";

  /**
   * Дошка нічого не редагує на місці — `$root` міняється кожним завантаженням,
   * як у списку. Без цього вкладка одразу після відкриття вважалася б брудною.
   */
  protected override dirtyTracking = false;

  constructor() {
    super(RemarkBoardRootSchema);
    // Колонки існують ще до першого запиту: порожня дошка мусить показувати
    // свої стани, а не порожнечу, яку можна прийняти за помилку завантаження.
    this.$root.columns = REMARK_STATUSES.map((key) => ({ key, rows: [], total: 0, pages: 1 }));
  }

  #unsub?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    void this.load();
    // Той самий канал, що в списку: правка з форми в сусідній вкладці
    // перемальовує дошку. Свій власний перенос сюди НЕ потрапляє — див. #moving.
    this.#unsub = bus.on("model.changed", (msg) => {
      if (msg.model === this.model && !this.#moving) void this.load();
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#unsub?.();
  }

  // ── Завантаження ───────────────────────────────────────────────────────────

  /** Відбір, спільний для всіх колонок; `status` додає сама колонка. */
  #filters(status: string) {
    const q = this.$root.$query;
    return {
      status,
      kind: q.kind || undefined,
      openOnly: q.openOnly || undefined,
    };
  }

  /**
   * Завантажити колонку.
   *
   * `pages` сторінок одним запитом (`pageSize` кратний), а не догортання
   * посторінково: інакше після переносу картки довелося б відтворювати всі
   * узяті раніше сторінки, і «показати ще» жило б до першої ж зміни.
   */
  async #loadColumn(column: RemarkBoardColumn): Promise<void> {
    const env = await this.run<{ rows: RemarkRow[]; totals: { count: number } }>("list", {
      search: this.$root.$query.search || undefined,
      filters: this.#filters(column.key),
      page: 1,
      pageSize: PAGE_SIZE * column.pages,
      sortBy: "createdAt",
      sortDir: this.$root.$query.sortDir,
    });
    if (!env.ok || !env.data) return;
    column.rows = env.data.rows ?? [];
    column.total = env.data.totals?.count ?? 0;
  }

  /**
   * Перезавантажити всі колонки.
   *
   * Паралельно, а не по черзі: п'ять запитів по черзі — це п'ять затримок
   * мережі підряд, і дошка збиралася б на очах.
   */
  protected async load(): Promise<void> {
    await Promise.all(this.$root.columns.map((c) => this.#loadColumn(c)));
  }

  #showMore = (column: RemarkBoardColumn) => {
    column.pages += 1;
    void this.#loadColumn(column);
  };

  // ── Перенос ────────────────────────────────────────────────────────────────

  /**
   * Перенести картку в сусідню колонку.
   *
   * `ownerDecision: true` — рівно те, що шле форма редагування. Ядро вимагає цю
   * заяву, щоб перевести замовлення в роботу, і читати її треба буквально: «за
   * цим викликом стоїть людина, яка вирішує», а не «дозволити все». За дошкою
   * стоїть та сама людина, що й за формою, тож інша відповідь тут була б
   * неправдою про те, хто натиснув.
   *
   * Картка переїжджає ОДРАЗУ, ще до відповіді бази, і чекає її на новому місці
   * приглушеною. Це не прикраса: доти дошка ставала на місце лише після
   * відповіді, а привид перетягування зникав одразу — тобто на час запиту
   * екран показував рівно те, що показав би невдалий перенос. Пауза читалася
   * як відмова, і це найгірше з можливих значень: справжня відмова тут теж
   * буває.
   *
   * Ціна — відкат. Він і є справжня робота цього методу: на `ok: false` рядок
   * повертається в СВОЮ колонку і на СВОЄ місце (`from`), а не просто в кінець.
   *
   * Перемальовуємо САМІ, а не підпискою на `model.changed`, і це не дрібниця.
   * `data.save` шле `model.changed` беззастережно — і на відмові теж (див.
   * `data-service.ts`). Тобто підписка кинулася б завантажувати колонки, а
   * кожна успішна відповідь `list` дорогою чистить `messages` — і пояснення,
   * ЧОМУ картку не пересунуло, зникало б за мить після появи. Прапорець
   * закриває вікно, доки команда в польоті.
   */
  #moving = false;

  /**
   * Куди лягає картка в новій колонці.
   *
   * Порядок дошки — дата, тож місце обчислюється, а не вигадується: після
   * наступного завантаження картка має лишитися там, куди її поклали зараз.
   * `createdAt` приходить у ISO, а він порівнюється як рядок.
   *
   * Межа: колонка може бути завантажена не вся. Якщо картка за датою належить
   * до ще не взятої сторінки, вона стане останньою з видимих — а після
   * перезавантаження поїде на свою сторінку. Домальовувати сторінки заради
   * цього дорожче, ніж коштує сама неточність.
   */
  #insertByDate(rows: RemarkRow[], row: RemarkRow): RemarkRow[] {
    const desc = this.$root.$query.sortDir === "desc";
    const at = rows.findIndex((r) =>
      desc ? r.createdAt < row.createdAt : r.createdAt > row.createdAt
    );
    return at < 0 ? [...rows, row] : [...rows.slice(0, at), row, ...rows.slice(at)];
  }

  async #moveTo(row: RemarkRow, target: string): Promise<void> {
    // Перенос у свою ж колонку — не подія: порядку всередині дошка не веде,
    // тож писати нічого. Без цієї перевірки кожне промазане перетягування
    // коштувало б запиту.
    if (!target || target === row.status) return;
    // Другий перенос, поки перший у польоті, дав би дві відповіді на одну
    // дошку — і остання перемалювала б результат першої, яку користувач уже
    // побачив. Черги тут не треба: дія коротка, а відмова від неї помітна.
    if (this.#moving) return;

    const source = this.$root.columns.find((c) => c.key === row.status);
    const destination = this.$root.columns.find((c) => c.key === target);
    if (!source || !destination) return;

    // Місце в СВОЇЙ колонці запам'ятовуємо до переносу: повертати картку на
    // інший рядок означало б, що невдалий перенос усе-таки щось змінив.
    const from = source.rows.findIndex((r) => r.id === row.id);
    if (from < 0) return;
    const moved: RemarkRow = { ...row, status: target };

    source.rows = source.rows.filter((r) => r.id !== row.id);
    source.total -= 1;
    destination.rows = this.#insertByDate(destination.rows, moved);
    destination.total += 1;
    this.pendingId = row.id;

    this.#moving = true;
    try {
      const env = await this.run("answer", { id: row.id, status: target, ownerDecision: true }, "save");
      if (env.ok) return;

      destination.rows = destination.rows.filter((r) => r.id !== moved.id);
      destination.total -= 1;
      const back: RemarkRow = { ...moved, status: source.key };
      source.rows = [...source.rows.slice(0, from), back, ...source.rows.slice(from)];
      source.total += 1;
    } finally {
      this.pendingId = null;
      this.#moving = false;
    }
  }

  /** Крок на сусідню колонку — те, що роблять кнопки ◀ ▶. */
  #moveBy = (row: RemarkRow, delta: -1 | 1) => {
    const index = REMARK_STATUSES.indexOf(row.status as typeof REMARK_STATUSES[number]);
    void this.#moveTo(row, REMARK_STATUSES[index + delta] ?? "");
  };

  // ── Перетягування ──────────────────────────────────────────────────────────
  //
  // Рідний HTML5 drag and drop: `draggable` на картці, `dragover`+`drop` на
  // колонці. Бібліотеки тут немає свідомо — браузер сам малює привид картки,
  // сам веде курсор і сам скасовує все по Esc.
  //
  // Записом віддається лише `id` (`text/plain`), а сам рядок лежить у полі:
  // перетягування живе всередині однієї вкладки, і серіалізувати запис, щоб
  // тут-таки його розібрати, було б роботою заради форми.

  /** Картка в руці — сам рядок потрібен, щоб знати, звідки вона. */
  #dragged: RemarkRow | null = null;

  /** Її id окремо й станом: від нього залежить вигляд самої картки. */
  @state() private draggingId: string | null = null;

  /** Колонка під курсором — від неї підсвітка, тому це стан. */
  @state() private dropTarget: string | null = null;

  /**
   * Картка, що вже переїхала на екрані, але ще чекає на базу. Одна: одночасний
   * другий перенос відсікає `#moving`.
   */
  @state() private pendingId: string | null = null;

  #dragStart = (e: DragEvent, row: RemarkRow) => {
    this.#dragged = row;
    this.draggingId = row.id;
    // Firefox не почне перетягування без записаних даних — навіть якщо вони
    // нікому не потрібні.
    e.dataTransfer?.setData("text/plain", row.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  };

  /**
   * `dragend` приходить ЗАВЖДИ — і після вдалого кидка, і після Esc, і коли
   * картку кинули повз дошку. Тому прибирання стану живе рівно тут, а не в
   * `drop`: інакше скасоване перетягування лишало б колонку підсвіченою.
   */
  #dragEnd = () => {
    this.#dragged = null;
    this.draggingId = null;
    this.dropTarget = null;
  };

  /**
   * `dragover` мусить скасувати умовчання — інакше `drop` не станеться взагалі.
   * Це і є місце, де колонка каже «сюди можна»: рідний аналог `canDrop`.
   */
  #dragOver = (e: DragEvent, key: string) => {
    const row = this.#dragged;
    if (!row || row.status === key || !this.may("edit")) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    if (this.dropTarget !== key) this.dropTarget = key;
  };

  /**
   * `dragleave` приходить і тоді, коли курсор перейшов на ДОЧІРНІЙ вузол тієї
   * ж колонки — підсвітка від цього блимала б на кожній картці. Рятує
   * `relatedTarget`: якщо курсор досі всередині колонки, ми її не покидали.
   */
  #dragLeave = (e: DragEvent, key: string) => {
    const to = e.relatedTarget as Node | null;
    if (to && (e.currentTarget as HTMLElement).contains(to)) return;
    if (this.dropTarget === key) this.dropTarget = null;
  };

  #drop = (e: DragEvent, key: string) => {
    e.preventDefault();
    const row = this.#dragged;
    this.#dragged = null;
    this.dropTarget = null;
    if (row) void this.#moveTo(row, key);
  };

  #openEdit = (id: string) => {
    bus.emit({ type: "tab.open", route: "admin/remark/edit", id });
  };

  // ── Відбір ─────────────────────────────────────────────────────────────────

  #setQuery = (key: "search" | "kind" | "openOnly", value: string) => {
    this.$root.$query[key] = value;
    void this.load();
  };

  /**
   * Порядок карток. Окремо від `#setQuery` навмисно: це не відбір — дошка від
   * нього нічого не ховає, тому «зняти відбір» його й не чіпає.
   */
  #setOrder = (value: string) => {
    this.$root.$query.sortDir = value === "asc" ? "asc" : "desc";
    void this.load();
  };

  /** Чи звужена дошка бодай чимось — від цього залежить текст порожнечі. */
  get #filtered(): boolean {
    const q = this.$root.$query;
    return !!(q.search || q.kind || q.openOnly);
  }

  #clearQuery = () => {
    const q = this.$root.$query;
    q.search = "";
    q.kind = "";
    q.openOnly = "";
    void this.load();
  };

  // ── Розмітка ───────────────────────────────────────────────────────────────

  static override styles: CSSResultGroup = [
    ...(BaseUI.styles as CSSResultGroup[]),
    css`
      /* Колонки в ряд, прокрутка — горизонтальна в смузі й вертикальна всередині
         кожної колонки. Саме так, а не однією прокруткою на всю дошку: шапка
         колонки з ліком мусить лишатися на місці, коли гортаєш картки. */
      .board {
        display: flex;
        gap: 8px;
        height: 100%;
        overflow-x: auto;
        padding: 8px;
      }
      .board-col {
        display: flex;
        flex-direction: column;
        flex: 0 0 15rem;
        min-height: 0;
        background-color: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: var(--radius-btn, 2px);
      }
      .board-col-head {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 5px 8px;
        border-bottom: 1px solid var(--app-border);
      }
      .board-col-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 6px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .board-card {
        background-color: var(--app-surface-strong);
        border: 1px solid var(--app-border);
        border-radius: var(--radius-btn, 2px);
        padding: 5px 7px;
      }
      .board-card:hover { border-color: var(--app-border-strong); }
      /* Картка в руці. Не прозорістю: під нею лежить текст, і приглушувати його
         прозорістю означає вести контраст у нікуди — тут потрібен інший фон,
         а не інша непрозорість. Пунктир каже те саме без здогадок про колір. */
      .board-card.dragging {
        background-color: var(--app-surface);
        border-style: dashed;
        border-color: var(--app-border-strong);
      }
      /* Картка вже на новому місці, але база ще не відповіла. Приглушена так
         само, як у руці, — це та сама картка й той самий незавершений рух;
         різні позначки для «несу» й «донесла, чекаю» довелося б розрізняти
         очима, а сенс у них один: ще не остаточно.
         Текст не гасимо: його читають, і 4.5:1 тут не менш обов'язковий, ніж
         деінде. Приглушений — фон і рамка. */
      .board-card.pending {
        background-color: var(--app-surface);
        border-style: dashed;
        border-color: var(--app-border-strong);
        cursor: progress;
      }
      /* Колонка під курсором. Тільки рамка й фон — розміри не міняються, інакше
         сусідні колонки посунулися б просто від пронесеної над ними картки. */
      .board-col.drop-target {
        background-color: var(--app-accent-soft);
        border-color: var(--app-accent);
      }
      /* Заголовок картки — кнопка, а не div з обробником: інакше запис не
         відкривається з клавіатури взагалі. Вигляд у неї власний, бо .btn теми
         задає висоту 24px і центрує текст, а тут потрібен звичайний абзац. */
      .board-card-title {
        display: block;
        width: 100%;
        text-align: left;
        background: none;
        border: 0;
        padding: 0;
        font: inherit;
        color: inherit;
        cursor: pointer;
      }
      .board-card-title:hover { text-decoration: underline; }
      .board-card-foot {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 4px;
      }
    `,
  ];

  #renderCard(row: RemarkRow, columnIndex: number): TemplateResult {
    // Стан картки читається з `verifiedAt`, а не зі `status`: закритість — факт
    // від людини, статус — заявка виконавця. Та сама пара, що в списку.
    const closed = !!row.verifiedAt;
    // Картка, що чекає на базу, не береться вдруге: другий перенос усе одно
    // відсік би `#moving`, але мовчки — а нерухома картка каже це сама.
    const pending = this.pendingId === row.id;
    const mayMove = this.may("edit") && !pending;
    return html`
      <div class="board-card ${this.draggingId === row.id ? "dragging" : ""} ${pending ? "pending" : ""}"
        aria-busy=${pending ? "true" : nothing}
        .draggable=${mayMove}
        @dragstart=${(e: DragEvent) => this.#dragStart(e, row)}
        @dragend=${this.#dragEnd}>
        <div class="flex items-baseline gap-1.5">
          <span class="text-muted tabular-nums text-xs">${row.id}</span>
          <span class="text-muted text-xs">${this.t(`remark.kind.${row.kind}`)}</span>
          ${closed
            ? html`<span class="badge badge-sm ${remarkBadge(row.status, row.verifiedAt)} ml-auto">
                ${this.t("remark.closed")}
              </span>`
            : ""}
        </div>

        <button class="board-card-title" title=${this.t("common.open")}
          @click=${() => this.#openEdit(row.id)}>${row.title}</button>

        <div class="board-card-foot">
          <span class="text-muted text-xs">${formatDate(row.createdAt, dateFormat.date)}</span>
          ${row.author ? html`<span class="text-muted text-xs truncate">${row.author}</span>` : ""}
          ${this.may("edit")
            ? html`
              <span class="ml-auto flex gap-0.5">
                <button class="btn btn-ghost btn-xs px-1"
                  title=${this.t("remark.moveLeft")} aria-label=${this.t("remark.moveLeft")}
                  ?disabled=${this.busy || columnIndex === 0}
                  @click=${() => this.#moveBy(row, -1)}>${icons.moveLeft}</button>
                <button class="btn btn-ghost btn-xs px-1"
                  title=${this.t("remark.moveRight")} aria-label=${this.t("remark.moveRight")}
                  ?disabled=${this.busy || columnIndex === REMARK_STATUSES.length - 1}
                  @click=${() => this.#moveBy(row, 1)}>${icons.moveRight}</button>
              </span>`
            : ""}
        </div>
      </div>
    `;
  }

  #renderColumn(column: RemarkBoardColumn, index: number): TemplateResult {
    const shown = column.rows.length;
    return html`
      <section class="board-col ${this.dropTarget === column.key ? "drop-target" : ""}"
        aria-label=${this.t(`remark.status.${column.key}`)}
        @dragover=${(e: DragEvent) => this.#dragOver(e, column.key)}
        @dragleave=${(e: DragEvent) => this.#dragLeave(e, column.key)}
        @drop=${(e: DragEvent) => this.#drop(e, column.key)}>
        <header class="board-col-head">
          <span class="text-sm">${this.t(`remark.status.${column.key}`)}</span>
          <span class="text-muted tabular-nums text-xs ml-auto">${column.total}</span>
        </header>
        <div class="board-col-body">
          ${column.rows.map((row) => this.#renderCard(row, index))}
          ${shown === 0
            ? html`<span class="text-muted text-xs p-1">${this.t("remark.boardColumnEmpty")}</span>`
            : ""}
          ${shown < column.total
            ? html`
              <button class="btn btn-xs" ?disabled=${this.busy} @click=${() => this.#showMore(column)}>
                ${this.t("remark.showMore")} (${column.total - shown})
              </button>`
            : ""}
        </div>
      </section>
    `;
  }

  /**
   * Панель відбору — угорі, а не праворуч.
   *
   * У списку відбори живуть у правій панелі, бо там вони довговічні й з'їдають
   * висоту, потрібну щільній таблиці. Дошка й так гортається вбік, а висоту в
   * неї їсть не панель, а самі колонки; права панель відрізала б від дошки цілу
   * колонку назавжди.
   */
  #renderToolbar(): TemplateResult {
    const q = this.$root.$query;
    return html`
      <div class="flex items-center gap-2 p-2 border-b border-base-300 flex-wrap no-print">
        <button class="btn btn-sm" ?disabled=${this.busy} @click=${() => this.load()}>
          ${icons.refresh} ${this.t("common.refresh")}
        </button>
        <span class="toolbar-sep"></span>

        <label class="flex items-center gap-2 text-sm">
          <span class="label">${this.t("common.search")}</span>
          <input class="input input-bordered input-sm w-48" type="search" .value=${q.search}
            @change=${(e: Event) => this.#setQuery("search", (e.target as HTMLInputElement).value)} />
        </label>

        <ui-select
          size="sm"
          label-position="left"
          .label=${this.t("remark.kind")}
          .placeholder=${this.t("remark.anyKind")}
          .options=${REMARK_KINDS.map((k) => ({ value: k, label: this.t(`remark.kind.${k}`) }))}
          .value=${q.kind}
          @value-changed=${(e: SelectEvent) => this.#setQuery("kind", e.detail.value)}
        ></ui-select>

        <ui-select
          size="sm"
          label-position="left"
          .label=${this.t("remark.order")}
          .options=${[
            { value: "desc", label: this.t("remark.orderNewest") },
            { value: "asc", label: this.t("remark.orderOldest") },
          ]}
          .value=${q.sortDir}
          @value-changed=${(e: SelectEvent) => this.#setOrder(e.detail.value)}
        ></ui-select>

        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" class="checkbox checkbox-xs"
            .checked=${q.openOnly === "1"}
            @change=${(e: Event) =>
              this.#setQuery("openOnly", (e.target as HTMLInputElement).checked ? "1" : "")} />
          <span>${this.t("remark.openOnly")}</span>
        </label>
      </div>
    `;
  }

  override render() {
    // Порожня дошка каже, ЧОМУ вона порожня: журнал зауважень порожній чи
    // відбір нічого не знайшов — дії тут протилежні (написати перше зауваження
    // або зняти відбір), і «немає даних» не називає жодної.
    const empty = this.$root.columns.every((c) => c.total === 0);
    return html`
      <div class="flex flex-col h-full">
        ${this.#renderToolbar()}
        <div class="px-2">${this.renderNotice()}</div>
        ${empty && this.#filtered
          ? html`
            <div class="p-3 text-sm text-muted flex items-center gap-2">
              ${this.t("common.notFound")}
              <button class="btn btn-xs" @click=${this.#clearQuery}>
                ${icons.clear} ${this.t("remark.clearFilters")}
              </button>
            </div>`
          : ""}
        <div class="board">
          ${this.$root.columns.map((column, index) => this.#renderColumn(column, index))}
        </div>
      </div>
    `;
  }
}
