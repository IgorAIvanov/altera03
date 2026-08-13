/**
 * Спільна основа табличних екранів моделі: список (`ModelListBase`) і діалог
 * вибору (`ModelPickerBase`).
 *
 * Тут живе МЕХАНІКА без політики — стан запиту (`$query`), серверне сортування,
 * пошук із затримкою, пагінація, клавіатура рядків і розмітка таблиці. Що саме
 * стоїть навколо таблиці, вирішує нащадок: список додає створення/видалення,
 * ієрархію й вивантаження, пікер — підтвердження вибору.
 *
 * ## Чому клас, а не міксин
 *
 * Обидва нащадки вже `BaseUI<ListRoot<Row>>`, тобто ієрархія одна. Міксин
 * потрібен, коли спільну поведінку прищеплюють до РІЗНИХ ієрархій; тут він дав
 * би зайвий рівень типів без жодного виграшу.
 *
 * ## Чому не один `render()` з прапорцями
 *
 * Розмітка віддається окремими методами (`renderToolbar`, `renderTable`,
 * `renderPagination`), а не одним `render()`, що знає про обох нащадків. Щойно
 * в базі з'явиться `if (picker)`, вона почне знати про своїх спадкоємців, і
 * кожна наступна відмінність додаватиме ще один прапорець. Нащадок складає
 * екран сам — база лише дає деталі.
 *
 * ## Що сюди переїхало і чому це не абстракція «на майбутнє»
 *
 * Рівно те, що вже було ПРОДУБЛЬОВАНО в обох класах: 12 проєкцій `$query`
 * слово в слово, байт-у-байт однаковий `#setSort`, `#totalPages`, `#sortIcon`,
 * розмітка таблиці й пагінації, той самий CSS виділеного рядка. Копія вже
 * встигла розійтися — і кожне розходження було мовчазним:
 *
 *  · `#cell` у пікера ІГНОРУВАВ `col.format` — колонка з датою показала б сирий
 *    ISO замість «31.12.26» (тут виправлено: обробка одна на обох);
 *  · затримка пошуку 250 мс у пікера проти 300 мс у списку — без причини;
 *  · клавіатура, `aria-sort` та імена кнопок пагінації дісталися лише списку.
 */
import { css, type CSSResultGroup, html, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { t } from "@client/locale.ts";
import { tw } from "@client/shared/styles.ts";
import { formatDate } from "@client/shared/datetime.ts";
import { readUserScoped, writeUserScoped } from "@client/shared/user-storage.ts";
import { FilteredBase } from "./filtered-base.ts";
import { icons } from "../icons.ts";
import {
  alignClass,
  cellStyle,
  listRootSchema,
  type ListColumn,
  type ListRoot,
  type SortDir,
} from "./table-contract.ts";


/** Ключ пам'яті про згорнуту панель — свій на кожну модель. */
const FILTER_PANEL_KEY = "list-filters-open";

export abstract class QueryTableBase<Row extends { id: string }> extends FilteredBase<ListRoot<Row>> {
  static override styles: CSSResultGroup = [tw, css`
    tr.selected td { background: #cfe0f3 !important; color: var(--color-base-content, #243746) !important; }

    /* Заголовок сортованої колонки — СПРАВЖНЯ кнопка всередині <th>, а не
       @click на самій комірці. Клік мишею працював і так, але сортування з
       клавіатури не існувало взагалі: <th> у фокус не потрапляє. Вигляд у
       кнопки — заголовка, тож візуально нічого не змінюється. */
    th.sortable { padding: 0; }
    th.sortable .sort-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      width: 100%;
      padding: 3px 8px;
      font: inherit;
      color: inherit;
      background: none;
      border: 0;
      cursor: pointer;
      user-select: none;
    }
    th.sortable.text-right .sort-btn { justify-content: flex-end; }
    th.sortable.text-center .sort-btn { justify-content: center; }
    .sort-btn:focus-visible,
    tr:focus-visible {
      outline: 1px solid var(--color-primary);
      outline-offset: -1px;
    }
    /* Стрілка неактивної колонки. Було opacity .2 — це 1.37:1 до фону шапки,
       тобто ознаки «колонку можна сортувати» на екрані фактично не було. */
    .sort-idle { opacity: .7; }

    /* Колонка позначок: рівно під прапорець, по центру. Ширину задаємо тут, а
       не через ListColumn — це колонка службова, її не оголошує застосунок і
       вона не їде у вивантаження. */
    .check-cell,
    .status-cell {
      width: 2rem;
      text-align: center;
      padding-inline: 0;
    }
    /* Значок стану вирівнюється по центру комірки, а не по базовій лінії тексту. */
    .status-cell svg { vertical-align: middle; }

    /* Панель фільтрів. Фон і рамка — семантичними змінними теми, тими самими,
       що в панелі груп: обидві стоять у тій самій колонці праворуч і мусять
       читатися як одна поверхня, а не як дві різні. */
    .filter-panel {
      background: var(--app-surface, #f6f8fa);
      border: 1px solid var(--app-border-strong, #98a7b4);
    }
  `];

  // ── Обов'язкове для нащадка ────────────────────────────────────────────────
  protected abstract columns: ListColumn<Row>[];

  /**
   * Команда завантаження. Гетер, а не поле: у списку це `listCommand`, у пікера
   * `lookupCommand` — обидва вже є протектед-поверхнею, яку перекривають екрани
   * застосунків, тож перейменувати їх не можна.
   */
  protected abstract get loadCommand(): string;

  // Табличний екран нічого не редагує: його $root оновлюється кожним load.
  protected override dirtyTracking = false;

  // ── Налаштування ──────────────────────────────────────────────────────────
  /** Незмінний перелік (журнал аудиту): лишає пошук, сортування й вивантаження. */
  protected readonly = false;
  protected defaultSortBy = "";
  protected defaultSortDir: SortDir = "asc";
  /** `undefined` — узяти розмір сторінки зі схеми `$query`. */
  protected defaultPageSize?: number;
  protected pageSizeOptions = [10, 20, 50, 100];
  /**
   * Затримка пошуку. Одне значення на обидва екрани: доти в списку стояло 300,
   * у пікера 250, і різниця нічим не пояснювалася.
   */
  protected searchDebounceMs = 300;
  /** Пошук розтягується на вільне місце тулбара (діалог вибору — пошук головний). */
  protected searchGrow = false;
  /**
   * Позначки рядків: колонка з прапорцями плюс прапорець «усі на сторінці».
   *
   * Це ІНШЕ поняття, ніж `selectedId`. Виділений рядок — курсор: над ним
   * працюють «Відкрити» й «Видалити», і він завжди один. Позначені — набір для
   * групової дії (провести пачку документів, підібрати кілька позицій), і їх
   * може не бути жодного при живому курсорі.
   */
  protected selectable = false;

  // ── Стан ──────────────────────────────────────────────────────────────────
  /** Виділений рядок (курсор) — клієнтський транзиент, не частина data-контракту. */
  @state() protected selectedId = "";

  /**
   * Позначені рядки — ЦІЛКОМ, а не самі лише id, і НЕ лише з поточної сторінки.
   *
   * Рядок цілком, бо інакше на позначене з інших сторінок немає ні підпису для
   * діалогу підтвердження, ні `label` для множинного підбору: на екрані тих
   * рядків уже немає, а перечитувати їх з бази заради напису — безглуздо.
   */
  @state() protected checked: Row[] = [];

  /** Чи розгорнута панель фільтрів. Пам'ятається на користувача й модель. */
  @state() protected filterPanelOpen = false;

  // ── Проєкції `$root` ──────────────────────────────────────────────────────
  // Читання трекає SignalWatcher, запис у deep-проксі перемальовує.
  protected get rows(): Row[] { return this.$root.rows; }
  protected get total(): number { return this.$root.totals.count; }

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

  /** Спіннер на місці таблиці. Список перекриває: там він лише на першому вантаженні. */
  protected get loading(): boolean {
    return this.running === this.loadCommand;
  }

  constructor() { super(listRootSchema); }

  // ReturnType<typeof setTimeout>, а не number: пакет типізується і з DOM-lib, і з
  // @types/node (його тягне пресет `vite.ts` того ж пакета), а там setTimeout
  // повертає Timeout, не number.
  #searchTimer?: ReturnType<typeof setTimeout>;

  override connectedCallback() {
    super.connectedCallback();
    // Панель відкрита за пам'яттю користувача; без запису — розгорнута, якщо
    // фільтри взагалі оголошені: інакше про них можна не дізнатися ніколи.
    if (this.hasFilters) {
      const saved = readUserScoped(`${FILTER_PANEL_KEY}:${this.model}`);
      this.filterPanelOpen = typeof saved === "boolean" ? saved : true;
    }
    if (this.defaultPageSize !== undefined) this.pageSize = this.defaultPageSize;
    if (!this.sortBy) {
      // Перша СОРТОВАНА колонка, а не просто перша: сортувати за колонкою,
      // якій цього не дозволено, сервер не зобов'язаний уміти.
      this.sortBy = this.defaultSortBy
        || this.columns.find((c) => c.sortable)?.key
        || this.columns[0]?.key
        || "";
    }
    this.sortDir = this.defaultSortDir;
    this.load();
  }

  // ── Точки розширення ──────────────────────────────────────────────────────
  /** Додаткові поля payload — напр. значення панелі фільтрів. */
  protected extraPayload(): Record<string, unknown> { return {}; }
  /**
   * Повний payload команди завантаження. Перекривають НАЩАДКИ ФРЕЙМВОРКУ
   * (список додає групи ієрархії, пікер — `params` діалогу); екранам
   * застосунку призначений `extraPayload()`.
   */
  protected loadPayload(): Record<string, unknown> {
    return { ...this.queryPayload(), ...this.extraPayload() };
  }

  /**
   * Стан запиту без розширень екрана: `$query` плюс задані фільтри.
   *
   * Виділено окремо, щоб нащадок міг вставити СВОЄ між ним і `extraPayload()`
   * і не переписувати порядок: у списку між ними стоять групи ієрархії, і
   * порядок там значущий — `extraPayload()` застосунку має бути останнім.
   */
  protected queryPayload(): Record<string, unknown> {
    return {
      ...this.$root.$query,
      // Фільтри — вкладеним об'єктом (`filtersPayload()`), а не врозсип поруч
      // із `search`/`page`: імена фільтрів вигадує екран, і рано чи пізно одне
      // з них збіглося б із полем `$query`.
      ...this.filtersPayload(),
    };
  }

  // ── Фільтри ───────────────────────────────────────────────────────────────
  //
  // Стан і прив'язка — у `FilteredBase`, спільній зі звітами: набір фільтрів
  // однаково не належить основі, а от «як його тримати» однакове. Тут лишається
  // те, що робить із фільтра саме СПИСОК — негайний перезапит із першої
  // сторінки; звіт того самого гака не перевизначає, бо його формує «Оновити».

  protected override onFiltersChanged() {
    this.reload();
  }

  /**
   * Чи є в екрана фільтри. Визначається за тим, чи перекрито `renderFilters()`,
   * а не окремим прапорцем: прапорець довелося б тримати в парі з розміткою, і
   * розсинхрон («оголосив, а не намалював») ніде б не виявився.
   */
  protected get hasFilters(): boolean {
    return this.renderFilters !== QueryTableBase.prototype.renderFilters;
  }

  protected toggleFilterPanel() {
    this.filterPanelOpen = !this.filterPanelOpen;
    writeUserScoped(`${FILTER_PANEL_KEY}:${this.model}`, this.filterPanelOpen);
  }
  /** Додаткові кнопки тулбара — точка розширення ЗАСТОСУНКУ (є і в пікері). */
  protected renderToolbarExtra(): TemplateResult | string { return ""; }
  /** Стандартні дії тулбара — точка розширення ФРЕЙМВОРКУ (список, пікер). */
  protected renderToolbarActions(): TemplateResult | string { return ""; }
  /**
   * Службова колонка стану ліворуч (введений / проведений / позначений на
   * видалення). Вмикає її нащадок — у діалозі підбору вона зайва: позначені
   * туди й не потрапляють.
   */
  protected get statusColumn(): boolean { return false; }
  /** Значок стану рядка для цієї колонки. */
  protected renderRowStatus(_row: Row): TemplateResult | string { return ""; }

  /** Додаткові CSS-класи рядка (підсвітка за статусом тощо). */
  protected rowClass(_row: Row): string { return ""; }
  /**
   * Inline-стиль рядка (колір тексту/фону за статусом). Застосовується до
   * кожної `<td>`, щоб перекрити zebra; виділення рядка має пріоритет.
   */
  protected rowStyle(_row: Row): string { return ""; }
  /** Дія активації рядка: подвійний клік і Enter. Список відкриває, пікер обирає. */
  protected abstract onActivate(row: Row): void;
  /**
   * Текст ПОРОЖНЬОГО набору: у списку «немає даних», у пікера «не знайдено».
   *
   * Саме порожнього, а не «нічого не знайшлося»: коли діє пошук чи фільтр,
   * повідомлення дає `renderEmpty()`, і цей метод до нього не залучається.
   */
  protected emptyText(): string { return t("common.noData"); }

  // ── Логіка ────────────────────────────────────────────────────────────────
  protected async load() {
    // Відповідь `{ rows, totals[, $query] }` домержується у $root через assign:
    // якщо БД поверне ефективний `$query` — він віддзеркалиться назад.
    const env = await this.run<Partial<ListRoot<Row>>>(this.loadCommand, this.loadPayload());
    if (env.ok && env.data) this.assign(env.data);
  }

  /**
   * Перезавантаження з першої сторінки (виклик при зміні фільтрів).
   * Позначки скидаються: відбір інший, і що саме лишилося позначеним — питання
   * без відповіді. Гортання сторінок і зміна сортування позначок НЕ чіпають —
   * там набір рядків той самий.
   */
  protected reload() {
    this.clearChecked();
    this.page = 1;
    this.load();
  }

  // ── Позначені рядки ───────────────────────────────────────────────────────

  /** Id позначених — саме це йде в команди групових дій. */
  protected get checkedIds(): string[] {
    return this.checked.map((r) => r.id);
  }

  protected isChecked(id: string): boolean {
    return this.checked.some((r) => r.id === id);
  }

  protected toggleChecked(row: Row) {
    this.checked = this.isChecked(row.id)
      ? this.checked.filter((r) => r.id !== row.id)
      : [...this.checked, row];
  }

  protected clearChecked() {
    if (this.checked.length) this.checked = [];
  }

  /**
   * Прапорець у шапці діє на ПОТОЧНУ СТОРІНКУ, а не на весь відбір: позначити
   * 10 000 рядків, яких ніхто не бачив, — не послуга. Позначене на інших
   * сторінках лишається як є, а скільки його всього, каже лічильник у тулбарі.
   */
  protected toggleAllOnPage() {
    const pageIds = new Set(this.rows.map((r) => r.id));
    const allChecked = this.rows.length > 0 && this.rows.every((r) => this.isChecked(r.id));
    const rest = this.checked.filter((r) => !pageIds.has(r.id));
    this.checked = allChecked ? rest : [...rest, ...this.rows];
  }

  protected totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  protected onSearch(e: Event) {
    this.search = (e.target as HTMLInputElement).value;
    // Той самий довід, що й у reload(): відбір змінився — позначки застаріли.
    this.clearChecked();
    this.page = 1;
    clearTimeout(this.#searchTimer);
    this.#searchTimer = setTimeout(() => this.load(), this.searchDebounceMs);
  }

  /**
   * Перейти на сторінку й повести туди фокус.
   *
   * Фокус саме тому й переноситься: без нього перегортання з клавіатури
   * лишало курсор на рядку, якого на екрані вже немає, і далі стрілки не
   * працювали — доводилося братися за мишу, тобто рівно те, від чого гортання
   * з клавіатури мало позбавити.
   */
  protected async gotoPage(page: number, focus: "first" | "last" = "first") {
    const last = this.totalPages();
    const next = Math.min(Math.max(1, page), last);
    if (next === this.page) return;
    this.page = next;
    await this.load();
    await this.updateComplete;
    if (this.rows.length === 0) return;
    this.moveSelection(focus === "first" ? 0 : this.rows.length - 1);
  }

  protected setSort(col: ListColumn<Row>) {
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

  /**
   * Значення `aria-sort` для шапки: напрямок озвучується, а не лише малюється.
   *
   * Приватний навмисно, і не з міркувань чистоти: `ariaSort` — це властивість
   * `ARIAMixin` на самому `HTMLElement`, тож захищений метод з таким іменем не
   * компілюється взагалі («defines instance member property, but extended class
   * defines it as instance member function»). Нащадкам він і не потрібен —
   * шапку малює `renderTable()` тут же.
   */
  #ariaSort(col: ListColumn<Row>): string {
    if (!col.sortable || this.sortBy !== col.key) return "none";
    return this.sortDir === "asc" ? "ascending" : "descending";
  }

  protected sortIcon(col: ListColumn<Row>): TemplateResult | string {
    if (!col.sortable) return "";
    if (this.sortBy !== col.key) return html`<span class="sort-idle">↕</span>`;
    return this.sortDir === "asc" ? html`<span>↑</span>` : html`<span>↓</span>`;
  }

  /**
   * Вміст комірки. `col.format` обробляється ТУТ, один раз на обидва екрани —
   * доти пікер його мовчки ігнорував, і колонка з датою показала б сирий ISO.
   */
  protected cell(row: Row, col: ListColumn<Row>): TemplateResult | string {
    if (col.render) return col.render(row);
    const v = (row as Record<string, unknown>)[col.key];
    if (v == null) return "";
    if (col.format) return formatDate(v as string, col.format) || String(v);
    return String(v);
  }

  // ── Клавіатура в таблиці ──────────────────────────────────────────────────

  /**
   * «Мандрівний» tabindex: у фокусну чергу потрапляє РІВНО ОДИН рядок, решта
   * доступні стрілками. Інакше Tab довелося б натиснути 100 разів, щоб пройти
   * сторінку наскрізь.
   */
  protected rowTabIndex(row: Row, index: number): number {
    if (this.readonly) return -1;
    if (this.selectedId) return row.id === this.selectedId ? 0 : -1;
    return index === 0 ? 0 : -1;
  }

  /** Вибрати рядок за номером і повести туди фокус (після перемальовування). */
  protected moveSelection(index: number) {
    const row = this.rows[index];
    if (!row) return;
    this.selectedId = row.id;
    this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>(`tr[data-row-id="${row.id}"]`)?.focus();
    });
  }

  /**
   * Клавіші на рядку таблиці.
   *
   * Без цього обидва екрани були тупиком для клавіатури: виділення ставилося
   * лише `@click`. У списку це блокувало кнопки «Відкрити» й «Видалити» (вони
   * вимкнені без `selectedId`), а в діалозі вибору — саме вибір: Enter вимагає
   * виділеного рядка, а виділити його без миші не було чим.
   *
   * `preventDefault()` скрізь — за домовленістю оболонки: хто клавішу забрав,
   * той її і позначає (див. `client/shell/shortcuts.ts`). Для стрілок і пробілу
   * це ще й прибирає прокрутку сторінки під ними.
   */
  protected onRowKeyDown(e: KeyboardEvent, row: Row, index: number) {
    if (this.readonly) return;
    const mod = e.ctrlKey || e.metaKey;

    // Ctrl+A — за `code`, а не за `key`: `key` віддає символ поточної розкладки,
    // тож у кирилиці сюди приходить «ф» (та сама причина, що в shortcuts.ts).
    if (mod && e.code === "KeyA" && this.selectable) {
      e.preventDefault();
      this.toggleAllOnPage();
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        // На останньому рядку сторінки стрілка веде на наступну сторінку, а не
        // впирається: інакше саме тут доводилося братися за мишу.
        if (index + 1 < this.rows.length) this.moveSelection(index + 1);
        else void this.gotoPage(this.page + 1, "first");
        break;
      case "ArrowUp":
        e.preventDefault();
        if (index > 0) this.moveSelection(index - 1);
        else void this.gotoPage(this.page - 1, "last");
        break;
      case "PageDown":
        e.preventDefault();
        void this.gotoPage(this.page + 1, "first");
        break;
      case "PageUp":
        e.preventDefault();
        void this.gotoPage(this.page - 1, "last");
        break;
      // Home/End — межі СТОРІНКИ, з Ctrl — межі всього відбору. Та сама пара
      // понять, що в текстовому редакторі: рядок і документ.
      case "Home":
        e.preventDefault();
        if (mod) void this.gotoPage(1, "first");
        else this.moveSelection(0);
        break;
      case "End":
        e.preventDefault();
        if (mod) void this.gotoPage(this.totalPages(), "last");
        else this.moveSelection(this.rows.length - 1);
        break;
      case " ":
        e.preventDefault();
        // Там, де є позначки, пробіл позначає (як у файлових менеджерах і
        // пошті); курсор і так стоїть на цьому рядку — його привели стрілки.
        if (this.selectable) this.toggleChecked(row);
        else this.selectedId = row.id;
        break;
      case "Enter":
        // Голий Enter оболонка не займає (її дія — Ctrl+Enter), тож конфлікту
        // немає: тут це те саме, що подвійний клік.
        e.preventDefault();
        this.selectedId = row.id;
        this.onActivate(row);
        break;
    }
  }

  // ── Розмітка (нащадок складає екран сам) ──────────────────────────────────

  /**
   * Тулбар: дії фреймворку, потім кнопки застосунку, розпірка, пошук, оновлення.
   *
   * Є на ОБОХ екранах, зокрема в діалозі вибору: там теж бувають свої кнопки
   * («показати неактивні», «створити нового й обрати»), і місце для них має
   * бути одне й те саме — інакше кожен пікер вигадає власне.
   */
  protected renderToolbar(): TemplateResult {
    return html`
      <div class="flex items-center gap-2 p-2 border-b border-base-300 flex-wrap">
        ${this.renderToolbarActions()}
        ${this.renderToolbarExtra()}
        <!-- Лічильник потрібен саме тому, що позначки переживають гортання:
             без нього «відмічено 3» з першої сторінки було б невидимим з
             третьої, і групова дія спрацювала б несподівано. -->
        ${this.selectable && this.checked.length > 0
          ? html`
            <span class="text-muted">
              ${t("common.checked", { count: this.checked.length })}
            </span>
            <button class="btn btn-sm btn-ghost" @click=${() => this.clearChecked()}>
              ${t("common.clearChecked")}
            </button>`
          : nothing}
        <div class="flex-1"></div>
        ${this.hasFilters
          ? html`
            <button class="btn btn-sm ${this.filterPanelOpen ? "btn-active" : ""}"
              aria-pressed=${this.filterPanelOpen ? "true" : "false"}
              title=${t("common.filters")}
              @click=${() => this.toggleFilterPanel()}>
              ${icons.filter} ${t("common.filters")}
              ${this.activeFilterCount
                ? html`<span class="badge badge-sm badge-primary">${this.activeFilterCount}</span>`
                : nothing}
            </button>`
          : nothing}
        ${this.renderSearch()}
        <button class="btn btn-sm btn-ghost" @click=${() => this.load()}>
          ${icons.refresh} ${t("common.refresh")}
        </button>
      </div>
    `;
  }

  protected renderSearch(): TemplateResult {
    return html`
      <label class="input input-sm flex items-center gap-2 ${this.searchGrow ? "flex-1" : ""}">
        ${icons.search}
        <!-- aria-label, хоч поле й лежить усередині <label>: текстового вмісту
             в тому підписі немає (сама лише іконка), тож імені поле не мало.
             Плейсхолдер ім'ям не рахується — він зникає з першим символом. -->
        <input type="text" class="grow search-input" placeholder="${t("common.search")}..."
          aria-label=${t("common.search")}
          .value=${this.search} @input=${this.onSearch} />
      </label>
    `;
  }

  /**
   * Панель передвизначених фільтрів. Порожній перелік або згорнута панель —
   * порожній рядок, тож нащадок може вставляти виклик беззастережно.
   *
   * Праворуч, а не над таблицею, свідомо: фільтри в обліковому списку живуть
   * довго (організація, період, статус), і смуга контролів над сіткою з'їдала б
   * висоту, якої в щільній таблиці й так мало. Згорнути її можна кнопкою в
   * тулбарі, і стан пам'ятається на користувача.
   */
  protected renderFilterPanel(): TemplateResult | string {
    if (!this.hasFilters || !this.filterPanelOpen) return "";
    return html`
      <div class="filter-panel flex flex-col min-h-0">
        <div class="flex items-center justify-between px-2 py-1 border-b border-base-300">
          <span class="font-semibold">${t("common.filters")}</span>
          <button class="btn btn-xs btn-ghost" ?disabled=${this.activeFilterCount === 0}
            @click=${() => this.resetFilters()}>
            ${t("common.filtersReset")}
          </button>
        </div>
        <div class="flex-1 min-h-0 overflow-auto p-2 flex flex-col gap-2">
          ${this.renderBuiltInFilters()}
          ${this.renderFilters()}
        </div>
      </div>
    `;
  }

  /**
   * Вміст панелі фільтрів — ПОВНІСТЮ за екраном: будь-які контроли, ручна
   * розмітка, свої обробники. Основа не оголошує ні видів фільтрів, ні їхнього
   * вигляду; вона дає стан (`$root.$filters`) і зв'язування:
   *
   * ```ts
   * protected override renderFilters() {
   *   return html`
   *     <ui-period .dateFrom=${this.filterValue("dateFrom") ?? ""}
   *                .dateTo=${this.filterValue("dateTo") ?? ""}
   *       @value-changed=${(e: CustomEvent) =>
   *         this.setFilters({ dateFrom: e.detail.dateFrom, dateTo: e.detail.dateTo })}>
   *     </ui-period>
   *
   *     ${this.renderField(t("invoice.counterparty"), html`
   *       <ui-picker url="catalog/counterparty" fetch="lookup"
   *         .selectedId=${this.filterValue("counterpartyId") ?? ""}
   *         .value=${this.filterValue("counterparty") ?? null}
   *         @value-changed=${(e: PickerChangeEvent) => this.setFilter("counterparty", e.detail.value)}>
   *       </ui-picker>`)}
   *
   *     <label class="flex items-center gap-2">
   *       <input type="checkbox" class="checkbox checkbox-xs"
   *         .checked=${this.filterValue("isPosted") === true}
   *         @change=${this.bindFilter("isPosted")} />
   *       <span>${t("document.posted")}</span>
   *     </label>
   *   `;
   * }
   * ```
   *
   * Компоненти, що тут ужиті, імпортує САМ ЕКРАН — тоді за `<ui-period>` платить
   * лише той список, якому він потрібен, а не кожен табличний екран застосунку.
   */
  protected renderFilters(): TemplateResult | string { return ""; }

  /**
   * Відбори, які основа малює САМА — перед фільтрами екрана.
   *
   * Точка розширення ФРЕЙМВОРКУ, не застосунку (пара до `renderToolbarActions`
   * поруч із `renderToolbarExtra`). Сюди йде те, що однакове в кожного екрана
   * свого роду й спирається на дані ядра: сьогодні це відбір за організацією в
   * журналі документів — колонка `organization_id` живе в `app.document`, тож
   * застосунку нема куди його повісити.
   *
   * Окремо від `renderFilters()` навмисно: інакше екран, який дописує свій
   * фільтр, мусив би пам'ятати покликати основу — а забутий виклик мовчки
   * прибрав би відбір, і виглядало б це як «журнал показує чужий облік».
   */
  protected renderBuiltInFilters(): TemplateResult | string { return ""; }

  /**
   * Порожня таблиця.
   *
   * «Немає даних» саме по собі не каже головного: перелік порожній чи це відбір
   * нічого не знайшов. А різниця тут — між «завести перший запис» і «зняти
   * фільтр», тобто між двома протилежними діями. Тому повідомлення називає
   * причину й дає з неї вихід тією ж кнопкою, якою причину створили.
   *
   * Пошук перевіряється першим: він видимий у тулбарі завжди, а панель фільтрів
   * буває згорнута — коли діють обидва, чесніше показати на те, що на очах.
   */
  protected renderEmpty(): TemplateResult {
    const cause = this.search
      ? { text: t("common.noMatchSearch"), action: t("common.clearSearch"), run: () => { this.search = ""; this.reload(); } }
      : this.activeFilterCount
      ? { text: t("common.noMatchFilters"), action: t("common.filtersReset"), run: () => this.resetFilters() }
      : null;

    return html`
      <div class="text-center p-8 text-muted flex flex-col items-center gap-2">
        <span>${cause ? cause.text : this.emptyText()}</span>
        ${cause
          ? html`<button class="btn btn-sm btn-ghost" @click=${cause.run}>${cause.action}</button>`
          : nothing}
      </div>
    `;
  }

  protected renderTable(): TemplateResult {
    if (this.loading) {
      return html`<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>`;
    }
    if (this.rows.length === 0) return this.renderEmpty();
    const allOnPage = this.rows.length > 0 && this.rows.every((r) => this.isChecked(r.id));
    const someOnPage = !allOnPage && this.rows.some((r) => this.isChecked(r.id));

    return html`
      <table class="table table-sm table-zebra w-full">
        <thead class="sticky top-0 bg-base-100 z-10">
          <tr>
            ${this.selectable
              ? html`
                <th class="check-cell">
                  <input type="checkbox" class="checkbox checkbox-xs"
                    aria-label=${t("common.checkAllOnPage")} title=${t("common.checkAllOnPage")}
                    .checked=${allOnPage} .indeterminate=${someOnPage}
                    @change=${() => this.toggleAllOnPage()} />
                </th>`
              : nothing}
            ${this.statusColumn ? html`<th class="status-cell"></th>` : nothing}
            ${this.columns.map((col) => html`
              <th
                class="${col.sortable ? "sortable" : ""} ${alignClass(col.align)}"
                style=${col.width ? `width:${col.width}` : ""}
                aria-sort=${col.sortable ? this.#ariaSort(col) : nothing}
              >
                ${col.sortable
                  ? html`
                    <button type="button" class="sort-btn" @click=${() => this.setSort(col)}>
                      ${t(col.title)} ${this.sortIcon(col)}
                    </button>`
                  : t(col.title)}
              </th>
            `)}
          </tr>
        </thead>
        <tbody>
          ${this.rows.map((row, index) => html`
            <tr
              class="${this.readonly ? "" : "cursor-pointer hover"} ${row.id === this.selectedId ? "selected" : ""} ${this.rowClass(row)}"
              data-row-id=${row.id}
              tabindex=${this.rowTabIndex(row, index)}
              aria-current=${row.id === this.selectedId ? "true" : nothing}
              @click=${() => { if (!this.readonly) this.selectedId = row.id; }}
              @dblclick=${() => { if (!this.readonly) this.onActivate(row); }}
              @keydown=${(e: KeyboardEvent) => this.onRowKeyDown(e, row, index)}
            >
              ${this.selectable
                ? html`
                  <td class="check-cell">
                    <!-- stopPropagation: клік по прапорцю не має заразом
                         переставляти курсор і тим паче активувати рядок. -->
                    <input type="checkbox" class="checkbox checkbox-xs"
                      aria-label=${t("common.checkRow")}
                      .checked=${this.isChecked(row.id)}
                      @click=${(e: Event) => e.stopPropagation()}
                      @change=${() => this.toggleChecked(row)} />
                  </td>`
                : nothing}
              ${this.statusColumn
                ? html`<td class="status-cell">${this.renderRowStatus(row)}</td>`
                : nothing}
              ${this.columns.map((col) => html`
                <td class="${col.muted ? "text-muted" : ""} ${alignClass(col.align)}"
                  style=${[cellStyle(col), this.rowStyle(row)].filter(Boolean).join(";")}
                  title=${col.tooltip ? col.tooltip(row) : nothing}>
                  ${this.cell(row, col)}
                </td>
              `)}
            </tr>
          `)}
        </tbody>
      </table>
    `;
  }

  protected renderPagination(): TemplateResult {
    const totalPages = this.totalPages();
    const goto = (page: number) => { this.page = page; this.load(); };
    return html`
      <div class="flex items-center justify-between px-3 py-2 border-t border-base-300 text-sm">
        <span class="text-muted">${this.total} ${t("common.records")}</span>
        <!-- Кнопкам потрібне ім'я: «« » і «‹» читалка озвучує як назви самих
             символів («ліва подвійна кутова лапка»), тобто по звуку сторінки не
             розрізнити. Той самий текст іде в title — підказка мишею. -->
        <div class="join">
          <button class="join-item btn btn-xs" ?disabled=${this.page <= 1}
            aria-label=${t("common.pageFirst")} title=${t("common.pageFirst")}
            @click=${() => goto(1)}>«</button>
          <button class="join-item btn btn-xs" ?disabled=${this.page <= 1}
            aria-label=${t("common.pagePrev")} title=${t("common.pagePrev")}
            @click=${() => goto(this.page - 1)}>‹</button>
          <span class="join-item btn btn-xs btn-disabled pointer-events-none"
            aria-live="polite"
            aria-label=${t("common.pageOf", { page: this.page, total: totalPages })}>
            ${this.page} / ${totalPages}
          </span>
          <button class="join-item btn btn-xs" ?disabled=${this.page >= totalPages}
            aria-label=${t("common.pageNext")} title=${t("common.pageNext")}
            @click=${() => goto(this.page + 1)}>›</button>
          <button class="join-item btn btn-xs" ?disabled=${this.page >= totalPages}
            aria-label=${t("common.pageLast")} title=${t("common.pageLast")}
            @click=${() => goto(totalPages)}>»</button>
        </div>
        <select class="select select-xs w-20"
          aria-label=${t("common.pageSize")} title=${t("common.pageSize")}
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
    `;
  }
}
