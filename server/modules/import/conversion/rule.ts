/**
 * Правило конвертації — формат набору `app/_import/<джерело>/*.rule.ts`.
 *
 * МЕЖА ВІЛЬНОЇ ФУНКЦІЇ (план міграції, рішення 26.09.2026, варіант C). Правило —
 * декларація, яку шлюз перевіряє з двох боків: метаданими джерела й схемою цілі.
 * Функція буває лише у двох позначених формах:
 *
 *   - `calc(входи, fn)` — ОДНЕ поле цілі з названих реквізитів;
 *   - `transform: { why, reads, fn }` — об'єкти цілі цілком, коли вхідний рядок
 *     не збігається з вихідним об'єктом (розкладка ОСВ на розділи залишків).
 *
 * Обидві чисті: без бази, `await`, мережі й годинника. Читають лише оголошене —
 * на прогоні рядок джерела є проксі, і чужий реквізит падає помилкою. Посилань
 * в обхід `ref` не створюють: id наших записів функція не бачить узагалі, у
 * payload лягає МАРКЕР із посиланням джерела, а розв'язує його рушій за картою
 * (`app.source_ref`). Так усі шість перевірок шлюзу лишаються — у найгіршому
 * разі перевірка переходить зі «статично» в «прогоном».
 *
 * Кілька запитів — декларативний `join` за ключем об'єкта: функція бачить ОДИН
 * з'єднаний рядок і рядків інших запитів сама не бере.
 *
 * Формат визрів у застосунку (перенесення з BAS, 28+ правил, завершена
 * міграція) і піднятий сюди перенесенням коду. Слів джерела тут немає жодного —
 * імена реквізитів це ДАНІ правила; навіть ім'я колонки, якою рядок табличної
 * частини посилається на власника, називає НАБІР (`RuleSetDefaults`), а не
 * ядро. `mapTable` із первісного переліку свідомо не піднято: на всьому наборі
 * він не знадобився жодного разу, а форма «про запас» лишилася б у застосунках
 * назавжди.
 */
import type { Static, TObject } from "@sinclair/typebox";

// ── Сировина ─────────────────────────────────────────────────────────────────

/** Посилання так, як його віддає джерело: трійка «ключ, тип, подання». */
export interface SourceRef {
  ref: string;
  type: string;
  presentation: string;
}

/** Значення перелічення: ім'я значення, тип, подання. */
export interface SourceEnum {
  enum: string;
  type: string;
  presentation: string;
}

/** Рядок запиту джерела (`app.source_row.payload`). */
export type SourceRow = Record<string, unknown>;

export function isSourceRef(value: unknown): value is SourceRef {
  return typeof value === "object" && value !== null &&
    typeof (value as SourceRef).ref === "string" && typeof (value as SourceRef).type === "string";
}

export function isSourceEnum(value: unknown): value is SourceEnum {
  return typeof value === "object" && value !== null && typeof (value as SourceEnum).enum === "string";
}

// ── Маркер посилання ─────────────────────────────────────────────────────────

/**
 * Посилання в payload до розв'язання. Лежить там, де ціль чекає id запису (або
 * `{ id, name }` субконто): рушій замінює його за картою, сухий прогін —
 * заглушкою, щоб перевірити решту схемою цілі.
 */
export interface RefMarker {
  $ref: SourceRef;
  /**
   * Об'єкта може законно не бути в перенесенні (див. `ref(…, { orEmpty })`):
   * тоді поле лягає порожнім, а рушій каже попередження з цією причиною.
   */
  $orEmpty?: string;
}

export function isRefMarker(value: unknown): value is RefMarker {
  return typeof value === "object" && value !== null && isSourceRef((value as RefMarker).$ref);
}

export function refMarker(value: unknown): RefMarker | null {
  return isSourceRef(value) ? { $ref: value } : null;
}

/**
 * Засіяний рядок НАШОЇ моделі за її ключем — там, де джерело посилання не
 * несе, бо об'єкт у нього мається на увазі самим регістром: у
 * `СтавкиНалогаНаПрибыль` податку немає, це ставка податку на прибуток за
 * визначенням. Розв'язує рушій (`select id … where …`), як ключ `match`; рядка
 * немає — помилка рядка, а не порожнє поле: сід регламентований, і його
 * відсутність означає неопубліковану схему.
 */
export interface SeedMarker {
  $seed: { model: string; where: Record<string, string | number> };
}

export function isSeedMarker(value: unknown): value is SeedMarker {
  return typeof value === "object" && value !== null && typeof (value as SeedMarker).$seed?.model === "string";
}

/**
 * Запис НАШОЇ моделі за значенням поля рядка — там, де посилання джерела немає
 * взагалі: рядок виписки банку несе ЄДРПОУ, IBAN і назву контрагента, а не
 * його ключ. Інтерпретатор кладе в маркер уже ПРОЧИТАНІ значення (бази він не
 * бачить), рушій шукає за ними ключ за ключем — див. `lookup()`.
 */
export interface LookupMarker {
  $lookup: {
    model: string;
    /** Ключі з підставленими значеннями — у порядку правила, порожні вже відкинуто. */
    keys: ResolvedLookupKey[];
    /** Як назвати шукане людині: значення першого непорожнього ключа. */
    label: string;
    orEmpty?: string;
  };
}

/** Ключ `lookup` зі значеннями замість шляхів рядка. */
export type ResolvedLookupKey =
  | { where: Record<string, string> }
  | { via: string; where: Record<string, string>; pick: string };

export function isLookupMarker(value: unknown): value is LookupMarker {
  return typeof value === "object" && value !== null && typeof (value as LookupMarker).$lookup?.model === "string";
}

// ── Вирази полів ─────────────────────────────────────────────────────────────

export type Expr =
  | { op: "field"; path: string }
  | { op: "ref"; path: string; type?: string; unlessSame?: string; orEmpty?: string }
  | { op: "enum"; path: string; map: Record<string, unknown>; hasFallback: boolean; fallback?: unknown }
  | { op: "const"; value: unknown }
  | { op: "text"; path: string }
  | { op: "date"; path: string }
  | { op: "number"; path: string }
  | { op: "calc"; inputs: string[]; fn: (...values: unknown[]) => unknown }
  | { op: "analytics"; account: string; subconto: string[]; byType: Record<string, string> }
  | { op: "seeded"; model: string; where: Record<string, string | number> }
  | { op: "lookup"; model: string; keys: LookupKey[]; orEmpty?: string }
  | { op: "line" };

/**
 * Один ключ `lookup`: поле цілі → шлях у рядку. Кілька полів — складений ключ.
 * Форма з `via` шукає в ІНШІЙ моделі й бере з знайденого рядка посилання
 * `pick`: IBAN лежить не в контрагенті, а в його банківському рахунку.
 */
export type LookupKey =
  | Record<string, string>
  | { via: string; where: Record<string, string>; pick: string };

export function isViaKey(key: LookupKey): key is { via: string; where: Record<string, string>; pick: string } {
  return typeof (key as { via?: unknown }).via === "string";
}

/** Рядок у полі правила — скорочення для `{ op: "field", path }`. */
export type FieldExpr = string | Expr;

/**
 * Реквізит, що посилається на інший об'єкт джерела. `type` — для реквізиту
 * складеного типу, який у нас розходиться по кількох полях (власник
 * банківського рахунку: організація АБО контрагент): посилання іншого типу
 * дає `null`. `unlessSame` — реквізит, з яким посилання не мусить збігатися:
 * «головний контрагент» у джерелі в звичайного контрагента дорівнює йому
 * самому, а в нас посилання на себе означало б хибний зв'язок.
 *
 * `orEmpty` — посилання, яке законно веде ЗА МЕЖІ перенесення: документ після
 * D посилається на надходження ДО D («документ оприбуткування» — партія), а
 * документів до D режим 1 не возить. Без позначки такий документ не записався
 * б узагалі («об'єкта немає в знімку»); з нею поле лягає порожнім, і рушій
 * каже попередження з причиною. Лише для НЕОБОВ'ЯЗКОВОГО поля: обов'язкове
 * порожнім однаково не запишеться.
 */
export function ref(path: string, options: { type?: string; unlessSame?: string; orEmpty?: string } = {}): Expr {
  return { op: "ref", path, type: options.type, unlessSame: options.unlessSame, orEmpty: options.orEmpty };
}

/**
 * Перелічення джерела → наш код. Значення поза картою — помилка рядка, а не
 * тихе умовчання: інакше перевірка 3 шлюзу («перелічення покриті») нічого не
 * варта. `fallback` — лише свідомий, для порожнього значення; переданий
 * `undefined` означає «порожнє — поля немає», а не «умовчання не задано».
 */
export function enumMap(path: string, map: Record<string, unknown>, ...fallback: [unknown?]): Expr {
  return { op: "enum", path, map, hasFallback: fallback.length > 0, fallback: fallback[0] };
}

/**
 * Субконто рядка → `analytics` цілі: `{ вимір: посилання }`.
 *
 * Рахунок — посилання на план рахунків джерела, код у його поданні (запит
 * кладе туди `.Код`). Кожне заповнене субконто лягає на наш вимір за ТИПОМ
 * значення (`byType`), і лишаються лише виміри, які веде НАШ рахунок з тим
 * кодом — за знімком плану рахунків, що приходить у вхід разом з рядками
 * (той самий, що бачить `lib.account` у `transform`). Позиція субконто не
 * важить: порядок слотів у джерела й у нас різний.
 *
 * Порожній рахунок — порожня аналітика. Рахунку немає в нашому плані —
 * помилка рядка: субконто тоді нема з чим звірити, а проводка на такий
 * рахунок однаково не ляже.
 */
export function analytics(account: string, subconto: readonly string[], byType: Record<string, string>): Expr {
  return { op: "analytics", account, subconto: [...subconto], byType };
}

/**
 * Засіяний рядок нашої моделі за полями її ключа (`seeded("catalog/tax",
 * { code: "PROFIT" })`) — див. `SeedMarker`. Реквізитів джерела не читає.
 */
export function seeded(model: string, where: Record<string, string | number>): Expr {
  return { op: "seeded", model, where };
}

/**
 * Запис нашої моделі за значеннями полів рядка (`seeded`, але умова — з
 * рядка, а не константа):
 *
 * ```ts
 * counterpartyId: lookup("catalog/counterparty", [
 *   { edrpou: "ЄДРПОУ" },
 *   { via: "catalog/bank_account", where: { iban: "IBAN" }, pick: "counterpartyId" },
 * ])
 * ```
 *
 * Ключі пробуються ПО ЧЕРЗІ; ключ, у якого поле рядка порожнє, пропускається.
 * Трьох ісходів не можна змішувати, тож вони різні:
 *
 *   - знайдено один — id;
 *   - знайдено кілька — помилка рядка ОДРАЗУ, без наступного ключа: вибір між
 *     двома контрагентами з одним ЄДРПОУ — рішення людини, а не збіг ключа;
 *   - не знайдено жодним ключем — помилка рядка, або, з `orEmpty`, порожнє
 *     поле й попередження з причиною (як у `ref`). Лише для НЕОБОВ'ЯЗКОВОГО
 *     поля.
 *
 * Межу вільної функції форма не розмиває: функції в ній немає, читає вона
 * оголошені поля рядка й ціль — як `match`. Значення ключа — скаляр; посилання
 * джерела тут помилка рядка, для нього є `ref`.
 */
export function lookup(model: string, keys: readonly LookupKey[], options: { orEmpty?: string } = {}): Expr {
  return { op: "lookup", model, keys: [...keys], orEmpty: options.orEmpty };
}

/**
 * Номер рядка частини по порядку — з 1, у тому порядку, який задав `order`
 * частини. Для джерел без `НомерСтроки`: регістр відомостей, що лягає
 * табличною частиною (склад набору статей), номера рядка не має взагалі, а
 * `lineNo` цілі обов'язковий. Поза полем рядка частини — помилка, а не нуль.
 */
export function lineNumber(): Expr {
  return { op: "line" };
}

export function constant(value: unknown): Expr {
  return { op: "const", value };
}

/**
 * Рядок без крайніх пробілів; порожній — ПОЛЯ НЕМАЄ (`undefined`), а не `null`:
 * необов'язкове текстове поле цілі `null` не приймає, а відсутнє ключове поле
 * `_save` і так читає як порожнє.
 */
export function text(path: string): Expr {
  return { op: "text", path };
}

/** Дата ISO без часу; порожня дата джерела (`0001-01-01`) — `null`. */
export function date(path: string): Expr {
  return { op: "date", path };
}

/** Число з рядка джерела; порожнє — `null`. */
export function number(path: string): Expr {
  return { op: "number", path };
}

/**
 * Поле з кількох реквізитів. Функція отримує значення РІВНО названих входів і
 * в тому ж порядку — рядка вона не бачить, тож прочитати щось поза `inputs` не
 * може.
 */
export function calc<const I extends readonly string[]>(
  inputs: I,
  fn: (...values: { [K in keyof I]: unknown }) => unknown,
): Expr {
  return { op: "calc", inputs: [...inputs], fn: fn as (...values: unknown[]) => unknown };
}

// ── Функція на об'єкт ────────────────────────────────────────────────────────

/**
 * Рахунок НАШОГО плану — довідкові дані цілі. Функція їх не запитує: знімок
 * плану рахунків кладе у вхід той, хто проганяє правило (сухий прогін, рушій),
 * тож результат лишається функцією від входу.
 */
export interface TargetAccount {
  code: string;
  type: string;
  offBalance: boolean;
  /**
   * Кількісний рахунок: проводка на нього вимагає кількості — хай і нульової
   * (сума без кількості в джерелі буває, і це його свідчення, а не наш дефект).
   */
  quantitative?: boolean;
  /** Виміри субконто за слотами — саме їх приймає проводка. */
  dimensions: string[];
}

/** Що бачить `transform`: перетворення без доступу до бази. */
export interface TransformLib {
  /** Рахунок нашого плану за кодом; немає такого — `null`. */
  account(code: string): TargetAccount | null;
  /** Маркер посилання — єдиний спосіб покласти в payload посилання. */
  ref(value: unknown): RefMarker | null;
  /** Число з рядка джерела; порожнє — 0. */
  num(value: unknown): number;
  /** Параметри сесії (дата D тощо) — тільки читання. */
  readonly params: Readonly<Record<string, unknown>>;
  /** Рядок свідомо не переноситься цим правилом — з причиною, для звіту. */
  skip(row: SourceRow, reason: string): void;
  /** Рядок переноситься, але людині варто на нього глянути — з причиною. */
  warn(row: SourceRow, reason: string): void;
}

export interface TransformOutput {
  /** Ключ об'єкта цілі: з ним об'єкт лягає в карту й звіряється між прогонами. */
  key: string;
  payload: Record<string, unknown>;
}

export interface Transform {
  /** Чому декларації мало. Без причини правило не компілюється — як `skip`. */
  why: string;
  /** Реквізити, які функція читає. Чужий реквізит на прогоні — помилка. */
  reads: readonly string[];
  /** Рядки групуються за цими реквізитами, і функція кличеться на групу. */
  groupBy?: readonly string[];
  fn(rows: SourceRow[], lib: TransformLib): TransformOutput[];
}

// ── Правило ──────────────────────────────────────────────────────────────────

export interface Join {
  /** Пункт плану, рядки якого приєднуються. */
  query: string;
  /**
   * Реквізит головного рядка, за яким з'єднуємо, або кілька — складений ключ
   * (зріз регістру ОЗ ключується парою «об'єкт + організація»).
   */
  on: string | readonly string[];
  /** Реквізити приєднаного рядка, у тому ж порядку; умовчання — ті самі, що `on`. */
  by?: string | readonly string[];
}

/**
 * Таблична частина об'єкта: поле-масив цілі з рядків ОКРЕМОГО запиту
 * (`Справочник.X.ИмяЧасти`). Рядки частини йдуть до власника за посиланням
 * (`by`) проти ключа правила, у порядку `order`. Умовчання обох називає набір
 * (`RuleSetDefaults`) — це імена колонок джерела, і ядро їх не знає. Частина
 * без рядків — порожній масив, а не відсутнє поле: об'єкт без складу — теж
 * відповідь джерела.
 */
export interface Table {
  /** Пункт плану, що віддає рядки частини. */
  query: string;
  /**
   * Ім'я табличної частини ДЖЕРЕЛА. Прочитане в рядку обліковується як
   * «Частина.Реквізит» — тож для покриття частина прочитана, а неоголошене й
   * непрочитане звітуються з її ім'ям.
   */
  section: string;
  /** Колонка рядка частини з посиланням на власника; умовчання — набору. */
  by?: string;
  /** Колонка порядку рядків; умовчання — набору. */
  order?: string;
  /** Поле рядка цілі → вираз над рядком частини. */
  fields: Record<string, FieldExpr>;
}

/**
 * Умовчання НАБОРУ правил — імена, які належать джерелу, а не ядру. Для BAS це
 * `{ tableOwner: "Ссылка", tableOrder: "НомерСтроки" }`; у файлу з банку
 * табличних частин немає зовсім. Частина, якій ні правило, ні набір не назвали
 * колонку, — помилка правила, а не тихе умовчання.
 */
export interface RuleSetDefaults {
  tableOwner?: string;
  tableOrder?: string;
}

interface RuleBase<S extends TObject> {
  /** Об'єкт джерела — повне ім'я метаданих; за ним рахується покриття. */
  source: string;
  /** Пункт плану, рядки якого читає правило. */
  query: string;
  /**
   * Ціль: модель, команда запису (умовчання `save`) і схема її `payload.item`.
   * Команда буває іншою там, де модель пише частину себе окремо — групи
   * довідника (`groupSave`).
   *
   * `entity` — ім'я запису в карті (`app.source_ref.entity`), коли команда
   * пише НЕ в таблицю моделі: групи довідника лежать у `<модель>_group`, і id
   * групи під ім'ям моделі елементів змішав би дві таблиці. Умовчання — ім'я
   * моделі.
   */
  target: { model: string; command?: string; entity?: string; schema: S };
  /**
   * Прогін, у якому правило працює. Умовчання — «залишки»: довідники,
   * регістри відомостей і введення залишків на дату D. `documents` — документи,
   * введені в джерелі ПІСЛЯ D: вони йдуть ОКРЕМИМ прогоном зі своєю
   * транзакцією (план міграції: «рік документів в одній транзакції із
   * залишками не тримаємо») і проводяться нашими алгоритмами строго за часом
   * документа — тож вимагають уже записаних залишків.
   */
  stage?: "documents";
  /** Лише рядки, де реквізит дорівнює значенню (посилання й перелічення — за поданням). */
  when?: Record<string, string | number | boolean | null>;
  join?: Record<string, Join>;
  /** Реквізити джерела, які свідомо не переносяться — з причиною. */
  skip?: Record<string, string>;
  /**
   * Табличні частини й реквізити, які ЗАПИТ згорнув у колонки (контактна
   * інформація за видом). Для покриття це «відображено»: правило читає
   * колонки, а не саму частину, і без цієї позначки частина виглядала б дірою.
   */
  folded?: Record<string, string>;
}

export interface DeclarativeRule<S extends TObject> extends RuleBase<S> {
  /**
   * Ключ об'єкта — реквізит із посиланням на самого себе (для довідника це
   * `Ссылка`) або ключова колонка. Немає ключа — немає правила: друге
   * завантаження дало б дублі.
   *
   * Кілька реквізитів — складений ключ: у запису регістру відомостей власного
   * посилання немає, його ключ — набір вимірів. Порожній вимір там законний
   * («для будь-якої організації»), тож складений ключ порожнім не буває.
   */
  key: string | readonly string[];
  /** Тип, яким об'єкт з'являється в чужих посиланнях: за ним розв'язується `ref`. */
  refType?: string;
  /** Поле цілі → вираз. Ім'я поля перевіряє компілятор проти схеми цілі. */
  fields: { [K in keyof Static<S>]?: FieldExpr };
  /**
   * Поля, без яких об'єкт НЕ ПЕРЕНОСИТЬСЯ: поле цілі → причина для звіту.
   * Порожнє (відсутнє, `null`, порожній рядок) — рядок іде в пропуски з цією
   * причиною, як `lib.skip` у `transform`. Для випадку, коли джерело дозволяє
   * порожнечу, а ми ні, і рішення «не переносити» вже ухвалене людиною —
   * інакше такий рядок падав би на схемі цілі без пояснення, що з ним робити.
   */
  requires?: { [K in keyof Static<S>]?: string };
  /** Поле-масив цілі → таблична частина джерела. */
  tables?: { [K in keyof Static<S>]?: Table };
  /**
   * Рівень «ключ» карти: за якими полями ЦІЛІ об'єкт шукається серед рядків,
   * що вже були в нашій базі до перенесення (сід, заведене руками). Кожен
   * елемент — окремий ключ, з одного поля чи складений; пробуються по черзі,
   * ключ із порожнім полем пропускається.
   *
   * Знайдений рядок отримує ЛИШЕ зв'язок у карті (`method = exact`): ні сід, ні
   * заведене людиною перенесення не переписує (рішення 26.09.2026). Серед
   * кандидатів немає рядків, які перенесення завело само: два об'єкти джерела
   * з одним ЄДРПОУ — це дублі, і зводить їх рішення людини, а не збіг ключа.
   * Двох кандидатів — помилка рядка: вибір між ними теж рішення, а не ключ.
   */
  match?: ReadonlyArray<ReadonlyArray<keyof Static<S> & string>>;
  /**
   * Порожнє поле ключа `match` — значення, а не відсутність: шукається рядок,
   * де воно теж порожнє. Для регістру відомостей, де порожній вимір означає
   * «для будь-якої» і унікальний індекс рахує його `nulls not distinct`. Без
   * позначки ключ із порожнім полем пропускається — порожній ЄДРПОУ не мусить
   * зводити всіх, у кого його немає.
   */
  matchEmpty?: boolean;
  transform?: never;
}

export interface TransformRule<S extends TObject> extends RuleBase<S> {
  transform: Transform;
  key?: never;
  refType?: never;
  fields?: never;
  requires?: never;
  tables?: never;
  match?: never;
  matchEmpty?: never;
}

export type Rule<S extends TObject = TObject> = DeclarativeRule<S> | TransformRule<S>;

export function rule<S extends TObject>(value: DeclarativeRule<S>): DeclarativeRule<S>;
export function rule<S extends TObject>(value: TransformRule<S>): TransformRule<S>;
export function rule<S extends TObject>(value: Rule<S>): Rule<S> {
  return value;
}

/** Шлях до значення: «Реквізит» або «приєднаний.Реквізит». */
export function readPath(row: SourceRow, path: string): unknown {
  let value: unknown = row;
  for (const part of path.split(".")) {
    if (value === null || value === undefined || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** Реквізит верхнього рівня, який читає шлях, — для покриття й проксі. */
export function rootOf(path: string): string {
  return path.split(".")[0];
}
