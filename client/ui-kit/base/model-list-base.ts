import { type CSSResultGroup, html, css, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { type TArray, type TObject, type TUnknown, Type } from "@sinclair/typebox";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { can } from "@client/auth/session.ts";
import { tw } from "@client/shared/styles.ts";
import { formatDate } from "@client/shared/datetime.ts";
import { BaseUI } from "./base-ui.ts";
import { QuerySchema, TotalsSchema, type Query, type Totals } from "@client/shared/schema.ts";
import { buildRowsSheet, type ExportColumn } from "../report/rows-sheet.ts";
import { buildXlsx, downloadFile, safeFileName, XLSX_MIME } from "../report/xlsx.ts";
// Побічний імпорт — реєструє <ui-group-tree> для ієрархічних довідників.
import "../components/ui-group-tree.ts";

export type SortDir = "asc" | "desc";

/** Форма `$root` списку: службовий `$query` + дані `rows`/`totals`. */
export type ListRoot<Row> = { $query: Query; rows: Row[]; totals: Totals };

/**
 * Generic root-схема списку/пікера для `Value.Create`: форма рядка важлива лише
 * на рівні TS-типу (`Row`), а для ініціалізації достатньо порожнього `rows`.
 * Тож підкласам не потрібен власний конструктор чи `<Model>RootSchema`.
 * Спільна для `ModelListBase` та `ModelPickerBase`.
 */
export const listRootSchema: TObject<{
  $query: typeof QuerySchema;
  rows: TArray<TUnknown>;
  totals: typeof TotalsSchema;
}> = Type.Object({
  $query: QuerySchema,
  rows:   Type.Array(Type.Unknown()),
  totals: TotalsSchema,
});

/** Описание однієї колонки списку. */
export interface ListColumn<Row> {
  /** Ключ поля у рядку та значення sortBy для сервера. */
  key: string;
  /** Заголовок колонки — ключ локалізації або літерал (проходить через t()). */
  title: string;
  /** Ширина CSS, напр. "8rem". Без значення — гнучка колонка. */
  width?: string;
  align?: "left" | "right" | "center";
  /**
   * Поведінка тексту в комірці:
   *  - "wrap" (за замовч.) — переноситься на кілька рядків;
   *  - "nowrap" — один рядок без переносу;
   *  - "ellipsis" — один рядок, обрізається з "…" (потребує `width`).
   */
  overflow?: "wrap" | "nowrap" | "ellipsis";
  /** Приглушений текст (вторинні дані: коди, дати). */
  muted?: boolean;
  /**
   * Шаблон дати/часу для комірки — значення з БД приходить в ISO, а показати
   * треба по-людськи. Приклади: `dateFormat.date` ("DD.MM.YY"),
   * `dateFormat.dateTime`, `"MM.YYYY"`. Див. `client/shared/datetime.ts`.
   * Ігнорується, якщо задано `render`.
   */
  format?: string;
  sortable?: boolean;
  /** Нативний tooltip комірки (атрибут title). */
  tooltip?: (row: Row) => string;
  /**
   * Текст комірки для вивантаження в Excel. Потрібен колонкам, де `render`
   * малює не текст (посилання, бейдж, вкладений об'єкт): у файл піде рядок,
   * а не розмітка. Без нього береться `row[key]`, якщо це скаляр.
   */
  exportText?: (row: Row) => string;
  /**
   * `false` — колонку не вивантажувати. Колонка без заголовка (кнопки дій) і
   * так не потрапляє у файл: заголовок — ознака того, що колонка з даними.
   */
  export?: boolean;
  /**
   * Кастомний рендер комірки. За замовчуванням — row[key].
   * Сюди можна повернути кнопки, бейджі, дворядковий вміст тощо.
   * Для кнопок гортай обробник через `stopRow(...)`, щоб клік не виділяв рядок.
   */
  render?: (row: Row) => TemplateResult | string;
}

export interface ListTotals {
  count: number;
  page: number;
  pageSize: number;
}

/** CSS-клас вирівнювання для th/td. */
export function alignClass(align?: string): string {
  return align === "right" ? "text-right" : align === "center" ? "text-center" : "";
}

/** Inline-стиль комірки: перенос/обрізка тексту + max-width для ellipsis. */
export function cellStyle<Row>(col: ListColumn<Row>): string {
  const parts: string[] = [];
  if (col.overflow === "nowrap") parts.push("white-space:nowrap");
  if (col.overflow === "ellipsis") {
    parts.push("white-space:nowrap", "overflow:hidden", "text-overflow:ellipsis");
    if (col.width) parts.push(`max-width:${col.width}`);
  }
  return parts.join(";");
}

/**
 * Обгортка обробника події в комірці, що зупиняє спливання —
 * клік по кнопці в рядку не виділяє/не активує рядок.
 * Приклад: `@click=${stopRow(() => this.openEdit(row.id))}`
 */
export function stopRow(fn: (e: Event) => void): (e: Event) => void {
  return (e: Event) => { e.stopPropagation(); fn(e); };
}

/** Дворядкова комірка: основний текст + приглушений другий рядок. */
export function twoLine(primary: unknown, secondary?: unknown): TemplateResult {
  return html`
    <div class="leading-tight">
      <div>${primary}</div>
      ${secondary != null && secondary !== ""
        ? html`<div class="text-xs text-base-content/50">${secondary}</div>`
        : ""}
    </div>
  `;
}

const icon = {
  create: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  open: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  delete: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  refresh: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  excel: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="19"/><line x1="15" y1="13" x2="9" y2="19"/></svg>`,
  // Розмір і прозорість — атрибутами SVG, як у решти іконок вище: inline-SVG у
  // shadow DOM не має залежати від того, чи Tailwind згенерував `h-4`/`opacity-50`.
  search: html`<svg width="14" height="14" opacity="0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
  toGroup: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M12 17v-5"/><path d="m9 14.5 3-3 3 3"/></svg>`,
};

/**
 * Базовий клас для типової форми списку моделі.
 *
 * Підклас зобов'язаний задати `model`, `columns` та `editRoute`.
 * Уся логіка (завантаження, серверне сортування, пагінація, пошук,
 * вибір рядка, видалення, реакція на model.changed) реалізована тут.
 *
 * Точки розширення для майбутніх варіантів форм:
 *  - `extraPayload()`        — додаткові поля у payload (панель фільтрів для документів)
 *  - `renderHeaderArea()`    — повноширинна зона між тулбаром і таблицею (фільтри, хлібні крихти груп)
 *  - `renderToolbarExtra()`  — додаткові кнопки тулбару
 *  - `rowClass()`            — додаткові класи рядка (підсвітка статусів)
 *  - `onActivate()`          — дія по подвійному кліку (за замовч. — відкрити edit)
 */
export abstract class ModelListBase<Row extends { id: string }> extends BaseUI<ListRoot<Row>> {
  static override styles: CSSResultGroup = [tw, css`
    tr.selected td { background: #cfe0f3 !important; color: var(--color-base-content, #243746) !important; }
    th.sortable { cursor: pointer; user-select: none; }
    .group-panel { background: var(--app-surface, #f6f8fa); }
    .group-panel-frame { border: 1px solid var(--app-border-strong, #98a7b4); }
  `];

  // ── Обов'язкові для підкласу (`model` успадковано з BaseUI) ────────────────
  protected abstract columns: ListColumn<Row>[];
  protected abstract editRoute: string | null;

  // Список не має незбережених змін: його $root оновлюється кожним load.
  protected override dirtyTracking = false;

  // ── Опційні налаштування ──────────────────────────────────────────────────
  protected listCommand = "list";
  /** Журнал або інший незмінний список: залишає пошук, сортування й Excel. */
  protected readonly = false;
  /**
   * Ієрархічний довідник (патерн A2v10): основну площу займає плоский список
   * із пагінацією, праворуч — дерево груп із чекбоксами-фільтром, у тулбарі —
   * «До групи…» для виділеного рядка. Вимагає `"hierarchy": true` у
   * manifest.json моделі (генерує SQL-команди груп) — див. ui-group-tree.ts.
   */
  protected hierarchy = false;
  protected defaultSortBy = "";
  protected defaultSortDir: SortDir = "asc";
  protected pageSizeOptions = [10, 20, 50, 100];
  /**
   * Стеля вивантаження в Excel. Не захист бази (сервер віддасть скільки
   * попросили), а захист браузера: файл збирається в пам'яті вкладки. Що не
   * влізло — про це чесно повідомляється банером, а не мовчазно зникає.
   */
  protected exportRowLimit = 10_000;

  // ── Стан ──────────────────────────────────────────────────────────────────
  /** Виділений рядок — клієнтський транзиент, не частина data-контракту. */
  @state() protected selectedId = "";

  /** Збирається файл вивантаження. Окремо від `running`: запит той самий (`list`). */
  @state() private exporting = false;

  /** Відмічені групи дерева (ієрархія). Транзиент, як і selectedId. */
  @state() protected groupIds: string[] = [];

  /** Діалог «перемістити до групи»: null — ціль не вибрана, "" — корінь. */
  @state() private moveOpen = false;
  @state() private moveTarget: string | null = null;

  // Проєкції старих імен полів на службовий `$query` та дані `$root`.
  // Логіка/рендер нижче лишаються без змін; читання трекає SignalWatcher,
  // запис у deep-проксі перемальовує.
  protected get rows(): Row[] { return this.$root.rows; }
  protected get total(): number { return this.$root.totals.count; }
  /**
   * Спіннер на місці таблиці — лише для першого завантаження (порожній список).
   * Перезавантаження (сортування/пагінація/пошук) показує глобальна смужка
   * на тулбарі (loading.start/end у data-service), тож таблиця не блимає.
   */
  protected get loading(): boolean {
    return this.running === this.listCommand && this.$root.rows.length === 0;
  }

  protected get search(): string { return this.$root.$query.search; }
  protected set search(v: string) { this.$root.$query.search = v; }
  protected get page(): number { return this.$root.$query.page; }
  protected set page(v: number) { this.$root.$query.page = v; }
  protected get pageSize(): number { return this.$root.$query.pageSize; }
  protected set pageSize(v: number) { this.$root.$query.pageSize = v; }
  protected get sortBy(): string { return this.$root.$query.sortBy; }
  protected set sortBy(v: string) { this.$root.$query.sortBy = v; }
  protected get sortDir(): SortDir { return this.$root.$query.sortDir as SortDir; }
  protected set sortDir(v: SortDir) { this.$root.$query.sortDir = v; }

  constructor() { super(listRootSchema); }

  // ReturnType<typeof setTimeout>, а не number: пакет типізується і з DOM-lib, і з
  // @types/node (його тягне пресет `vite.ts` того ж пакета), а там setTimeout
  // повертає Timeout, не number.
  #searchTimer?: ReturnType<typeof setTimeout>;
  #unsub?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    if (!this.sortBy) this.sortBy = this.defaultSortBy || this.columns[0]?.key || "";
    this.sortDir = this.defaultSortDir;
    this.#unsub = bus.on("model.changed", (msg) => {
      if (msg.model === this.model) this.load();
    });
    this.load();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#unsub?.();
  }

  // ── Точки розширення (override за потреби) ─────────────────────────────────
  /** Додаткові поля payload — напр. значення панелі фільтрів. */
  protected extraPayload(): Record<string, unknown> { return {}; }
  /** Повноширинна зона під тулбаром: фільтри, навігація по групах. */
  protected renderHeaderArea(): TemplateResult | string { return ""; }
  /** Додаткові кнопки тулбару (між стандартними діями та пошуком). */
  protected renderToolbarExtra(): TemplateResult | string { return ""; }
  /** Додаткові CSS-класи рядка (підсвітка за статусом тощо). */
  protected rowClass(_row: Row): string { return ""; }
  /**
   * Inline-стиль рядка (колір тексту/фону за статусом). Застосовується до
   * кожної `<td>`, щоб перекрити zebra; виділення рядка має пріоритет.
   * Напр.: `return row.isActive === false ? "color:#9ca3af" : "";`
   */
  protected rowStyle(_row: Row): string { return ""; }
  /** Підпис рядка для діалогу видалення. */
  protected rowLabel(row: Row): string {
    return (row as Record<string, unknown>).name as string ?? row.id;
  }
  /** Дія активації рядка (подвійний клік). За замовчуванням — відкрити edit. */
  protected onActivate(row: Row) {
    if (this.editRoute) this.openEdit(row.id);
  }

  // ── Логіка ──────────────────────────────────────────────────────────────────
  protected async load() {
    // payload = службовий $query (+ розширення підкласу).
    // Відповідь `{ rows, totals[, $query] }` домержується у $root через assign:
    // якщо БД поверне ефективний $query — він віддзеркалиться назад.
    const env = await this.run<Partial<ListRoot<Row>>>(this.listCommand, {
      ...this.$root.$query,
      ...(this.hierarchy ? { groupIds: this.groupIds } : {}),
      ...this.extraPayload(),
    });
    if (env.ok && env.data) this.assign(env.data);
  }

  /** Перезавантаження з першої сторінки (виклик з підкласу при зміні фільтрів). */
  protected reload() { this.page = 1; this.load(); }

  // ── Вивантаження в Excel ────────────────────────────────────────────────────

  /**
   * Колонки, що йдуть у файл. Колонка без заголовка — це кнопки дій, у файлі
   * їй немає чого робити; `export: false` прибирає колонку явно.
   */
  private exportColumns(): ExportColumn<Row>[] {
    return this.columns
      .filter((col) => col.export !== false && t(col.title).trim() !== "")
      .map((col) => ({
        title: t(col.title),
        align: col.align,
        value: (row: Row) => this.exportValue(row, col),
      }));
  }

  /** Значення комірки для файлу — той самий вміст, що на екрані, але текстом. */
  private exportValue(row: Row, col: ListColumn<Row>): string | number {
    if (col.exportText) return col.exportText(row);

    const value = (row as Record<string, unknown>)[col.key];
    if (value == null) return "";
    if (col.format) return formatDate(value as string, col.format) || String(value);
    if (typeof value === "boolean") return value ? t("common.yes") : "";
    if (typeof value === "number" || typeof value === "string") return value;
    // Об'єкт (напр. `counterparty`) без exportText у файл не поміститься —
    // краще порожньо, ніж "[object Object]".
    return "";
  }

  /** Ім'я аркуша й файлу: назва моделі за конвенцією `<model>.titleMany`. */
  private exportTitle(): string {
    const key = `${this.model}.titleMany`;
    const title = t(key);
    return title === key ? this.model : title;
  }

  /**
   * Вивантажити список у .xlsx. Іде **весь відбір**, а не поточна сторінка:
   * повторюється та сама команда `list` з тими самими фільтрами й `pageSize` на
   * весь результат. Екран при цьому не чіпається — відповідь у `$root` не
   * зливається, інакше після вивантаження в таблиці опинилися б усі рядки.
   */
  protected async exportExcel() {
    this.exporting = true;
    try {
      const limit = Math.min(Math.max(this.total, this.rows.length), this.exportRowLimit);
      const env = await this.run<Partial<ListRoot<Row>>>(this.listCommand, {
        ...this.$root.$query,
        ...(this.hierarchy ? { groupIds: this.groupIds } : {}),
        ...this.extraPayload(),
        page: 1,
        pageSize: limit,
      });

      const rows = (env.ok && env.data?.rows) || [];
      if (rows.length === 0) return;

      const title = this.exportTitle();
      const sheet = buildRowsSheet(this.exportColumns(), rows as Row[]);
      downloadFile(buildXlsx(title, sheet), `${safeFileName(title)}.xlsx`, XLSX_MIME);

      // Скільки рядків справді у файлі, стільки й кажемо: це покриває і власну
      // стелю, і випадок, коли `list` моделі сам обмежує сторінку. Ставиться
      // ПІСЛЯ run() — той перезаписує `messages` відповіддю сервера.
      if (rows.length < this.total) {
        this.messages = [{
          type: "warn",
          text: t("common.exportTruncated").replace("{count}", String(rows.length)),
        }];
      }
    } finally {
      this.exporting = false;
    }
  }

  protected openEdit(id: string | null) {
    if (!this.editRoute) return;
    bus.emit({ type: "tab.open", route: this.editRoute, id });
  }

  /**
   * Insert від оболонки (`ShortcutTarget`) — те саме, що кнопка «Створити»,
   * і з тими самими умовами: є куди відкривати й список не тільки для читання.
   */
  hotkeyCreate(): void {
    // can — щоб клавіша не робила того, чого кнопки на екрані немає.
    if (this.readonly || !this.editRoute || !can(this.model, "create")) return;
    this.openEdit(null);
  }

  // ── Ієрархія: фільтр дерева і перенесення до групи ─────────────────────────

  #onGroupsChanged(e: CustomEvent<{ ids: string[] }>) {
    this.groupIds = e.detail.ids;
    this.reload();
  }

  #openMoveDialog() {
    if (!this.selectedId) return;
    this.moveTarget = null;
    this.moveOpen = true;
  }

  async #confirmMove() {
    const target = this.moveTarget;
    this.moveOpen = false;
    if (target === null || !this.selectedId) return;
    // kind:"save" → model.changed → підписка перезавантажує список.
    await this.run("moveToGroup", {
      id: this.selectedId,
      groupId: target === "" ? null : target,
    }, "save");
  }

  protected async deleteSelected() {
    if (!this.selectedId) return;
    const row = this.rows.find((r) => r.id === this.selectedId);
    // bus.confirm, а не нативний confirm(): той блокує вкладку й показує
    // адресу сайту. Кнопка підтвердження — «Видалити», не абстрактне «Так».
    const confirmed = await bus.confirm(
      `${t("common.confirmDelete")} "${row ? this.rowLabel(row) : ""}"?`,
      "common.delete",
      "warning",
    );
    if (!confirmed) return;
    // kind:"save" → data-service емітить model.changed → підписка нижче перезавантажує.
    await this.run("delete", { id: this.selectedId }, "save");
    this.selectedId = "";
  }

  #onSearch(e: Event) {
    this.search = (e.target as HTMLInputElement).value;
    this.page = 1;
    clearTimeout(this.#searchTimer);
    this.#searchTimer = setTimeout(() => this.load(), 300);
  }

  #setSort(col: ListColumn<Row>) {
    if (!col.sortable) return;
    if (this.sortBy === col.key) {
      this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
    } else {
      this.sortBy = col.key;
      this.sortDir = "asc";
    }
    this.page = 1;
    this.load();
  }

  #totalPages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); }

  #sortIcon(col: ListColumn<Row>) {
    if (!col.sortable) return "";
    if (this.sortBy !== col.key) return html`<span class="opacity-20">↕</span>`;
    return this.sortDir === "asc" ? html`<span>↑</span>` : html`<span>↓</span>`;
  }

  #cell(row: Row, col: ListColumn<Row>) {
    if (col.render) return col.render(row);
    const v = (row as Record<string, unknown>)[col.key];
    if (v == null) return "";
    // ISO з БД → шаблон колонки; нерозбірливе значення лишаємо як є
    if (col.format) return formatDate(v as string, col.format) || String(v);
    return String(v);
  }

  // ── Рендер ──────────────────────────────────────────────────────────────────
  override render(): TemplateResult {
    const totalPages = this.#totalPages();

    return html`
      <div class="flex flex-col h-full">

        <!-- Тулбар -->
        <div class="flex items-center gap-2 p-2 border-b border-base-300 flex-wrap">
          ${this.readonly ? nothing : html`
            ${can(this.model, "create")
              ? html`
                <button class="btn btn-sm btn-primary" @click=${() => this.openEdit(null)}>
                  ${icon.create} ${t("common.create")}
                </button>`
              : nothing}
            <button class="btn btn-sm" ?disabled=${!this.selectedId}
              @click=${() => this.openEdit(this.selectedId)}>
              ${icon.open} ${t("common.open")}
            </button>
            ${can(this.model, "delete")
              ? html`
                <button class="btn btn-sm btn-error btn-outline" ?disabled=${!this.selectedId}
                  @click=${this.deleteSelected}>
                  ${icon.delete} ${t("common.delete")}
                </button>`
              : nothing}
          `}
          ${this.hierarchy && can(this.model, "edit")
            ? html`
              <button class="btn btn-sm" ?disabled=${!this.selectedId} @click=${this.#openMoveDialog}>
                ${icon.toGroup} ${t("groups.toGroup")}
              </button>`
            : nothing}
          <button class="btn btn-sm" ?disabled=${this.exporting || this.total === 0}
            @click=${this.exportExcel}>
            ${this.exporting
              ? html`<span class="loading loading-spinner loading-xs"></span>`
              : icon.excel}
            ${t("common.exportExcel")}
          </button>
          ${this.renderToolbarExtra()}
          <div class="flex-1"></div>
          <label class="input input-sm flex items-center gap-2">
            ${icon.search}
            <input type="text" class="grow" placeholder="${t("common.search")}..."
              .value=${this.search} @input=${this.#onSearch} />
          </label>
          <button class="btn btn-sm btn-ghost" @click=${() => this.load()}>
            ${icon.refresh} ${t("common.refresh")}
          </button>
        </div>

        <!-- Помилки команд і попередження (напр. обрізане вивантаження).
             Без цього банера відмова сервера в списку не видно взагалі. -->
        <div class="px-2 empty:hidden">${this.renderNotice()}</div>

        ${this.renderHeaderArea()}

        <!-- Основна площа: таблиця (+ дерево груп праворуч для ієрархії) -->
        <div class="flex flex-1 min-h-0 ${this.hierarchy ? "pr-3" : ""}">

        <!-- Таблиця -->
        <div class="flex-1 overflow-auto px-2">
          ${this.loading
            ? html`<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>`
            : this.rows.length === 0
              ? html`<div class="text-center p-8 text-base-content/40">${t("common.noData")}</div>`
              : html`
                <table class="table table-sm table-zebra w-full">
                  <thead class="sticky top-0 bg-base-100 z-10">
                    <tr>
                      ${this.columns.map((col) => html`
                        <th
                          class="${col.sortable ? "sortable" : ""} ${alignClass(col.align)}"
                          style=${col.width ? `width:${col.width}` : ""}
                          @click=${() => this.#setSort(col)}
                        >
                          ${t(col.title)} ${this.#sortIcon(col)}
                        </th>
                      `)}
                    </tr>
                  </thead>
                  <tbody>
                    ${this.rows.map((row) => html`
                      <tr
                        class="${this.readonly ? "" : "cursor-pointer hover"} ${row.id === this.selectedId ? "selected" : ""} ${this.rowClass(row)}"
                        @click=${() => { if (!this.readonly) this.selectedId = row.id; }}
                        @dblclick=${() => { if (!this.readonly) this.onActivate(row); }}
                      >
                        ${this.columns.map((col) => html`
                          <td class="${col.muted ? "text-base-content/60" : ""} ${alignClass(col.align)}"
                            style=${[cellStyle(col), this.rowStyle(row)].filter(Boolean).join(";")}
                            title=${col.tooltip ? col.tooltip(row) : nothing}>
                            ${this.#cell(row, col)}
                          </td>
                        `)}
                      </tr>
                    `)}
                  </tbody>
                </table>
              `}
        </div>

        ${this.hierarchy
          ? html`
            <aside class="group-panel w-60 shrink-0 border-l border-base-300 flex flex-col min-h-0">
              <div class="group-panel-frame flex-1 min-h-0 overflow-auto">
                  <ui-group-tree .model=${this.model} mode="filter"
                    @groups-changed=${this.#onGroupsChanged}
                    @groups-mutated=${() => this.load()}>
                  </ui-group-tree>
                </div>
            </aside>`
          : nothing}
        </div>

        ${this.moveOpen
          ? html`
            <div class="app-dialog-overlay"
              @keydown=${(e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); this.moveOpen = false; } }}
              @click=${(e: Event) => { if (e.target === e.currentTarget) this.moveOpen = false; }}>
              <div class="app-dialog w-96">
                <div class="app-dialog-title">
                  <span>${t("groups.moveTitle")}</span>
                  <span class="app-dialog-close" @click=${() => { this.moveOpen = false; }}>×</span>
                </div>
                <div class="app-dialog-body">
                  <div class="max-h-72 overflow-auto border border-base-300 rounded">
                    <ui-group-tree .model=${this.model} mode="select" show-root
                      @group-selected=${(e: CustomEvent<{ id: string }>) => { this.moveTarget = e.detail.id; }}>
                    </ui-group-tree>
                  </div>
                </div>
                <div class="app-dialog-actions">
                  <button class="btn btn-sm" @click=${() => { this.moveOpen = false; }}>
                    ${t("common.cancel")}
                  </button>
                  <button class="btn btn-sm btn-primary" ?disabled=${this.moveTarget === null}
                    @click=${this.#confirmMove}>
                    ${t("common.select")}
                  </button>
                </div>
              </div>
            </div>`
          : nothing}

        <!-- Пагінація -->
        <div class="flex items-center justify-between px-3 py-2 border-t border-base-300 text-sm">
          <span class="text-base-content/50">${this.total} ${t("common.records")}</span>
          <div class="join">
            <button class="join-item btn btn-xs" ?disabled=${this.page <= 1}
              @click=${() => { this.page = 1; this.load(); }}>«</button>
            <button class="join-item btn btn-xs" ?disabled=${this.page <= 1}
              @click=${() => { this.page--; this.load(); }}>‹</button>
            <button class="join-item btn btn-xs btn-disabled pointer-events-none">
              ${this.page} / ${totalPages}
            </button>
            <button class="join-item btn btn-xs" ?disabled=${this.page >= totalPages}
              @click=${() => { this.page++; this.load(); }}>›</button>
            <button class="join-item btn btn-xs" ?disabled=${this.page >= totalPages}
              @click=${() => { this.page = totalPages; this.load(); }}>»</button>
          </div>
          <select class="select select-xs w-20"
            @change=${(e: Event) => {
              this.pageSize = Number((e.target as HTMLSelectElement).value);
              this.page = 1;
              this.load();
            }}>
            ${this.pageSizeOptions.map((n) => html`
              <option value=${n} ?selected=${n === this.pageSize}>${n}</option>
            `)}
          </select>
        </div>
      </div>
    `;
  }
}
