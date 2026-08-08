import { type CSSResultGroup, html, css, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { can } from "@client/auth/session.ts";
import { formatDate } from "@client/shared/datetime.ts";
import { QueryTableBase } from "./query-table-base.ts";
import type { ListColumn, ListRoot } from "./table-contract.ts";
import { buildRowsSheet, type ExportColumn } from "../report/rows-sheet.ts";
import { buildXlsx, downloadFile, safeFileName, XLSX_MIME } from "../report/xlsx.ts";
// Побічний імпорт — реєструє <ui-group-tree> для ієрархічних довідників.
import "../components/ui-group-tree.ts";
import { icons } from "../icons.ts";

/**
 * Контракт таблиці переїхав у `table-contract.ts` — щоб діалог підбору не тягнув
 * за собою цей модуль разом із деревом груп і вивантаженням в Excel. Назовні
 * старий шлях лишається чинним: на нього посилаються екрани застосунків, скіли
 * й документація, а `@altera/client` — опублікований пакет.
 *
 * Ре-експорт поіменний, а не `export *`: JSR перевіряє типи опублікованої
 * поверхні, і явний список не дає їй стати «повільною».
 */
export { alignClass, cellStyle, listRootSchema, stopRow, twoLine } from "./table-contract.ts";
export type { ListColumn, ListRoot, ListTotals, SortDir } from "./table-contract.ts";

/**
 * Базовий клас для типової форми списку моделі.
 *
 * Підклас зобов'язаний задати `model`, `columns` та `editRoute`.
 * Механіка таблиці — завантаження, серверне сортування, пошук, пагінація,
 * клавіатура рядків — у спільній основі `QueryTableBase`; тут лишається те,
 * що робить зі списку саме ЕКРАН: створення й видалення записів, ієрархія
 * груп, вивантаження в Excel і реакція на `model.changed`.
 *
 * Точки розширення:
 *  - `extraPayload()`        — додаткові поля у payload (панель фільтрів для документів)
 *  - `renderHeaderArea()`    — повноширинна зона між тулбаром і таблицею (фільтри, хлібні крихти груп)
 *  - `renderToolbarExtra()`  — додаткові кнопки тулбару
 *  - `rowClass()` / `rowStyle()` — підсвітка рядків за статусом
 *  - `onActivate()`          — дія по подвійному кліку й Enter (за замовч. — відкрити edit)
 */
export abstract class ModelListBase<Row extends { id: string }> extends QueryTableBase<Row> {
  static override styles: CSSResultGroup = [
    ...(QueryTableBase.styles as CSSResultGroup[]),
    css`
      .group-panel { background: var(--app-surface, #f6f8fa); }
      .group-panel-frame { border: 1px solid var(--app-border-strong, #98a7b4); }
    `,
  ];

  // ── Обов'язкові для підкласу (`model` успадковано з BaseUI) ────────────────
  protected abstract override columns: ListColumn<Row>[];
  protected abstract editRoute: string | null;

  // ── Опційні налаштування ──────────────────────────────────────────────────
  protected listCommand = "list";
  protected override get loadCommand(): string { return this.listCommand; }

  /**
   * Ієрархічний довідник (патерн A2v10): основну площу займає плоский список
   * із пагінацією, праворуч — дерево груп із чекбоксами-фільтром, у тулбарі —
   * «До групи…» для виділеного рядка. Вимагає `"hierarchy": true` у
   * manifest.json моделі (генерує SQL-команди груп) — див. ui-group-tree.ts.
   */
  protected hierarchy = false;
  /**
   * Стеля вивантаження в Excel. Не захист бази (сервер віддасть скільки
   * попросили), а захист браузера: файл збирається в пам'яті вкладки. Що не
   * влізло — про це чесно повідомляється банером, а не мовчазно зникає.
   */
  protected exportRowLimit = 10_000;

  /**
   * Спіннер на місці таблиці — лише для першого завантаження (порожній список).
   * Перезавантаження (сортування/пагінація/пошук) показує глобальна смужка
   * на тулбарі (loading.start/end у data-service), тож таблиця не блимає.
   * У діалозі вибору смужки не видно, тому там лишається типова поведінка основи.
   */
  protected override get loading(): boolean {
    return this.running === this.loadCommand && this.$root.rows.length === 0;
  }

  // ── Стан ──────────────────────────────────────────────────────────────────
  /** Збирається файл вивантаження. Окремо від `running`: запит той самий (`list`). */
  @state() private exporting = false;

  /** Відмічені групи дерева (ієрархія). Транзиент, як і selectedId. */
  @state() protected groupIds: string[] = [];

  /** Діалог «перемістити до групи»: null — ціль не вибрана, "" — корінь. */
  @state() private moveOpen = false;
  @state() private moveTarget: string | null = null;

  #unsub?: () => void;

  override connectedCallback() {
    // Основа виставляє сортування за замовчуванням і робить перше завантаження.
    super.connectedCallback();
    this.#unsub = bus.on("model.changed", (msg) => {
      if (msg.model === this.model) this.load();
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#unsub?.();
  }

  /**
   * До `$query` додається фільтр дерева груп. Перекрито тут, а не через
   * `extraPayload()`: той належить ЗАСТОСУНКУ (панель фільтрів екрана), і якби
   * ієрархія жила в ньому, перший же `override extraPayload()` мовчки прибрав
   * би `groupIds`.
   */
  protected override loadPayload(): Record<string, unknown> {
    return {
      ...this.queryPayload(),
      ...(this.hierarchy ? { groupIds: this.groupIds } : {}),
      ...this.extraPayload(),
    };
  }

  // ── Точки розширення ──────────────────────────────────────────────────────
  /** Повноширинна зона під тулбаром: фільтри, навігація по групах. */
  protected renderHeaderArea(): TemplateResult | string { return ""; }
  /** Підпис рядка для діалогу видалення. */
  protected rowLabel(row: Row): string {
    return (row as Record<string, unknown>).name as string ?? row.id;
  }
  /** Дія активації рядка (подвійний клік, Enter). За замовчуванням — відкрити edit. */
  protected override onActivate(row: Row) {
    if (this.editRoute) this.openEdit(row.id);
  }

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
      const env = await this.run<Partial<ListRoot<Row>>>(this.loadCommand, {
        ...this.loadPayload(),
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

  // ── Позначка на видалення ─────────────────────────────────────────────────

  /** Рядок під курсором — потрібен, щоб знати, позначений він чи ні. */
  protected get selectedRow(): Row | undefined {
    return this.rows.find((r) => r.id === this.selectedId);
  }

  /** Чи має модель позначку взагалі: SQL віддає `isDeleted` лише таким. */
  protected get hasDeletionMark(): boolean {
    return this.rows.some((r) => "isDeleted" in (r as Record<string, unknown>));
  }

  /** Курсор стоїть на позначеному записі — тоді кнопка знімає позначку. */
  protected get selectedIsDeleted(): boolean {
    return (this.selectedRow as { isDeleted?: boolean } | undefined)?.isDeleted === true;
  }

  /**
   * Позначити на видалення. Запис НЕ зникає: він лишається в списку зі значком,
   * інакше «видалив не те» не мало б вороття, а саме заради цього позначка й
   * існує. Фізичне видалення — окрема операція, і вона мусить перевіряти
   * посилання.
   */
  protected async deleteSelected() {
    if (!this.selectedId) return;
    const row = this.selectedRow;
    // bus.confirm, а не нативний confirm(): той блокує вкладку й показує
    // адресу сайту. Кнопка підтвердження називає дію, а не абстрактне «Так».
    const confirmed = await bus.confirm(
      `${t("common.confirmMarkDeleted")} "${row ? this.rowLabel(row) : ""}"?`,
      "common.markDeleted",
      "warning",
    );
    if (!confirmed) return;
    // kind:"save" → data-service емітить model.changed → підписка вище перезавантажує.
    await this.run("delete", { id: this.selectedId }, "save");
  }

  /** Зняти позначку. Підтвердження не питаємо: дія неруйнівна. */
  protected async undeleteSelected() {
    if (!this.selectedId) return;
    await this.run("undelete", { id: this.selectedId }, "save");
  }

  // ── Стан рядка у службовій колонці ────────────────────────────────────────

  protected override get statusColumn(): boolean {
    return this.rows.some((r) => {
      const rec = r as Record<string, unknown>;
      return "isDeleted" in rec || "isPosted" in rec;
    });
  }

  protected override renderRowStatus(row: Row): TemplateResult {
    const rec = row as { isDeleted?: boolean; isPosted?: boolean };
    // Порядок перевірок = порядок важливості: позначка на видалення перекриває
    // проведення, бо вона про долю запису, а не про його стан в обліку.
    if (rec.isDeleted) {
      return html`<span title=${t("common.statusDeleted")}>${icons.recordDeleted}</span>`;
    }
    if (rec.isPosted) {
      return html`<span title=${t("common.statusPosted")}>${icons.recordPosted}</span>`;
    }
    return html`<span title=${t("common.statusNew")}>${icons.recordNew}</span>`;
  }

  // ── Рендер ──────────────────────────────────────────────────────────────────

  /** Стандартні дії списку. Кнопки застосунку йдуть після них — `renderToolbarExtra()`. */
  protected override renderToolbarActions(): TemplateResult {
    return html`
      ${this.readonly ? nothing : html`
        ${can(this.model, "create")
          ? html`
            <button class="btn btn-sm btn-primary" @click=${() => this.openEdit(null)}>
              ${icons.create} ${t("common.create")}
            </button>`
          : nothing}
        <button class="btn btn-sm" ?disabled=${!this.selectedId}
          @click=${() => this.openEdit(this.selectedId)}>
          ${icons.open} ${t("common.open")}
        </button>
        <!-- Позначка на видалення — сама лише іконка: дія не з тих, заради яких
             тримають підпис, а «Позначити на видалення» — найдовший рядок у
             тулбарі й з'їдає місце в потрібніших кнопок. Кнопка міняється за
             станом курсора (кошик ↔ перекреслений кошик), як
             «Провести»/«Розпровести» у формі документа: одна дія, два напрямки.

             Без підпису ім'я кнопці дає aria-label, а title показує його мишею —
             правило для будь-якої кнопки-іконки. Зворотних лапок у цьому
             коментарі бути не може: він усередині html-шаблону, і перша ж
             лапка закриє шаблонний рядок. -->
        ${can(this.model, "delete")
          ? this.hasDeletionMark && this.selectedIsDeleted
            ? html`
              <button class="btn btn-sm btn-outline btn-square" ?disabled=${!this.selectedId}
                title=${t("common.unmarkDeleted")} aria-label=${t("common.unmarkDeleted")}
                @click=${this.undeleteSelected}>
                ${icons.undelete}
              </button>`
            : html`
              <button class="btn btn-sm btn-error btn-outline btn-square" ?disabled=${!this.selectedId}
                title=${this.hasDeletionMark ? t("common.markDeleted") : t("common.delete")}
                aria-label=${this.hasDeletionMark ? t("common.markDeleted") : t("common.delete")}
                @click=${this.deleteSelected}>
                ${icons.delete}
              </button>`
          : nothing}
      `}
      ${this.hierarchy && can(this.model, "edit")
        ? html`
          <button class="btn btn-sm" ?disabled=${!this.selectedId} @click=${this.#openMoveDialog}>
            ${icons.toGroup} ${t("groups.toGroup")}
          </button>`
        : nothing}
      <button class="btn btn-sm" ?disabled=${this.exporting || this.total === 0}
        @click=${this.exportExcel}>
        ${this.exporting
          ? html`<span class="loading loading-spinner loading-xs"></span>`
          : icons.excel}
        ${t("common.exportExcel")}
      </button>
    `;
  }

  override render(): TemplateResult {
    return html`
      <div class="flex flex-col h-full">

        ${this.renderToolbar()}

        <!-- Помилки команд і попередження (напр. обрізане вивантаження).
             Без цього банера відмова сервера в списку не видно взагалі. -->
        <div class="px-2 empty:hidden">${this.renderNotice()}</div>

        ${this.renderHeaderArea()}

        <!-- Основна площа: таблиця + бічна колонка праворуч.
             Колонка ОДНА на дерево груп і панель фільтрів: два окремих аside
             по 15rem з'їли б пів екрана, а на ієрархічному довіднику з
             фільтрами вони ще й стали б поруч. Фільтри зверху (їх небагато й
             висота своя), дерево знизу на решту висоти. -->
        ${(() => {
          const filterPanel = this.renderFilterPanel();
          const asideShown = this.hierarchy || filterPanel !== "";
          return html`
            <div class="flex flex-1 min-h-0 ${asideShown ? "pr-3" : ""}">
              <div class="flex-1 overflow-auto px-2">
                ${this.renderTable()}
              </div>

              ${asideShown
                ? html`
                  <aside class="w-60 shrink-0 border-l border-base-300 flex flex-col min-h-0 gap-2">
                    ${filterPanel}
                    ${this.hierarchy
                      ? html`
                        <div class="group-panel group-panel-frame flex-1 min-h-0 overflow-auto">
                          <ui-group-tree .model=${this.model} mode="filter"
                            @groups-changed=${this.#onGroupsChanged}
                            @groups-mutated=${() => this.load()}>
                          </ui-group-tree>
                        </div>`
                      : nothing}
                  </aside>`
                : nothing}
            </div>
          `;
        })()}

        ${this.moveOpen
          ? html`
            <div class="app-dialog-overlay"
              @keydown=${(e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); this.moveOpen = false; } }}
              @click=${(e: Event) => { if (e.target === e.currentTarget) this.moveOpen = false; }}>
              <div class="app-dialog w-96">
                <div class="app-dialog-title">
                  <span>${t("groups.moveTitle")}</span>
                  <button type="button" class="app-dialog-close" aria-label=${t("common.close")}
                    @click=${() => { this.moveOpen = false; }}>×</button>
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

        ${this.renderPagination()}
      </div>
    `;
  }
}
