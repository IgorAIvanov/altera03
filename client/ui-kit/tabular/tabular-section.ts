/**
 * Таблична частина документа — ЛОГІКА (патерн: контролер + окремі в'ю).
 *
 * `TabularSection` тримає конфігурацію колонок і стан (поточний рядок,
 * відкладений фокус) та дає дії над рядками: додати, скопіювати, видалити,
 * пересунути. Подання — окремі незалежні компоненти `<ui-tabular-table>` і
 * `<ui-tabular-toolbar>`: кожен можна не використовувати й намалювати своє —
 * усі дії публічні, кастомний тулбар це три кнопки з викликами секції.
 *
 * Дані секція НЕ володіє: рядки живуть у `$root` форми (deep-проксі + сигнали),
 * секція читає їх через `rows()` і пише через `setRows()` — тож реактивність
 * та сама, що в усього `$root`, а форма вільна тримати рядки де хоче.
 *
 * Типізація — головна причина, чому конфіг живе в TS-коді форми, а не в
 * атрибутах компонента: ключі колонок і обчислення перевіряє компілятор.
 */
import type { ReactiveControllerHost, TemplateResult } from "lit";
import { Decimal } from "decimal.js";
import { Value } from "@sinclair/typebox/value";
import type { TObject } from "@sinclair/typebox";
import { t } from "../../locale.ts";

/** Безпечний розбір значення форми в Decimal (порожнє / сміття → 0). */
export function dec(raw: unknown): Decimal {
  try {
    return new Decimal(String(raw ?? "").replace(",", ".") || 0);
  } catch {
    return new Decimal(0);
  }
}

export interface TabularColumn<Line extends object> {
  /**
   * Вид комірки: готові контроли за контрактом `.cell-control` або лазівка
   * `custom` (динамічні пікери субконто, умовні комірки — будь-що).
   */
  kind: "text" | "decimal" | "picker" | "date" | "checkbox" | "computed" | "custom";
  /** Поле рядка (для text/decimal/date/checkbox; для picker — поле id). */
  key?: keyof Line & string;
  /** Заголовок — ключ локалізації (проходить через t()). */
  title?: string;
  /**
   * Група шапки: СУМІЖНІ колонки з однаковим значенням дістають спільну
   * ячейку з colspan у верхньому ряду («Дебет» над «Рахунок» + «Субконто»),
   * решта — rowspan на обидва ряди. Без груп шапка однорядна, як звичайно.
   */
  group?: string;
  /**
   * Багаторядковий запис (стиль 1С): колонки з row: 2 (3, …) малюються
   * ДРУГИМ `<tr>` того самого запису — під сіткою колонок першого ряду,
   * зліва направо в порядку оголошення. Скільки колонок сітки накриває
   * ячейка — задає `span` (за замовчуванням 1); залишок сітки добивається
   * порожньою ячейкою. Ряд заголовків для підрядка малюється, лише якщо хоч
   * одна його колонка має title; `total` на підрядкових колонках ігнорується.
   */
  row?: number;
  span?: number;
  /** Ширина CSS ("7rem"). Без значення — гнучка колонка. */
  width?: string;
  align?: "left" | "right" | "center";
  /** Умовна колонка: показана, лише коли поверне true (валюта в проводках). */
  visible?: () => boolean;

  /** decimal/computed: точність (default 2) і підсумок у tfoot. */
  precision?: number;
  total?: boolean;

  /** picker: маршрут в'ю (family/model), як у `<ui-picker url>`. */
  url?: string;
  displayField?: string;
  hintField?: string;
  showClear?: boolean;
  /**
   * Ключ вкладеного об'єкта-ссылки поруч із `key`: `bankId` → `bank`
   * (`{ id, name }`). За замовчуванням — `key` без суфікса Id.
   */
  refKey?: string;

  /**
   * Обов'язкова комірка. Функція — умовна обов'язковість від самого рядка:
   * `required: (l) => l.kind === "goods"`. Порожньою вважається `null`,
   * `undefined` і порожній рядок; `0` і `false` — заповнені, тож «сума має
   * бути більшою за нуль» пишеться в `check`, а не тут.
   */
  required?: boolean | ((line: Line, index: number) => boolean);

  /**
   * Власна перевірка комірки: `null` — гаразд, рядок — текст помилки (уже
   * локалізований). Порожнього значення не бачить — це діло `required`.
   */
  check?: (value: unknown, line: Line, index: number) => string | null | undefined;

  /** computed: значення комірки з рядка (рахуй через dec()). */
  value?: (line: Line) => string;

  /** custom: повна розмітка комірки (вміст `<td>`). */
  render?: (line: Line, index: number) => TemplateResult;

  /**
   * @deprecated Приймається й НЕ використовується. Оголошення можна прибирати.
   *
   * Поле з'явилося разом із поданням значень текстом у нередагованих рядках
   * (client 0.15.0) і пішло разом із ним: контроли знову живуть у кожному
   * рядку, тож малювати «плоский» вигляд комірки нікому й ніде. Залишене в
   * типі навмисно — на момент відкоту воно стояло в сотнях оголошень колонок
   * прикладних форм, і прибирання поля зупинило б перевірку типів у них
   * замість того, щоб просто повернути старий вигляд таблиці.
   */
  display?: (line: Line, index: number) => TemplateResult | string;
}

export interface TabularConfig<Line extends object> {
  /** Читання рядків — з `$root` форми. */
  rows: () => Line[];
  /** Запис рядків — форма кладе їх назад у `$root` (immutable-заміна). */
  setRows: (rows: Line[]) => void;
  columns: Array<TabularColumn<Line>>;
  /** Нова строка: TypeBox-схема рядка (Value.Create)… */
  schema?: TObject;
  /** …або фабрика, якщо порожня строка не виводиться зі схеми. */
  createLine?: () => Line;
  /** Поле наскрізного номера; null — не вести. */
  lineNoKey?: (keyof Line & string) | null;
  /** Додаткова канонізація рядка поверх десяткової (analytics ?? {} тощо). */
  normalizeLine?: (line: Line) => Line;
  /** Колонка «#» і кнопка видалення в рядку (обидві — за замовчуванням так). */
  showLineNo?: boolean;
  rowDelete?: boolean;
  /**
   * Режим перегляду. Функція, а не прапорець: форма віддає сюди свій
   * `readonlyMode`, який залежить від прав, а права — сигнал; отже значення
   * має читатися на кожен рендер, а не запам'ятовуватися при створенні секції.
   *
   * Потрібен окремо від `fieldset[disabled]` форми: комірки живуть у shadow
   * root таблиці, куди каскад не проходить.
   */
  readonly?: () => boolean;
  /**
   * Розширення панелі дій: розмітка, яку `<ui-tabular-toolbar>` ставить
   * праворуч від своїх кнопок — поле сканування штрихкоду, кнопка «Заповнити».
   *
   * У конфігу секції, а не у вкладці `<ui-form-tabs>`: панель буває й поза
   * вкладками, і розширення мусить їхати разом із секцією, куди б її не
   * поставили. Без нього форма з полем у панелі мусила б відмовитися від
   * `section` на вкладці — а з ним і від лічильника, позначки помилки й
   * перемикання на вкладку з помилкою.
   *
   * Три речі, яких панель за розширення НЕ робить:
   * - **не вимикає його в режимі перегляду** — розмітка чужа, панель не знає,
   *   що в ній вимикати; читай `section.readonly` у своєму шаблоні;
   * - **не перемальовується від стану форми.** Функція читається на кожен
   *   рендер панелі, а панель малюється від змін секції та сигналів, які
   *   прочитала (`SignalWatcher`); `@state` форми до неї не доходить — нова
   *   розмітка форми віддає панелі ту саму секцію. Стан розширення (підказка
   *   після сканування) тримай у сигналі;
   * - **не забирає `Enter`.** Нативне поле в панелі — поле форми для
   *   «`Enter` — далі» (`BaseUI`): хто обробляє `Enter` сам, позначає
   *   `preventDefault()`, інакше фокус піде на наступне поле.
   */
  toolbarExtra?: () => TemplateResult;
}

/** Відкладений фокус: комірка, яку таблиця сфокусує після рендера. */
export interface PendingFocus {
  row: number;
  col: number;
}

export class TabularSection<Line extends object> {
  readonly config: TabularConfig<Line>;

  /** Поточний рядок — ціль дій тулбара. -1 — не вибрано. */
  currentIndex = -1;

  /** Споживає `<ui-tabular-table>` у updated(). */
  pendingFocus: PendingFocus | null = null;

  // Секцію рендерять кілька елементів (форма, таблиця, тулбар) — зміна стану
  // має перемалювати всіх, хто підписався через bind().
  #hosts = new Set<ReactiveControllerHost>();

  constructor(host: ReactiveControllerHost, config: TabularConfig<Line>) {
    this.config = config;
    this.#hosts.add(host);
  }

  bind(host: ReactiveControllerHost) {
    this.#hosts.add(host);
  }

  unbind(host: ReactiveControllerHost) {
    this.#hosts.delete(host);
  }

  #notify() {
    for (const host of this.#hosts) host.requestUpdate();
  }

  /**
   * Лічильник «усе намальоване застаріло» — його читає подання, що кешує рядки
   * (`guard` у `<ui-tabular-table>`).
   *
   * Кеш відрізняє змінений рядок за identity: `patch()` кладе на його місце
   * НОВИЙ об'єкт. Але дві речі лежать поза рядком і так не видні —
   * перераховані помилки й стан, який custom-комірка читає з форми. Обидві
   * рухають це число, і кеш скидається цілком.
   */
  #epoch = 0;

  get epoch(): number {
    return this.#epoch;
  }

  /**
   * Перемалювати всі подання секції. Потрібен формам, чиї custom-комірки
   * залежать від стану ПОЗА `$root` (кеш конфігурації рахунків у проводках):
   * такий стан сигналами не трекається, і без цього виклику таблиця
   * дізнавалася б про нього лише з наступної дії користувача.
   *
   * Відтоді, як подання кешує рядки, цей виклик ще й скидає кеш — інакше
   * `requestUpdate()` сам собою перемалював би таблицю, а рядки лишив би
   * старими.
   */
  refresh() {
    this.#epoch++;
    this.#notify();
  }

  // ── Читання ────────────────────────────────────────────────────────────────

  get rows(): Line[] {
    return this.config.rows() ?? [];
  }

  get lineNoKey(): string | null {
    return this.config.lineNoKey === null ? null : (this.config.lineNoKey ?? "lineNo");
  }

  get showLineNo(): boolean {
    return this.config.showLineNo !== false && this.lineNoKey !== null;
  }

  /** Режим перегляду: рядки видно, змінювати їх не можна. */
  get readonly(): boolean {
    return this.config.readonly?.() ?? false;
  }

  /**
   * Колонка з кошиком у рядку. У режимі перегляду вона ЛИШАЄТЬСЯ (кнопки в ній
   * вимкнені) — з тієї ж причини, що й панель дій: зникла колонка каже «дії тут
   * немає ніколи», а проведення документа ще й міняло б від цього ширину
   * таблиці просто під час перегляду.
   */
  get rowDelete(): boolean {
    return this.config.rowDelete !== false;
  }

  visibleColumns(): Array<TabularColumn<Line>> {
    return this.config.columns.filter((c) => !c.visible || c.visible());
  }

  /** Підсумок колонки (total: true) точною десятковою арифметикою. */
  total(key: string): string {
    const col = this.config.columns.find((c) => (c.key ?? "") === key || c.refKey === key);
    // Ключ кешу — сам рядок `key`, а не знайдена колонка: `columnTotal` тримає
    // під колонкою СВІЙ внесок (`col.key`), і при збігу через `refKey` це різні
    // числа. Два записи замість одного — дешевше за пошук збігу, якого не має
    // бути.
    return this.#sum(
      key,
      (line) => col?.value ? dec(col.value(line)) : dec((line as Record<string, unknown>)[key]),
      col?.precision ?? 2,
    );
  }

  /** Підсумок оголошеної колонки — те, що малює `<tfoot>` подання. */
  columnTotal(col: TabularColumn<Line>): string {
    return this.#sum(
      col,
      (line) =>
        col.value ? dec(col.value(line)) : dec((line as Record<string, unknown>)[col.key ?? ""]),
      col.precision ?? 2,
    );
  }

  /**
   * Кеш внесків рядків у підсумок. Ключ — колонка (або рядковий ключ у
   * `total`), значення — внески в тому ж порядку, що й рядки.
   */
  #totals = new Map<unknown, { epoch: number; rows: Line[]; parts: Decimal[]; sum: Decimal }>();

  /**
   * Сума з кешем внесків.
   *
   * Підсумок стоїть ПОЗА кешем записів подання, тож доти він був єдиним, хто
   * при кожній правці комірки обходив усі рядки: на тисячі рядків три
   * підсумкові колонки коштували 10 мс на кожне натискання клавіші. А
   * змінюється при цьому один рядок із тисячі — решта внесків та сама.
   *
   * Незмінний рядок упізнається за identity, як і в кеші записів: `patch()`
   * кладе на місце зміненого рядка новий об'єкт. Стан ПОЗА рядком (його може
   * читати `col.value`) кеш не бачить — його скидає `epoch`, тобто той самий
   * `refresh()`, що й для записів.
   *
   * Суму перескладаємо з внесків ЦІЛКОМ, а не правимо відніманням старого й
   * додаванням нового. Так результат побайтово той самий, що й у повного
   * перерахунку, і накопичити розбіжність між правками ніяк — а підсумок, що
   * тихо розійшовся з даними, коштує дорожче за виграні мілісекунди.
   */
  #sum(cacheKey: unknown, part: (line: Line) => Decimal, precision: number): string {
    const rows = this.rows;
    const cached = this.#totals.get(cacheKey);
    const usable = cached && cached.epoch === this.#epoch;

    // Той самий масив рядків — рахувати нема чого (перемальовок заради
    // виділення рядка, чужої колонки, режиму перегляду).
    if (usable && cached.rows === rows) return cached.sum.toFixed(precision);

    let parts: Decimal[];
    let changed = true;
    if (usable && cached.rows.length === rows.length) {
      parts = cached.parts;
      changed = false;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i] === cached.rows[i]) continue;
        const next = part(rows[i]);
        // Правка сусідньої колонки теж дає новий об'єкт рядка, але на ЦЕЙ
        // підсумок не впливає — тоді й перескладати нема чого.
        if (next.equals(parts[i])) continue;
        parts[i] = next;
        changed = true;
      }
    } else {
      parts = rows.map(part);
    }

    const sum = usable && !changed
      ? cached.sum
      : parts.reduce((s, p) => s.plus(p), new Decimal(0));

    this.#totals.set(cacheKey, { epoch: this.#epoch, rows, parts, sum });
    return sum.toFixed(precision);
  }

  /**
   * Рядки в канонічному вигляді: десяткові колонки — toFixed(precision), далі
   * хук normalizeLine. Викликати навколо save/get/post — SQL віддає numeric
   * числом, а форма тримає рядок.
   */
  normalizedRows(): Line[] {
    return this.rows.map((line) => {
      let out: Line = { ...line };
      for (const col of this.config.columns) {
        if (col.kind !== "decimal" || !col.key) continue;
        (out as Record<string, unknown>)[col.key] =
          dec((line as Record<string, unknown>)[col.key]).toFixed(col.precision ?? 2);
      }
      if (this.config.normalizeLine) out = this.config.normalizeLine(out);
      return out;
    });
  }

  /**
   * Привести десяткові В `$root` до канонічного вигляду. Кличе це БАЗА форми
   * (`BaseUI.assign`) — там, де рядки з відповіді щойно лягли в `$root`, а не
   * там, де про це згадали.
   *
   * Навіщо взагалі: SQL віддає `numeric` числом, `JSON.parse` лишає від
   * `15.000` просто `15`, а форма тримає десяткові РЯДКОМ. Тобто `<ui-decimal>`
   * отримував би `"15"` і показував саме це — доки комірку не торкнеш.
   *
   * Дві межі, і обидві навмисні.
   *
   * Хук `normalizeLine` тут НЕ виконується, хоч `normalizedRows()` його й
   * кличе. Це оголошене застосунком перетворення, і воно не завжди про формат:
   * буває, що воно ПЕРЕРАХОВУЄ похідні поля рядка. На шляху запису це слушно —
   * рахує той, хто відправляє; на шляху читання це означало б, що пораховане
   * сервером мовчки заміняється порахованим клієнтом. Тому тут лише десяткові.
   *
   * Порожнє лишається порожнім. `normalizedRows()` жене все через
   * `toFixed()`, і `null` там стає «0.00» — для payload-а це правильно, бо
   * число зобов'язане бути числом. Тут навпаки: необов'язкова колонка, яку
   * ніхто не заповнював, після відкриття форми не має показувати нуль.
   *
   * Нічого не змінилося — нічого й не пишемо: інакше кожне читання підміняло б
   * масив рядків і на рівному місці скидало кеш записів і кеш підсумків.
   */
  canonicalize(): void {
    let changed = false;
    const next = this.rows.map((line) => {
      let out: Line | null = null;
      for (const col of this.config.columns) {
        if (col.kind !== "decimal" || !col.key) continue;
        const raw = (line as Record<string, unknown>)[col.key];
        if (raw == null || raw === "") continue;
        const canonical = dec(raw).toFixed(col.precision ?? 2);
        if (canonical === raw) continue;
        out ??= { ...line };
        (out as Record<string, unknown>)[col.key] = canonical;
      }
      if (out) changed = true;
      return out ?? line;
    });
    if (changed) this.config.setRows(next);
  }

  // ── Перевірка рядків ───────────────────────────────────────────────────────

  /** Помилки комірок: індекс рядка → колонка → текст. */
  #errors = new Map<number, Map<TabularColumn<Line>, string>>();

  /** Перевірка вже спрацьовувала — далі перераховуємо на кожну правку. */
  #live = false;

  /** Текст помилки комірки — читає подання таблиці. Порожньо — все гаразд. */
  cellError(row: number, col: TabularColumn<Line>): string {
    return this.#errors.get(row)?.get(col) ?? "";
  }

  /** Скільки комірок не пройшли перевірку. */
  get errorCount(): number {
    let count = 0;
    for (const row of this.#errors.values()) count += row.size;
    return count;
  }

  /**
   * Перевірити всі рядки за правилами колонок (`required` / `check`).
   * Повертає кількість помилок; самі помилки лишає в собі — подання читає їх
   * через `cellError()`.
   *
   * Перевіряються лише ВИДИМІ колонки: сховану умовну колонку (валюта в
   * проводках) підсвітити нікуди, та й вимагати від неї нічого не можна.
   */
  validate(): number {
    this.#live = true;
    this.#recompute();
    this.#notify();
    return this.errorCount;
  }

  /**
   * Повідомлення для банера форми: рядок і колонка, а не саме лише
   * «заповніть поля» — у документі на два десятки рядків це різниця між
   * підказкою і загадкою.
   */
  firstErrorText(): string {
    const rows = [...this.#errors.keys()].sort((a, b) => a - b);
    for (const row of rows) {
      for (const [col, text] of this.#errors.get(row)!) {
        const title = col.title ? `, «${t(col.title)}»` : "";
        return `${t("tabular.row")} ${row + 1}${title}: ${text}`;
      }
    }
    return "";
  }

  /** Перша невалідна комірка — форма веде туди фокус. */
  firstErrorCell(): PendingFocus | null {
    const rows = [...this.#errors.keys()].sort((a, b) => a - b);
    const visible = this.visibleColumns();
    for (const row of rows) {
      for (const col of this.#errors.get(row)!.keys()) {
        const index = visible.indexOf(col);
        if (index >= 0) return { row, col: index };
      }
    }
    return null;
  }

  #recompute() {
    // Помилки лежать поза рядком і можуть переїхати між рядками, лишивши
    // однакову кількість — отже кеш подання скидаємо на будь-який перерахунок,
    // а не за `errorCount`.
    this.#epoch++;
    this.#errors.clear();
    const columns = this.visibleColumns();
    this.rows.forEach((line, index) => {
      for (const col of columns) {
        if (!col.required && !col.check) continue;
        const value = col.key ? (line as Record<string, unknown>)[col.key] : undefined;
        const empty = value == null || (typeof value === "string" && value.trim() === "");

        let text: string | null | undefined;
        if (empty) {
          const required = typeof col.required === "function"
            ? col.required(line, index)
            : col.required === true;
          if (required) text = t("common.fieldRequired");
        } else {
          text = col.check?.(value, line, index);
        }
        if (!text) continue;

        let row = this.#errors.get(index);
        if (!row) this.#errors.set(index, row = new Map());
        row.set(col, text);
      }
    });
  }

  /**
   * Перерахувати помилки після правки — але лише коли перевірка вже
   * спрацьовувала: доки користувач не натиснув «Зберегти», порожній новий
   * рядок не має світитися червоним.
   */
  #resync() {
    if (!this.#live) return;
    this.#recompute();
  }

  // ── Дії ────────────────────────────────────────────────────────────────────

  select(index: number) {
    if (this.currentIndex === index) return;
    this.currentIndex = index;
    this.#notify();
  }

  /** Заплатити зміну поля рядка (комірки таблиці кличуть саме це). */
  patch(index: number, patch: Partial<Line>) {
    if (this.readonly) return;
    this.config.setRows(this.rows.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    // Помилки прив'язані до індексу рядка, тож будь-яка правка (а надто
    // вставка, видалення й перестановка) вимагає перерахунку з нуля.
    this.#resync();
  }

  /**
   * Знімок щойно доданого рядка: скільки рядків стало й як він виглядав. За ним
   * `isUntouchedNewLine` упізнає рядок, у який ще нічого не внесли, — такий Esc
   * прибирає (як в 1С: додав, передумав, Esc).
   *
   * Знімок, а не прапорець «рядок змінено»: правку комірки, що повернула
   * значення назад (стерли вибране в пікері), прапорець рахував би зміною, а
   * порожній рядок лишався б порожнім. Рядок зі знімка рахується САМЕ ТИМ
   * рядком лише доки він останній і кількість рядків та сама — будь-яка
   * вставка чи видалення знімок знецінює.
   */
  #added: { count: number; snapshot: string } | null = null;

  addLine() {
    if (this.readonly) return;
    const line = this.#newLine();
    const rows = this.#renumber([...this.rows, line]);
    this.config.setRows(rows);
    this.#added = { count: rows.length, snapshot: JSON.stringify(this.rows[rows.length - 1]) };
    this.currentIndex = rows.length - 1;
    this.pendingFocus = { row: this.currentIndex, col: 0 };
    this.#resync();
    this.#notify();
  }

  /**
   * Копія поточного рядка — БЕЗ id: merge збереження зшиває рядки за id, і
   * клон з тим самим id перезаписав би оригінал замість створити новий.
   */
  copyLine(index = this.currentIndex) {
    if (this.readonly) return;
    const source = this.rows[index];
    if (!source) return;
    const clone = JSON.parse(JSON.stringify(source)) as Line;
    (clone as Record<string, unknown>).id = null;
    const rows = [...this.rows];
    rows.splice(index + 1, 0, clone);
    this.config.setRows(this.#renumber(rows));
    this.currentIndex = index + 1;
    this.pendingFocus = { row: this.currentIndex, col: 0 };
    this.#resync();
    this.#notify();
  }

  /** Рядок щойно доданий і в нього досі нічого не внесли. */
  isUntouchedNewLine(index = this.currentIndex): boolean {
    const added = this.#added;
    const rows = this.rows;
    return added !== null
      && index === rows.length - 1
      && rows.length === added.count
      && JSON.stringify(rows[index]) === added.snapshot;
  }

  /**
   * Прибрати щойно доданий рядок, якщо в нього нічого не внесли. `false` —
   * рядок не такий (заповнений, давній, або секція лише для перегляду), і
   * нічого не сталося: заповнений рядок Esc не видаляє ніколи.
   */
  discardNewLine(index = this.currentIndex): boolean {
    if (this.readonly || !this.isUntouchedNewLine(index)) return false;
    this.#added = null;
    this.removeLine(index);
    return true;
  }

  removeLine(index = this.currentIndex) {
    if (this.readonly) return;
    if (!this.rows[index]) return;
    const rows = this.#renumber(this.rows.filter((_, i) => i !== index));
    this.config.setRows(rows);
    this.currentIndex = Math.min(index, rows.length - 1);
    this.#resync();
    this.#notify();
  }

  /** Пересунути поточний рядок на delta позицій (-1 вище / +1 нижче). */
  move(delta: number, index = this.currentIndex) {
    if (this.readonly) return;
    const target = index + delta;
    if (!this.rows[index] || target < 0 || target >= this.rows.length) return;
    const rows = [...this.rows];
    [rows[index], rows[target]] = [rows[target], rows[index]];
    this.config.setRows(this.#renumber(rows));
    this.currentIndex = target;
    this.#resync();
    this.#notify();
  }

  // ── Внутрішнє ──────────────────────────────────────────────────────────────

  #newLine(): Line {
    if (this.config.createLine) return this.config.createLine();
    if (this.config.schema) return Value.Create(this.config.schema) as Line;
    throw new Error("TabularSection: потрібен schema або createLine");
  }

  /** Номер рядка завжди = позиція + 1: порядок у таблиці і є порядком. */
  #renumber(rows: Line[]): Line[] {
    const key = this.lineNoKey;
    if (!key) return rows;
    return rows.map((l, i) =>
      (l as Record<string, unknown>)[key] === i + 1 ? l : { ...l, [key]: i + 1 }
    );
  }
}
