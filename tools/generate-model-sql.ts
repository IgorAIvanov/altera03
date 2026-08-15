// Детермінований генератор стандартних CRUD-SQL функцій моделі.
// Джерело правди — <model>.schema.ts (TypeBox) + manifest.json.
// Емітить db/_generated/<model>.crud.gen.sql зі стандартною п'ятіркою
// list/get/save/delete/lookup.
//
// Підтримує: плоский catalog, x-ref (ссылки), x-table (табличні частини).
// Деталі — docs/sql-codegen.md.
//
// Запуск:  deno run -A ./scripts/generate-model-sql.ts ./app [catalog/bank] --verbose

import { basename, join, resolve, toFileUrl } from "@std/path";
import { parse as parseJsonc } from "@std/jsonc";

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

// ── TypeBox schema shape (рантайм = JSON Schema об'єкт) ───────────────────────

export type XRef = {
  model: string;
  fk?: string;
  display?: string;
  as?: string;
  sortable?: boolean;
  searchable?: boolean;
};
type XTable = { table: string; parentFk: string; orderBy?: string };
/**
 * Поле бере участь у фільтрі списку (панель фільтрів праворуч).
 *
 * `true` — рівність за замовчуванням. Для дат і чисел частіше потрібен діапазон:
 * `{ op: "range" }` дає ДВА ключі payload — `<key>From` і `<key>To`.
 *
 * `key` перейменовує ключ у `payload.filters` (і для діапазону — його основу):
 * `{ op: "range", key: "date" }` → `dateFrom`/`dateTo`, бо саме такі імена
 * природно віддає `<ui-period>`.
 */
type XFilter = { op?: "eq" | "range" | "like"; key?: string };
/** Поле-вкладення: у колонці лежить id з app.attachment. */
type XBlob = { as?: string };

type TSchema = {
  type?: string;
  anyOf?: TSchema[];
  items?: TSchema;
  properties?: Record<string, TSchema>;
  required?: string[];
  default?: unknown;
  "x-db-type"?: string;
  "x-db-col"?: string;
  "x-search"?: boolean;
  "x-lookup"?: boolean;
  "x-list"?: { sortable?: boolean };
  "x-filter"?: boolean | XFilter;
  "x-ref"?: XRef;
  "x-table"?: XTable;
  "x-blob"?: boolean | XBlob;
  /** Поле є в типі форми, але не в таблиці — генератор його не чіпає. */
  "x-transient"?: boolean;
};

type SqlManifest = { models?: string[] };
type DocumentMeta = { name?: string; shortName?: string; prefix?: string; sortOrder?: number };
type FeatureManifest = {
  model?: string;
  type?: string;
  schema?: string;
  document?: DocumentMeta;
  /**
   * Ієрархічний довідник (патерн A2v10): плоский список + дерево груп збоку.
   * Конвенція: таблиця груп `{schema}.{model}_group` (id, parent_id, name),
   * колонка `group_id` у елемента. Генерує додатково group_tree / group_save /
   * group_delete / move_to_group і фільтр groupIds (з підгрупами) у list.
   */
  hierarchy?: boolean;
  /** `generate: false` — CRUD написаний руками, генератор моделі не торкається. */
  sql?: { generate?: boolean };
  /**
   * Ім'я таблиці, коли воно не збігається з ключем моделі: модель `user` живе в
   * `app.users`. Потрібне тим, на кого ПОСИЛАЮТЬСЯ: без нього `x-ref` збудував
   * би join у неіснуючу `app.user`.
   */
  table?: string;
  /**
   * Автонумерація (@core/numerator). Правило й лічильник живуть у базі, тут —
   * лише те, що потрібно генератору: яке поле заповнювати. Сам шаблон їде в
   * сід через assemble-sql-package.ts.
   */
  numbering?: { field: string; template?: string; strategy?: string; period?: string; name?: string };
  /**
   * Періодичні дані (курси валют, ціни, ставки податків): ключ плюс дата, на
   * яку значення діє. Четвертий типовий вид моделі після довідника, документа
   * й регістру — і однаковий скрізь, тому оголошується, а не пишеться.
   *
   * Дає, поверх звичайного CRUD регістру: `_at` (зріз останнього на дату),
   * `_history` (як мінялося) і `_set` (перезапис значення на дату), плюс
   * унікальний індекс `(ключ…, період desc)` — той самий, що робить зріз
   * пошуком, а не скануванням.
   */
  periodic?: { key: string[]; period: string };
};

export type Ref = {
  fkCol: string; // колонка-FK на цій таблиці (counterparty_id)
  as: string; // ключ вкладеного об'єкта (counterparty)
  display: string; // display-колонка цілі (name)
  displayKey: string; // JSON-ключ подання у вкладеному об'єкті (camelCase від колонки)
  targetSchema: string;
  targetTable: string;
  targetPk: string;
  alias: string; // аліас join (r_counterparty)
  sortable: boolean;
  searchable: boolean;
  /**
   * Ціль — ДОКУМЕНТ, і подання лежить у спільній шапці `app.document`, а не в
   * таблиці моделі. Тоді join подвійний: спершу таблиця документа (її ключ —
   * `document_id`), потім шапка. Аліас шапки — `d_<as>`.
   */
  headerAlias?: string;
  /** `display` — колонка шапки документа, а не таблиці цілі. */
  displayInHeader: boolean;
};

type Field = {
  key: string; // camelCase JSON-ключ
  col: string; // snake_case колонка БД
  // Аліас таблиці, якій належить поле: t — таблиця моделі, h — спільна шапка
  // app.document (лише для type: "document"), l — рядок табличної частини.
  alias: string;
  isString: boolean;
  isBool: boolean;
  isBigint: boolean;
  isInt: boolean;
  isNumeric: boolean;
  isDate: boolean;
  isJson: boolean;
  isTimestamp: boolean;
  isTimestampTz: boolean;
  required: boolean; // для save (у required[] і не id)
  search: boolean;
  sortable: boolean;
  boolDefaultSql: string;
  // SQL-літерал дефолту зі схеми для числових полів. Потрібен, бо форма може
  // не прислати поле зовсім, а колонка в БД — not null default: без coalesce
  // туди пішов би null і save впав би на constraint.
  defaultSql?: string;
  ref?: Ref;
  /**
   * Поле-вкладення (`x-blob`): у колонці лежить id з app.attachment. Тут — ім'я
   * ключа, у який поруч віддається ключ доступу (logoId → logoToken). Підписаний
   * токен підставляє рантайм, див. server/modules/blob/blob-token.ts.
   */
  blobTokenKey?: string;
  /** Нормалізований `x-filter`; `undefined` — поле у фільтрі не бере участі. */
  filter?: XFilter;
};

/**
 * Один фільтр у згенерованому `_list`: змінна, розбір, умова і — для ссылки —
 * чим доповнити відповідь.
 */
type FilterSpec = {
  /** Ключ у `payload.filters`. */
  key: string;
  /** Оголошення змінної plpgsql разом із розбором. */
  decl: string;
  /** Рядок умови для `where` (без відступу). */
  cond: string;
  /**
   * Ссылочний фільтр: клієнт шле лише id, а панелі потрібне ще й відображуване
   * значення — інакше після перезавантаження пікер показав би порожньо. Тут
   * SQL-вираз, який дістає `{id, <display>}` для відповіді.
   */
  mirror?: { key: string; expr: string };
};

type TableSpec = {
  key: string; // JSON-ключ (lines)
  schema: string;
  table: string; // invoice_line
  parentFk: string; // invoice_id
  orderBy: string; // line_no
  fields: Field[]; // поля рядка (incl id, refs)
};

type SortEntry = { token: string; expr: string };

type ModelSpec = {
  model: string;
  schema: string;
  table: string;
  pk: string;
  // Документ: дані живуть у двох таблицях — спільна шапка app.document (h)
  // і таблиця реквізитів app.<model> (t) з первинним ключем document_id.
  isDocument: boolean;
  /**
   * Регістр: та сама п'ятірка, що в довідника, але БЕЗ `lookup` — на регістр
   * ніхто не посилається, тож підбирати його в пікері нема кому.
   */
  isRegister: boolean;
  fromClause: string; // "app.invoice t" або "app.document h join app.invoice t on ..."
  pkExpr: string; // "t.id" або "h.id"
  /**
   * Вираз ознаки «позначено на видалення» з аліасом запиту (`h.is_deleted` у
   * документа, `t.is_deleted` у довідника). Порожній — модель позначки не має.
   *
   * Фільтри РІЗНІ навмисно: у списку позначені видно (інакше ознаку не побачити
   * ніколи й позначка була б рівносильна зникненню), у підборі — ні (пропонувати
   * до вибору те, що готують до видалення, безглуздо).
   */
  deletedExpr: string;
  /** Куди писати позначку в `delete`/`undelete`; null — жорстке видалення. */
  softDelete: { table: string; pk: string } | null;
  headerFields: Field[]; // поля app.document (лише для документа)
  itemFields: Field[]; // скалярні поля шапки
  tables: TableSpec[];
  listFields: Field[]; // поля шапки у списку (за Row)
  lookupFields: Field[];
  /** Фільтри панелі (лише `_list`): `x-filter` у схемі моделі. */
  filters: FilterSpec[];
  searchExprsList: string[];
  searchExprsLookup: string[];
  listSort: SortEntry[];
  lookupSort: SortEntry[];
  listJoins: string[];
  /**
   * Ті самі join-и для `lookup`. Окремі від `listJoins`, бо набори полів різні:
   * підбір показує менше, ніж список, і тягти в нього зайву таблицю нема за що.
   */
  lookupJoins: string[];
  /** Періодичні дані: поля ключа й поле періоду (див. FeatureManifest.periodic). */
  periodic: { keyFields: Field[]; periodField: Field } | null;
  /**
   * Поле, яке заповнює нумератор (`code`), або null. Для документа тут завжди
   * null: номер шапки має власний шлях (app.doc_next_number), бо область
   * лічильника збирається з організації й дати шапки.
   */
  numberedField: string | null;
  /** Ієрархічний довідник: див. FeatureManifest.hierarchy. */
  hierarchy: boolean;
  groupTable: string; // {schema}.{model}_group
  rowHasGroupName: boolean; // Row оголошує groupName → list віддає ім'я групи
};

export type ModelMeta = {
  schema: string;
  model: string;
  table: string;
  pk: string;
  displayCol: string;
  /** Модель типу `document`: ключ таблиці `document_id`, шапка — `app.document`. */
  isDocument: boolean;
};
export type ModelMetaMap = Map<string, ModelMeta>;

/**
 * Колонки спільної шапки `app.document` — тобто те, чим документ можна
 * ПОКАЗАТИ, коли на нього посилаються. Номер, дата й представлення живуть тут,
 * а не в таблиці моделі, тож ссылка на документ join'иться двічі.
 *
 * Список тут константою, а не з `DocumentHeaderSchema`: карта моделей будується
 * до того, як стане ясно, чи є в застосунку хоч один документ, а тягти резолв
 * `@client/` заради довідки про сім імен — дорожче за саму довідку. Розбіжність
 * ловиться `assertHeaderColsKnown` на першому ж документі, тобто голосно.
 */
const DOCUMENT_HEADER_COLS = new Set([
  "organization_id",
  "number",
  "doc_date",
  "total",
  "presentation",
  "description",
  "is_posted",
  "is_deleted",
]);

/** Ті з них, за якими можна ШУКАТИ: `ilike` по даті чи числу — помилка типу. */
const DOCUMENT_HEADER_TEXT_COLS = new Set(["number", "presentation", "description"]);

/** Подання документа за умовчанням: денормалізований рядок для списків посилань. */
const DOCUMENT_DISPLAY_COL = "presentation";

// ── helpers ──────────────────────────────────────────────────────────────────

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function pascalCase(model: string): string {
  return model.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

function isStringType(s: TSchema): boolean {
  if (s.type === "string") return true;
  return Array.isArray(s.anyOf) && s.anyOf.some((m) => m.type === "string");
}

/**
 * Об'єктний тип — з поправкою на те, як його насправді пишуть у схемі форми:
 * `Type.Optional(Type.Union([Type.Object({…}), Type.Null()]))`, тобто `anyOf`,
 * а не `type: "object"`.
 */
function isObjectType(s: TSchema): boolean {
  if (s.type === "object") return true;
  return Array.isArray(s.anyOf) && s.anyOf.some((m) => m.type === "object");
}

/**
 * Поля об'єктної гілки — з тією ж поправкою на `Type.Union([…, Type.Null()])`.
 * Порожній масив означає «форму значення не описували», а не «полів немає».
 */
function declaredObjectKeys(s: TSchema): string[] {
  if (s.properties) return Object.keys(s.properties);
  const branch = s.anyOf?.find((m) => m.properties);
  return branch ? Object.keys(branch.properties!) : [];
}

function assertIdentifier(value: string, label: string) {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} «${value}» має містити лише lowercase, digits та underscore`);
  }
}

/**
 * Відомі значення `x-db-type`.
 *
 * Перевірка потрібна тому, що розбір нижче звіряє РІВНІСТЬ рядків: природне
 * `numeric(10,2)` (саме так стоїть у DDL) не впізнає жодна гілка, і поле
 * провалюється в текстовий fallback — у `merge` їде
 * `nullif(trim(coalesce(...)),'')`. Генерація при цьому зелена, публікація теж,
 * а падає воно аж у базі на першому `save`:
 *
 *   column "markup" is of type numeric but expression is of type text
 *
 * Тобто помилка в схемі виявлялася на три кроки пізніше, ніж могла б. Приймати
 * `numeric(p,s)` і зрізати дужки було б тихіше, але гірше: схема й DDL могли б
 * розійтися мовчки. Точність і довжину задає DDL — у схемі лишається голий тип.
 */
const KNOWN_DB_TYPES = [
  "bigint",
  "int",
  "integer",
  "numeric",
  "json",
  "jsonb",
  "date",
  "timestamp",
  "timestamptz",
  "text",
  "varchar",
];

function assertDbType(value: string, label: string) {
  if (!KNOWN_DB_TYPES.includes(value)) {
    throw new Error(
      `${label}: x-db-type «${value}» невідомий; дозволені: ${KNOWN_DB_TYPES.join(", ")} ` +
        `(точність і довжину задає DDL)`,
    );
  }
}

/**
 * Оголошення `x-ref` → усе, що потрібно SQL: колонка-FK, ключ вкладеного
 * об'єкта, аліаси join'ів і те, звідки брати подання.
 *
 * Експортовано заради проб: розкладка «шапка в ядрі, реквізити в таблиці
 * моделі» видно лише в SQL, тобто найдешевше її перевірити тут — а до цієї
 * функції ссылка на ДОКУМЕНТ не працювала взагалі (join будувався за колонкою
 * `id`, якої в таблиці документа немає, і падало це аж на публікації).
 */
export function resolveRef(xref: XRef, fkColumn: string, map: ModelMetaMap, owner: string): Ref {
  const target = map.get(xref.model);
  if (!target) {
    throw new Error(`${owner} → модель '${xref.model}' не знайдена (x-ref)`);
  }
  const as = xref.as ?? xref.model;
  const display = xref.display ?? target.displayCol;
  // Подання їде в SQL іменем колонки — тобто підставляється в запит текстом.
  assertIdentifier(display, `${owner}: x-ref.display`);
  // Ссылка на документ: реквізити лежать у таблиці моделі, а номер, дата й
  // представлення — у шапці. Куди йти за поданням, вирішує саме колонка, а не
  // тип цілі: `display` цілком може називати власний реквізит документа.
  const displayInHeader = target.isDocument && DOCUMENT_HEADER_COLS.has(display);
  // Пошук по подання йде `ilike`, а в шапці документа є і дата, і сума, і
  // прапорці. Мовчки це не зламається на генерації й не зламається на
  // публікації — `list` плпгсиловий, тіло не перевіряється, — а вилізе на
  // першому наборі символів у полі пошуку, помилкою типу.
  if (xref.searchable === true && displayInHeader && !DOCUMENT_HEADER_TEXT_COLS.has(display)) {
    throw new Error(
      `${owner}: x-ref.searchable з display «${display}» неможливий — пошук іде ilike, ` +
        `а це не текст; шукати документ можна за ${[...DOCUMENT_HEADER_TEXT_COLS].join(", ")}`,
    );
  }
  return {
    fkCol: xref.fk ?? fkColumn,
    as,
    display,
    displayKey: snakeToCamel(display),
    targetSchema: target.schema,
    targetTable: target.table,
    targetPk: target.pk,
    alias: `r_${as}`,
    sortable: xref.sortable === true,
    searchable: xref.searchable === true,
    headerAlias: displayInHeader ? `d_${as}` : undefined,
    displayInHeader,
  };
}

function toField(
  key: string,
  prop: TSchema,
  requiredKeys: Set<string>,
  map: ModelMetaMap,
  owner: string,
  alias: string,
): Field {
  const col = prop["x-db-col"] ?? camelToSnake(key);
  const dbType = prop["x-db-type"];
  if (dbType !== undefined) assertDbType(dbType, `${owner}.${key}`);
  const isBigint = dbType === "bigint";
  const isInt = dbType === "int" || dbType === "integer";
  const isNumeric = dbType === "numeric";
  const isJson = dbType === "jsonb" || dbType === "json";
  const isDate = dbType === "date";
  const isTimestampTz = dbType === "timestamptz";
  const isTimestamp = isTimestampTz || dbType === "timestamp";
  const isBool = prop.type === "boolean";
  const isString = !isBigint && !isInt && !isNumeric && !isDate && !isTimestamp && !isBool &&
    !isJson && isStringType(prop);

  const xref = prop["x-ref"];
  const ref = xref ? resolveRef(xref, col, map, `${owner}.${key}`) : undefined;

  const xblob = prop["x-blob"];
  const blobTokenKey = xblob
    ? (typeof xblob === "object" && xblob.as
      ? xblob.as
      : `${key.endsWith("Id") ? key.slice(0, -2) : key}Token`)
    : undefined;

  return {
    key,
    col,
    alias,
    isString,
    isBool,
    isBigint,
    isInt,
    isNumeric,
    isDate,
    isJson,
    isTimestamp,
    isTimestampTz,
    required: requiredKeys.has(key) && key !== "id",
    filter: normalizeFilter(prop["x-filter"]),
    search: prop["x-search"] === true,
    sortable: prop["x-list"]?.sortable === true,
    boolDefaultSql: booleanDefaultSql(prop.default),
    defaultSql: isJson
      ? "'{}'::jsonb"
      : (isNumeric || isInt) && typeof prop.default === "number"
      ? String(prop.default)
      : isString && typeof prop.default === "string"
      ? `'${prop.default.replaceAll("'", "''")}'`
      : undefined,
    ref,
    blobTokenKey,
  };
}

/**
 * Умовчання логічного поля для `coalesce` у згенерованому `merge`.
 *
 * Тут стояло «все, крім явного `false`, — це `true`», тобто `undefined` теж.
 * Поле, якого немає в payload (а його не буде в кожного клієнта, що шле лише
 * заповнене), мовчки ставало «так»: `amountIncludesVat` без ключа перетворював
 * рахунок на «ціни з ПДВ», тобто з іншою сумою до сплати. Ніщо цього не ловило
 * — SQL валідний, тип правильний, проба на документі з явним ключем проходить,
 * і видно це лише сумою в чужому рахунку.
 *
 * `false` не «краще значення», а єдине, яке не вигадує факт: «нема ключа»
 * означає «не сказано», а не «так». Хто хоче «так» — оголошує `default: true`
 * у схемі, як це вже роблять `is_active` моделей ядра.
 *
 * Винесено окремо й експортовано, щоб бути під пробою: тихі правила мусять
 * перевірятися, бо саме їх ніхто не перечитує.
 */
export function booleanDefaultSql(schemaDefault: unknown): "true" | "false" {
  return schemaDefault === true ? "true" : "false";
}

function normalizeFilter(raw: boolean | XFilter | undefined): XFilter | undefined {
  if (!raw) return undefined;
  return raw === true ? { op: "eq" } : { op: raw.op ?? "eq", key: raw.key };
}

/**
 * Фільтри списку зі схеми моделі.
 *
 * Ключ у `payload.filters` — це JSON-ключ поля (або `x-filter.key`), тобто те
 * саме ім'я, яким його називає панель на клієнті. Розбіжність тут була б
 * німою: jsonb ігнорує невідомі ключі, і фільтр просто нічого не робив би.
 */
function buildFilters(fields: Field[], model: string): FilterSpec[] {
  const specs: FilterSpec[] = [];

  for (const f of fields) {
    const conf = f.filter;
    if (!conf) continue;

    const base = conf.key ?? f.key;
    const col = `${f.alias}.${f.col}`;

    if (conf.op === "range") {
      if (!(f.isDate || f.isTimestamp || f.isNumeric || f.isInt)) {
        throw new Error(
          `${model}.${f.key}: x-filter op:"range" має сенс лише для дати або числа`,
        );
      }
      const isTime = f.isTimestamp;
      // Межі періоду приходять датами (їх віддає <ui-period>), а колонка може
      // бути timestamp. Тому верхня межа — не `<= дата` (це відрізало б увесь
      // останній день, крім опівночі), а `< дата + 1 день`: і правильно, і
      // індексу не заважає, на відміну від приведення колонки до date.
      const sqlType = isTime || f.isDate ? "date" : f.isNumeric ? "numeric" : "int";
      const cast = (key: string) =>
        `nullif(v_filters->>'${key}', '')::${sqlType}`;
      const fromKey = `${base}From`;
      const toKey = `${base}To`;
      const fromVar = `v_f_${camelToSnake(fromKey)}`;
      const toVar = `v_f_${camelToSnake(toKey)}`;
      specs.push({
        key: fromKey,
        decl: `  ${fromVar} ${sqlType} := ${cast(fromKey)};`,
        cond: `(${fromVar} is null or ${col} >= ${fromVar})`,
      });
      specs.push({
        key: toKey,
        decl: `  ${toVar} ${sqlType} := ${cast(toKey)};`,
        cond: isTime
          ? `(${toVar} is null or ${col} < ${toVar} + interval '1 day')`
          : `(${toVar} is null or ${col} <= ${toVar})`,
      });
      continue;
    }

    const varName = `v_f_${camelToSnake(base)}`;

    if (conf.op === "like") {
      if (!f.isString) {
        throw new Error(`${model}.${f.key}: x-filter op:"like" — лише для рядкового поля`);
      }
      specs.push({
        key: base,
        decl: `  ${varName} text := nullif(v_filters->>'${base}', '');`,
        cond: `(${varName} is null or ${col} ilike '%' || ${varName} || '%')`,
      });
      continue;
    }

    // eq. Ссылка — ОДИН ключ з об'єктом `{id, <display>}`, а не пара
    // «id + окреме представлення»: підпис потрібен пікеру в панелі, а зайвий
    // ключ у наборі рахувався б за другий фільтр і переживав би зняття
    // першого. Для відбору з об'єкта береться сам лише `id`.
    const sqlType = f.isBigint
      ? "bigint"
      : f.isInt
      ? "int"
      : f.isNumeric
      ? "numeric"
      : f.isBool
      ? "boolean"
      : f.isDate
      ? "date"
      : f.isTimestamp
      ? (f.isTimestampTz ? "timestamptz" : "timestamp")
      : "text";
    // Ключ ссылочного фільтра — ім'я з `x-ref.as` (`counterparty`), а не
    // `counterpartyId`: значення тепер об'єкт, і назва мусить це називати.
    const key = f.ref ? f.ref.as : base;
    const varName2 = f.ref ? `v_f_${camelToSnake(key)}_id` : varName;
    const parse = f.ref
      ? `nullif(v_filters->'${key}'->>'id', '')::${sqlType}`
      : f.isBool
      ? `(v_filters->>'${base}')::boolean`
      : sqlType === "text"
      ? `nullif(v_filters->>'${base}', '')`
      : `nullif(v_filters->>'${base}', '')::${sqlType}`;

    const spec: FilterSpec = {
      key,
      decl: `  ${varName2} ${sqlType} := ${parse};`,
      cond: `(${varName2} is null or ${col} = ${varName2})`,
    };

    // Назад той самий ключ віддається вже з представленням із бази: id прислав
    // клієнт, підпис знає лише вона. Ключ ТОЙ САМИЙ, тобто відповідь уточнює
    // фільтр, а не додає до нього другий — інакше після перезавантаження пікер
    // знав би id, але показував порожнє поле.
    if (f.ref) {
      const r = f.ref;
      const from = r.displayInHeader
        ? `${r.targetSchema}.${r.targetTable} x join app.document xh on xh.id = x.${r.targetPk}`
        : `${r.targetSchema}.${r.targetTable} x`;
      spec.mirror = {
        key: r.as,
        expr: `(select jsonb_build_object('id', x.${r.targetPk}::text, '${r.displayKey}', ${
          refDisplaySql(r, "x", "xh")
        })
     from ${from} where x.${r.targetPk} = ${varName2})`,
      };
    }

    specs.push(spec);
  }

  const seen = new Set<string>();
  for (const s of specs) {
    if (seen.has(s.key)) throw new Error(`${model}: фільтр '${s.key}' оголошено двічі`);
    seen.add(s.key);
  }
  return specs;
}

// розбір об'єктної схеми на скалярні поля + табличні частини
function parseObject(
  schema: TSchema,
  parentSchema: string,
  map: ModelMetaMap,
  owner: string,
  alias = "t",
): { fields: Field[]; tables: TableSpec[] } {
  const props = schema.properties ?? {};
  const requiredKeys = new Set(schema.required ?? []);
  const fields: Field[] = [];
  const tables: TableSpec[] = [];

  // Імена вкладених об'єктів-ссылок, оголошених ТУТ ЖЕ (`counterpartyId` з
  // `x-ref.as: "counterparty"` → `counterparty`). Сам об'єкт у схемі форми
  // потрібен (пікер показує ним значення), а колонки під нього немає — його
  // складає генератор із join'а. Без цього кроку об'єкт розбирався як звичайне
  // поле, і публікація падала аж на `create function`:
  // `column l.counterparty does not exist`. Зелено при цьому було все — і
  // `sql:gen`, і `deno check`, — тобто ловилося воно найдорожчим способом.
  const refNames = new Set(
    Object.values(props)
      .map((p) => p["x-ref"])
      .filter((x): x is XRef => !!x)
      .map((x) => x.as ?? x.model),
  );

  for (const [key, prop] of Object.entries(props)) {
    // Транзієнтне поле живе тільки в типі форми (напр. токен вкладення, який
    // підставляє рантайм) — колонки під нього немає, у SQL воно не потрапляє.
    if (prop["x-transient"]) continue;

    // Об'єкт-ссылка поруч зі своїм id. Звужено до об'єктного типу навмисно:
    // збіг імені ссылки зі СКАЛЯРНОЮ колонкою — це справжня колізія (у `get`
    // вийшло б два однакових ключі), і хай вона падає голосно.
    if (refNames.has(key) && isObjectType(prop)) continue;

    if (prop.type === "array" && prop["x-table"]) {
      const xt = prop["x-table"];
      const line = parseObject(prop.items ?? {}, parentSchema, map, `${owner}.${key}`, "l");
      tables.push({
        key,
        schema: parentSchema,
        table: xt.table,
        parentFk: xt.parentFk,
        orderBy: xt.orderBy ?? "id",
        fields: line.fields,
      });
    } else {
      fields.push(toField(key, prop, requiredKeys, map, owner, alias));
    }
  }
  return { fields, tables };
}

// ── SQL-вирази ────────────────────────────────────────────────────────────────

// вивід скалярної колонки: 'jsonKey', alias.col[::text]
function outExpr(f: Field): string {
  const ref = `${f.alias}.${f.col}`;
  return `'${f.key}', ${f.isBigint ? `${ref}::text` : ref}`;
}

/**
 * Вираз подання ссылки — те, що людина бачить у пікері замість числа.
 *
 * Аліаси параметрами, бо той самий вираз потрібен у двох розкладках: у join'і
 * списку (`r_shipment` / `d_shipment`) і в корельованому підзапиті эха фільтра
 * (`x` / `xh`).
 *
 * `presentation` денормалізоване — його заповнює необов'язковий хук документа
 * `_denormalize`, тобто в документа, який його не заповнює, воно порожнє.
 * Порожній підпис у пікері невідрізненний від зламаного поля, тому подання
 * документа падає на номер. Складати «номер від дати» тут не можна: слово
 * «від» — це текст мовою, а сервер тексту не перекладає (він його називає
 * маркером, а маркери в полях даних не розгортаються). Хто хоче саме такий
 * підпис, складає його у своєму `_denormalize` — і мовою свого застосунку.
 */
function displaySql(
  display: string,
  inHeader: boolean,
  targetAlias: string,
  headerAlias: string | undefined,
): string {
  if (!inHeader) return `${targetAlias}.${display}`;
  return display === DOCUMENT_DISPLAY_COL
    ? `coalesce(nullif(${headerAlias}.${display}, ''), ${headerAlias}.number)`
    : `${headerAlias}.${display}`;
}

export function refDisplaySql(r: Ref, targetAlias = r.alias, headerAlias = r.headerAlias): string {
  return displaySql(r.display, r.displayInHeader, targetAlias, headerAlias);
}

// вивід вкладеного об'єкта ссылки
function refEntry(f: Field): string {
  const r = f.ref!;
  return `'${r.as}', case when ${r.alias}.${r.targetPk} is null then null ` +
    `else jsonb_build_object('id', ${r.alias}.${r.targetPk}::text, '${r.displayKey}', ${refDisplaySql(r)}) end`;
}

/**
 * Ключ доступу до вкладення поруч із його id: `'logoToken', (select …)`.
 * Віддаємо сирий access_key — підписаний токен із нього робить рантайм
 * (server/modules/blob), бо токен залежить від сесії, а не від даних.
 */
function blobEntry(f: Field): string {
  return `'${f.blobTokenKey}', (select b.access_key from app.attachment b where b.id = ${f.alias}.${f.col})`;
}

// колонки об'єкта для набору полів: скаляр + (за наявності) вкладена ссылка / токен вкладення
function fieldEntries(fields: Field[]): string[] {
  return fields.flatMap((f) => {
    const entries = [outExpr(f)];
    if (f.ref) entries.push(refEntry(f));
    if (f.blobTokenKey) entries.push(blobEntry(f));
    return entries;
  });
}

function refJoins(fields: Field[]): string[] {
  const seen = new Set<string>();
  const joins: string[] = [];
  for (const f of fields) {
    if (!f.ref || seen.has(f.ref.alias)) continue;
    seen.add(f.ref.alias);
    joins.push(...refJoinSql(f.ref, f.alias));
  }
  return joins;
}

/**
 * Join-и однієї ссылки: сама ціль, а для документа — ще й його шапка.
 *
 * Обидва `left`, і другий теж: `join` перетворив би зовнішнє з'єднання на
 * внутрішнє, і рядок БЕЗ ссылки зник би зі списку взагалі — тобто відбір
 * мовчки звузився б до заповнених.
 */
export function refJoinSql(r: Ref, ownerAlias: string): string[] {
  const joins = [
    `left join ${r.targetSchema}.${r.targetTable} ${r.alias} on ${r.alias}.${r.targetPk} = ${ownerAlias}.${r.fkCol}`,
  ];
  if (r.headerAlias) {
    joins.push(`left join app.document ${r.headerAlias} on ${r.headerAlias}.id = ${r.alias}.${r.targetPk}`);
  }
  return joins;
}

// extract+cast значення поля з jsonb-виразу jsonVar
function srcExpr(f: Field, jsonVar: string): string {
  // jsonb-колонка: беремо піддерево (->), а не текст (->>), інакше значення
  // поїде в БД як рядок і впаде на типі.
  if (f.isJson) return `${jsonVar}->'${f.key}'`;
  // Ссылка приходить у двох виглядах, і обидва законні: голий id
  // (`counterpartyId`) або сам об'єкт (`counterparty: {id, name}`) — саме його
  // тримає форма, бо його ж віддає `get` і його ж приймає `<ui-picker>`.
  // Розбирати це на клієнті означало б тримати в кожній формі пару полів і
  // стежити, щоб вони не розійшлися.
  const g = f.ref
    ? `coalesce(${jsonVar}->>'${f.key}', ${jsonVar}->'${f.ref.as}'->>'id')`
    : `${jsonVar}->>'${f.key}'`;
  if (f.isBigint) return `nullif(${g}, '')::bigint`;
  if (f.isInt) return `nullif(${g}, '')::int`;
  if (f.isNumeric) return `nullif(${g}, '')::numeric`;
  if (f.isDate) return `nullif(${g}, '')::date`;
  if (f.isTimestamp) return `nullif(${g}, '')::${f.isTimestampTz ? "timestamptz" : "timestamp"}`;
  if (f.isBool) return `(${g})::boolean`;
  return `nullif(trim(coalesce(${g}, '')), '')`;
}

function searchClause(exprs: string[], indent: string): string {
  if (exprs.length === 0) return `${indent}true`;
  return [
    `${indent}coalesce(payload->>'search', '') = ''`,
    ...exprs.map((e) => `${indent}or ${e} ilike '%' || (payload->>'search') || '%'`),
  ].join("\n");
}

function orderLadder(entries: SortEntry[], indent: string, fallback: string): string {
  if (entries.length === 0) return `${indent}${fallback}`;
  return entries.flatMap((e) => [
    `${indent}case when v_sort_by = '${e.token}' and v_sort_dir = 'asc'  then ${e.expr} end asc`,
    `${indent}case when v_sort_by = '${e.token}' and v_sort_dir = 'desc' then ${e.expr} end desc`,
  ]).join(",\n");
}

function whitelist(entries: SortEntry[]): string {
  return entries.map((e) => `'${e.token}'`).join(", ");
}

function envelope(dataLines: string[]): string {
  return [
    `jsonb_build_object(`,
    `      'ok', true,`,
    `      'data', jsonb_build_object(`,
    dataLines.map((l) => `        ${l}`).join(",\n"),
    `      ),`,
    `      'messages', '[]'::jsonb,`,
    `      'meta', '{}'::jsonb`,
    `    )`,
  ].join("\n");
}

// агрегат табличної частини (для get та save)
function tableAgg(tbl: TableSpec, parentExpr: string): string {
  const cols = fieldEntries(tbl.fields).map((e) => `          ${e}`).join(",\n");
  const joins = refJoins(tbl.fields).map((j) => `        ${j}`).join("\n");
  const joinSql = joins ? `\n${joins}` : "";
  return `coalesce((
        select jsonb_agg(jsonb_build_object(
${cols}
        ) order by l.${tbl.orderBy})
        from ${tbl.schema}.${tbl.table} l${joinSql}
        where l.${tbl.parentFk} = ${parentExpr}
      ), '[]'::jsonb)`;
}

// повний об'єкт item (скаляри + ссылки + табличні частини) та його joins
function itemObject(spec: ModelSpec, parentExpr: string): { object: string; joins: string[] } {
  const entries = [
    ...fieldEntries(spec.itemFields),
    ...spec.tables.map((tbl) => `'${tbl.key}', ${tableAgg(tbl, parentExpr)}`),
  ];
  return {
    object: `jsonb_build_object(\n${entries.map((e) => `        ${e}`).join(",\n")}\n      )`,
    joins: refJoins(spec.itemFields),
  };
}

/**
 * Значення поля при insert: поле з дефолтом підставляє його, якщо форма
 * прислала null. При update натомість зберігається попереднє значення —
 * відсутнє в payload поле не має обнуляти колонку.
 */
function insertVal(f: Field, src = "s"): string {
  if (f.isBool) return `coalesce(${src}.${f.col}, ${f.boolDefaultSql})`;
  if (f.defaultSql) return `coalesce(${src}.${f.col}, ${f.defaultSql})`;
  return `${src}.${f.col}`;
}

function updateSet(f: Field, target: string, src = "s"): string {
  if (f.isBool || f.defaultSql) return `${f.col} = coalesce(${src}.${f.col}, ${target}.${f.col})`;
  return `${f.col} = ${src}.${f.col}`;
}

// Базового фільтра в списку більше немає: позначені на видалення мусять бути
// ВИДНІ, інакше саму позначку не побачити ніколи — вона була б рівносильна
// зникненню запису. Ховає їх лише підбір (див. renderLookup).

// ── рендер функцій ─────────────────────────────────────────────────────────────

function renderList(spec: ModelSpec): string {
  const defaultSort = spec.listSort[0]?.token ?? spec.pk;
  const rowEntries = fieldEntries(spec.listFields);
  // Ім'я групи в рядку — конвенція ієрархії, а не x-ref: таблиця груп не є
  // моделлю, тож звичайна ссылка на неї не оголошується.
  if (spec.hierarchy && spec.rowHasGroupName) {
    rowEntries.push(`'groupName', gr.name`);
  }
  const rowCols = rowEntries.map((e) => `      ${e}`).join(",\n");
  const allJoins = [...spec.listJoins];
  if (spec.hierarchy && spec.rowHasGroupName) {
    allJoins.push(`left join ${spec.groupTable} gr on gr.id = t.group_id`);
  }
  const joins = allJoins.length ? "\n    " + allJoins.join("\n    ") : "";
  const joinsCount = spec.listJoins.length ? "\n  " + spec.listJoins.join("\n  ") : "";
  const sortGuard = spec.listSort.length
    ? `  if v_sort_by not in (${whitelist(spec.listSort)}) then\n    v_sort_by := '${defaultSort}';\n  end if;\n\n`
    : "";
  // Фільтр дерева: відмічена група показує і вміст підгруп — обхід рекурсивний.
  // null (groupIds не прислали або порожні) — без фільтра, повний список.
  const groupDecl = spec.hierarchy
    ? `  v_group_ids bigint[] := (
    select array_agg(nullif(x, '')::bigint)
    from jsonb_array_elements_text(coalesce(payload->'groupIds', '[]'::jsonb)) x
  );\n`
    : "";
  const groupCond = (indent: string) =>
    spec.hierarchy
      ? `\n${indent}and (v_group_ids is null or t.group_id in (
${indent}  with recursive grp as (
${indent}    select id from ${spec.groupTable} where id = any(v_group_ids)
${indent}    union all
${indent}    select c.id from ${spec.groupTable} c join grp on c.parent_id = grp.id
${indent}  )
${indent}  select id from grp
${indent}))`
      : "";
  // Фільтри панелі. Оголошення + умови + повернення ефективного набору назад.
  const hasFilters = spec.filters.length > 0;
  const filterDecl = hasFilters
    ? `  v_filters   jsonb := coalesce(payload->'filters', '{}'::jsonb);\n` +
      spec.filters.map((f) => f.decl).join("\n") + "\n" +
      `  v_filters_out jsonb;\n`
    : "";
  const filterCond = (indent: string) =>
    hasFilters
      ? "\n" + spec.filters.map((f) => `${indent}and ${f.cond}`).join("\n")
      : "";
  // Ссылочні фільтри доповнюємо представленням — id клієнт прислав сам, а
  // підпис для пікера знає лише база.
  const mirrors = spec.filters.filter((f) => f.mirror);
  const filterMirror = hasFilters
    ? `  v_filters_out := v_filters;\n` +
      mirrors.map((f) =>
        // strip_nulls: якщо запису за id уже немає, ключ лишається таким, як
        // прислав клієнт, а не затирається на null.
        `  v_filters_out := v_filters_out || jsonb_strip_nulls(jsonb_build_object(\n` +
        `    '${f.mirror!.key}',\n    ${f.mirror!.expr}\n  ));\n`
      ).join("") + "\n"
    : "";

  return `drop function if exists ${spec.table}_list(bigint, jsonb);
create function ${spec.table}_list(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := greatest(coalesce((payload->>'pageSize')::int, 20), 1);
  v_sort_by   text := coalesce(payload->>'sortBy', '${defaultSort}');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir','asc')) = 'desc' then 'desc' else 'asc' end;
${groupDecl}${filterDecl}  v_rows      jsonb;
  v_total     int;
begin
${sortGuard}${filterMirror}  select count(*)::int into v_total
  from ${spec.fromClause}${joinsCount}
  where (
${searchClause(spec.searchExprsList, "    ")}
  )${groupCond("  ")}${filterCond("  ")};

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
${rowCols}
    ) as r
    from ${spec.fromClause}${joins}
    where (
${searchClause(spec.searchExprsList, "      ")}
    )${groupCond("    ")}${filterCond("    ")}
    order by
${orderLadder(spec.listSort, "      ", spec.pkExpr)}
    limit v_page_size
    offset (v_page - 1) * v_page_size
  ) sub;

  return ${
    envelope([
      `'rows',   v_rows`,
      `'item',   null`,
      `'options', '{}'::jsonb`,
      `'totals', jsonb_build_object('count', v_total, 'page', v_page, 'pageSize', v_page_size)`,
      // `$filters` дзеркалиться назад так само, як `$query`: assign() на клієнті
      // зіллє його в `$root.$filters`, і панель побачить ефективний набір —
      // ссылочний фільтр уже з представленням із бази.
      ...(hasFilters ? [`'$filters', v_filters_out`] : []),
      `'extra',  '{}'::jsonb`,
    ])
  };
end;
$$;`;
}

function renderGet(spec: ModelSpec): string {
  const { object, joins } = itemObject(spec, spec.pkExpr);
  const joinSql = joins.length ? "\n          " + joins.join("\n          ") : "";
  return `drop function if exists ${spec.table}_get(bigint, jsonb);
create function ${spec.table}_get(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select ${
    envelope([
      `'item', (
          select ${object}
          from ${spec.fromClause}${joinSql}
          where ${spec.pkExpr} = (payload->>'id')::bigint
        )`,
      `'rows',    '[]'::jsonb`,
      `'options', '{}'::jsonb`,
      `'totals',  '{}'::jsonb`,
      `'extra',   '{}'::jsonb`,
    ])
  };
$$;`;
}

function renderLineMerge(tbl: TableSpec): string {
  const writable = tbl.fields.filter((f) => f.key !== "id");
  const src = [
    `      nullif(e->>'id', '')::bigint as id`,
    `      v_id as ${tbl.parentFk}`,
    ...writable.map((f) => `      ${srcExpr(f, "e")} as ${f.col}`),
  ].join(",\n");
  const lineUpdate = writable.map((f) => updateSet(f, "lt")).join(",\n    ");
  const insCols = [tbl.parentFk, ...writable.map((f) => f.col)].join(", ");
  const insVals = ["v_id", ...writable.map((f) => insertVal(f))].join(", ");
  return `  merge into ${tbl.schema}.${tbl.table} lt
  using (
    select
${src}
    from jsonb_array_elements(coalesce(v_item->'${tbl.key}', '[]'::jsonb)) e
  ) s
    on lt.id = s.id
  when matched then update set
    ${lineUpdate}
  when not matched then insert (${insCols})
    values (${insVals})
  when not matched by source and lt.${tbl.parentFk} = v_id then delete;`;
}

// ── save для документа ────────────────────────────────────────────────────────
// Двокрокова робота з шапкою: спершу app.document (він володіє id), потім
// таблиця реквізитів. Номер підставляє app.doc_next_number, якщо форма його не
// прислала. Прапорці проведення й позначки на видалення форма не пише — для них
// є окремі команди post/unpost.
const HEADER_READONLY = new Set(["id", "number", "isPosted", "isDeleted"]);

function renderSaveDocument(spec: ModelSpec): string {
  const headerWritable = spec.headerFields.filter((f) => !HEADER_READONLY.has(f.key));
  const modelWritable = spec.itemFields.filter((f) => f.alias === "t" && f.key !== "id");

  const headerSrc = [
    `      v_id as id`,
    `      v_number as number`,
    ...headerWritable.map((f) => `      ${srcExpr(f, "v_item")} as ${f.col}`),
  ].join(",\n");
  const headerUpdate = [
    `number = s.number`,
    ...headerWritable.map((f) => updateSet(f, "h")),
    `updated_at = now()`,
    `updated_by = user_id`,
  ].join(",\n    ");
  const headerInsCols = ["document_type_id", "number", ...headerWritable.map((f) => f.col), "created_by", "updated_by"]
    .join(", ");
  const headerInsVals = [
    "v_type_id",
    "s.number",
    ...headerWritable.map((f) => insertVal(f)),
    "user_id",
    "user_id",
  ].join(", ");

  const modelSrc = [
    `      v_id as document_id`,
    ...modelWritable.map((f) => `      ${srcExpr(f, "v_item")} as ${f.col}`),
  ].join(",\n");
  const modelUpdate = modelWritable.map((f) => updateSet(f, "t")).join(",\n    ");
  // Таблиця документа без власних скалярних реквізитів (уся суть — у
  // табличній частині) усе одно потребує рядка: інакше join шапки з нею
  // нічого не поверне і документ стане невидимим для get/list.
  const modelMerge = modelWritable.length === 0
    ? `
  insert into ${spec.table} (document_id) values (v_id)
  on conflict (document_id) do nothing;
`
    : `
  merge into ${spec.table} t
  using (
    select
${modelSrc}
  ) s
    on t.document_id = s.document_id
  when matched then update set
    ${modelUpdate}
  when not matched then insert (document_id, ${modelWritable.map((f) => f.col).join(", ")})
    values (v_id, ${modelWritable.map((f) => insertVal(f)).join(", ")});
`;

  const lineMerges = spec.tables.map((tbl) => `\n${renderLineMerge(tbl)}\n`).join("");
  const { object, joins } = itemObject(spec, "v_id");
  const joinSql = joins.length ? "\n  " + joins.join("\n  ") : "";

  return `drop function if exists ${spec.table}_save(bigint, jsonb);
create function ${spec.table}_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item    jsonb  := payload->'item';
  v_id      bigint := nullif(v_item->>'id', '')::bigint;
  v_org     bigint := nullif(v_item->>'organizationId', '')::bigint;
  -- Рік для нумератора береться з дати документа, а не з now(): документ,
  -- уведений заднім числом у грудень, мусить отримати торішній лічильник.
  v_date    timestamp := nullif(v_item->>'docDate', '')::timestamp;
  v_number  varchar(20);
  v_type_id bigint;
  v_result  jsonb;
begin
  if v_org is null then
    raise exception 'organizationId обов''язковий' using column = 'organization_id';
  end if;
  -- Дата перевіряється ДО видачі номера: без неї нумератор із періодом не знає,
  -- у чию область писати, і відмовив би своєю внутрішньою помилкою без прив'язки
  -- до поля. Колонка doc_date і так not null — тут лише відмова стає людською.
  if v_date is null then
    raise exception 'docDate обов''язковий' using column = 'doc_date';
  end if;

  select id into v_type_id from app.document_type where code = '${spec.model}';
  if v_type_id is null then
    raise exception 'Тип документа «${spec.model}» не зареєстровано в app.document_type';
  end if;

  -- Номер підставляємо лише новому документу. Для збереженого відсутній у
  -- payload номер означає «не чіпати», а не «перенумерувати».
  v_number := nullif(trim(coalesce(v_item->>'number', '')), '');
  if v_number is null then
    if v_id is null then
      v_number := app.doc_next_number('${spec.model}', v_org, v_date);
    else
      select h.number into v_number from app.document h where h.id = v_id;
    end if;
  elsif v_id is null
     or v_number is distinct from (select h.number from app.document h where h.id = v_id) then
    -- Номер набрали руками — на новому документі або виправили на наявному
    -- (незмінений номер наявного сюди не потрапляє). Спершу право: нумератор
    -- з вимкненим is_editable ручного номера не приймає. Далі лічильник: сам
    -- по собі ручний номер його не піднімає, але лишити лічильник позаду не
    -- можна — через кілька записів авто-номер упреться в уже зайнятий, і
    -- виглядатиме це як поламана нумерація. Перенумерація наявного документа
    -- підтягує лічильник із тієї ж причини.
    if exists (select 1 from app.numerator n where n.model = '${spec.model}' and not n.is_editable) then
      raise exception 'Номер призначає нумератор — ручна зміна вимкнена' using column = 'number';
    end if;
    perform app.doc_bump_number('${spec.model}', v_org, v_date, v_number);
  end if;

  merge into app.document h
  using (
    select
${headerSrc}
  ) s
    on h.id = s.id
  when matched then update set
    ${headerUpdate}
  when not matched then insert (${headerInsCols})
    values (${headerInsVals})
  returning h.id into v_id;
${modelMerge}${lineMerges}
  -- Денормалізація шапки (total, presentation) — необов'язковий хук документа
  -- у db/${spec.model}.custom.sql. Рахувати підсумок у генераторі не можна:
  -- у кожного документа він свій.
  if to_regprocedure('${spec.table}_denormalize(bigint, bigint)') is not null then
    perform ${spec.table}_denormalize(user_id, v_id);
  end if;

  select ${object} into v_result
  from ${spec.fromClause}${joinSql}
  where ${spec.pkExpr} = v_id;

  return ${
    envelope([
      `'item',    v_result`,
      `'rows',    '[]'::jsonb`,
      `'options', '{}'::jsonb`,
      `'totals',  '{}'::jsonb`,
      `'extra',   '{}'::jsonb`,
    ])
  };
end;
$$;`;
}

// ── post / unpost ─────────────────────────────────────────────────────────────
// Обгортки навколо ядра. Самі проводки формує рукописна
// app.<model>_post_entries(user_id, document_id) у db/<model>.custom.sql —
// логіка проведення лишається видимим SQL, а не декларацією в маніфесті.
//
// Симетрія неповна, і це видно лише на документі, який пише рухи КРІМ проводок:
// проводки ядро прибирає саме (`doc_unpost` чистить app.journal_entry), а рядок
// у чужій таблиці — ні, бо про неї не знає. Тому в unpost є пара до
// `_post_entries` — необов'язковий `app.<model>_unpost_records`.

function renderPost(spec: ModelSpec): string {
  return `drop function if exists ${spec.table}_post(bigint, jsonb);
create function ${spec.table}_post(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id      bigint := nullif(payload->>'id', '')::bigint;
  v_records regprocedure;
begin
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  perform app.doc_post_begin(user_id, v_id);

${unpostRecordsHookSql(spec.table, "post")}

  perform ${spec.table}_post_entries(user_id, v_id);
  perform app.doc_post_finish(user_id, v_id);

  return ${
    envelope([
      `'item',    (select ${spec.table}_get(user_id, jsonb_build_object('id', v_id::text)) -> 'data' -> 'item')`,
      `'rows',    '[]'::jsonb`,
      `'options', '{}'::jsonb`,
      `'totals',  '{}'::jsonb`,
      `'extra',   '{}'::jsonb`,
    ])
  };
end;
$$;`;
}

/**
 * Виклик гака «прибрати рухи, крім проводок» — тіло для згенерованого
 * `<model>_unpost`.
 *
 * Проводки ядро прибирає саме (`doc_unpost` чистить `app.journal_entry`), а
 * рядок, який документ поклав у ЧУЖУ таблицю — періодичний реєстр цін, склад,
 * ПДВ, — ні: про неї воно не знає нічого. Доти застосунок закривав це власним
 * тригером на `app.document` — тобто об'єктом на чужій таблиці, про який ядро
 * не знає й порядок спрацювання з яким ніде не описаний.
 *
 * Гак необов'язковий і вмикається СТВОРЕННЯМ функції — рівно так, як
 * `app.doc_before_write`: документи, у яких рухи лише проводками, не міняються
 * зовсім, тож наявні застосунки нічого не переписують. А функція з ІНШИМ
 * підписом валить розпроведення: мовчазний пропуск тут гірший за відмову —
 * застосунок був би певен, що рухи зняті, а вони лишилися б діяти.
 *
 * Кличеться на ОБОХ шляхах, і другий важливіший за перший. `doc_post_begin`
 * повторному проведенню не відмовляє — він зносить проводки й дає провести
 * наново, — тож без виклику ПЕРЕД `_post_entries` рядки в чужій таблиці
 * подвоювалися б із кожним перепроведенням. Правило «перепроведення переписує
 * начисто» ядро вже давно тримає для проводок; тут воно просто поширене на
 * оголошені рухи, а не вигадане.
 */
export function unpostRecordsHookSql(table: string, path: "post" | "unpost" = "unpost"): string {
  const hook = `${table}_unpost_records`;
  const hookName = hook.split(".").pop()!;
  const hookSchema = hook.slice(0, hook.length - hookName.length - 1);
  const pair = `${hookName.replace(/_unpost_records$/, "")}_post_entries`;

  const why = path === "post"
    ? `-- Перепроведення переписує рухи НАЧИСТО — так само, як doc_post_begin щойно
  -- зробив із проводками. Без цього рядки в чужій таблиці подвоювалися б:
  -- повторному проведенню ядро не відмовляє.`
    : `-- Рухи, які документ поклав НЕ в проводки: ядро про чужу таблицю не знає.
  -- Пара до рукописної ${pair} — що документ поклав, те він і прибирає.`;

  return `  ${why}
  -- Гак необов'язковий: немає функції — немає й виклику.
  v_records := to_regprocedure('${hook}(bigint, bigint)');
  if v_records is not null then
    perform ${hook}(user_id, v_id);
  elsif exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = '${hookSchema}' and p.proname = '${hookName}'
  ) then
    raise exception '${hook} існує з іншим підписом і тому не кликається'
      using hint = 'Очікую ${hook}(user_id bigint, document_id bigint)';
  end if;`;
}

function renderUnpost(spec: ModelSpec): string {
  return `drop function if exists ${spec.table}_unpost(bigint, jsonb);
create function ${spec.table}_unpost(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id      bigint := nullif(payload->>'id', '')::bigint;
  v_records regprocedure;
begin
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  perform app.doc_unpost(user_id, v_id);

${unpostRecordsHookSql(spec.table)}

  return ${
    envelope([
      `'item',    (select ${spec.table}_get(user_id, jsonb_build_object('id', v_id::text)) -> 'data' -> 'item')`,
      `'rows',    '[]'::jsonb`,
      `'options', '{}'::jsonb`,
      `'totals',  '{}'::jsonb`,
      `'extra',   '{}'::jsonb`,
    ])
  };
end;
$$;`;
}

function renderSave(spec: ModelSpec): string {
  if (spec.isDocument) return renderSaveDocument(spec);
  const writable = spec.itemFields.filter((f) => f.key !== "id");

  const numbered = spec.numberedField
    ? spec.itemFields.find((f) => f.key === spec.numberedField)
    : undefined;
  if (spec.numberedField && !numbered) {
    throw new Error(
      `${spec.model}: numbering.field = "${spec.numberedField}", але такого поля немає в ItemSchema`,
    );
  }

  // Поле, яке заповнює нумератор, з обов'язкових виключаємо: порожнім його
  // прислати можна і треба — саме це й означає «видай номер».
  const requiredFields = writable.filter((f) => f.required && f.isString && f.key !== spec.numberedField);

  // `using column` — не косметика: рантайм дістає з нього ім'я поля форми
  // (колонка snake_case → поле camelCase) і клієнт підсвічує саме те поле,
  // а не показує самий лише банер. Див. postgresErrorField().
  const checks = requiredFields
    .map((f) =>
      `  if nullif(trim(coalesce(v_item->>'${f.key}', '')), '') is null then\n` +
      `    raise exception '${f.key} обов''язковий' using column = '${f.col}';\n  end if;`
    ).join("\n");

  const headerSrc = spec.itemFields
    .map((f) => `      ${f.key === spec.numberedField ? "v_number" : srcExpr(f, "v_item")} as ${f.col}`)
    .join(",\n");
  const updateSetSql = [
    ...writable.map((f) => updateSet(f, "t")),
    `updated_at = now()`,
  ].join(",\n    ");
  const insertCols = writable.map((f) => f.col).join(", ");
  const insertVals = writable.map((f) => insertVal(f)).join(", ");

  const lineMerges = spec.tables.map((tbl) => `\n${renderLineMerge(tbl)}\n`).join("");

  const { object, joins } = itemObject(spec, "v_id");
  const joinSql = joins.length ? "\n  " + joins.join("\n  ") : "";

  // Нумератор заповнює поле лише коли форма прислала його порожнім. Ручне
  // значення лишається як є, але підтягує лічильник — інакше через кілька
  // записів авто-номер упреться в уже зайнятий. Незмінений код наявного
  // запису (форма шле item цілком) ручним не рахується — ані права, ані
  // підтяжки він не потребує.
  const numberingDecl = numbered
    ? `\n  v_prev   bigint := nullif(v_item->>'id', '')::bigint;\n  v_number ${numbered.isString ? "varchar" : "text"};`
    : "";
  const numberingBody = numbered
    ? `
  v_number := nullif(trim(coalesce(v_item->>'${numbered.key}', '')), '');
  if v_number is null then
    if v_prev is null then
      v_number := app.numerator_next('${spec.model}', '{}'::jsonb);
    else
      select t.${numbered.col} into v_number from ${spec.table} t where t.${spec.pk} = v_prev;
    end if;
  elsif v_prev is null
     or v_number is distinct from (select t.${numbered.col} from ${spec.table} t where t.${spec.pk} = v_prev) then
    if exists (select 1 from app.numerator n where n.model = '${spec.model}' and not n.is_editable) then
      raise exception 'Номер призначає нумератор — ручна зміна вимкнена' using column = '${numbered.col}';
    end if;
    perform app.numerator_bump_to('${spec.model}', '{}'::jsonb, v_number);
  end if;
`
    : "";

  return `drop function if exists ${spec.table}_save(bigint, jsonb);
create function ${spec.table}_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item   jsonb := payload->'item';
  v_id     bigint;${numberingDecl}
  v_result jsonb;
begin
${checks}
${numberingBody}
  merge into ${spec.table} t
  using (
    select
${headerSrc}
  ) s
    on t.${spec.pk} = s.${spec.pk}
  when matched then update set
    ${updateSetSql}
  when not matched then insert (${insertCols})
    values (${insertVals})
  returning t.${spec.pk} into v_id;
${lineMerges}
  select ${object} into v_result
  from ${spec.table} t${joinSql}
  where t.${spec.pk} = v_id;

  return ${
    envelope([
      `'item',    v_result`,
      `'rows',    '[]'::jsonb`,
      `'options', '{}'::jsonb`,
      `'totals',  '{}'::jsonb`,
      `'extra',   '{}'::jsonb`,
    ])
  };
end;
$$;`;
}

function renderDelete(spec: ModelSpec): string {
  return `drop function if exists ${spec.table}_delete(bigint, jsonb);
create function ${spec.table}_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint;
begin
  v_id := nullif(payload->>'id', '')::bigint;
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  ${
    spec.softDelete
      // Позначка, а не знищення: помилкове «Видалити» на проведеному документі
      // забирало б із собою рядки й проводки, і повернути їх не було б звідки.
      // Фізичне видалення — окрема операція, яка мусить перевіряти посилання.
      ? `update ${spec.softDelete.table} set is_deleted = true where ${spec.softDelete.pk} = v_id;`
      : `delete from ${spec.table} where ${spec.pk} = v_id;`
  }

  return ${
    envelope([
      `'item',    null`,
      `'rows',    '[]'::jsonb`,
      `'options', '{}'::jsonb`,
      `'totals',  '{}'::jsonb`,
      `'extra',   jsonb_build_object('deletedId', v_id::text)`,
    ])
  };
end;
$$;`;
}

/** Зняття позначки. Генерується лише для моделей, що мають `is_deleted`. */
function renderUndelete(spec: ModelSpec): string {
  if (!spec.softDelete) return "";
  return `drop function if exists ${spec.table}_undelete(bigint, jsonb);
create function ${spec.table}_undelete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint;
begin
  v_id := nullif(payload->>'id', '')::bigint;
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  update ${spec.softDelete.table} set is_deleted = false where ${spec.softDelete.pk} = v_id;

  return ${
    envelope([
      `'item',    null`,
      `'rows',    '[]'::jsonb`,
      `'options', '{}'::jsonb`,
      `'totals',  '{}'::jsonb`,
      `'extra',   jsonb_build_object('undeletedId', v_id::text)`,
    ])
  };
end;
$$;`;
}

function renderLookup(spec: ModelSpec): string {
  const defaultSort = spec.lookupSort[0]?.token ?? spec.lookupFields[0]?.col ?? spec.pk;
  const cols = fieldEntries(spec.lookupFields).map((e) => `      ${e}`).join(",\n");
  // Join-и ссылок — так само, як у `list`. Без них вивід і пошук посилаються на
  // аліас, якого в запиті немає: `create function` тіла не перевіряє, тож
  // ламається це не на публікації, а на першому відкритті пікера.
  const joinsCount = spec.lookupJoins.length ? "\n  " + spec.lookupJoins.join("\n  ") : "";
  const joinsRows = spec.lookupJoins.length ? "\n    " + spec.lookupJoins.join("\n    ") : "";
  const filter = spec.deletedExpr ? `not ${spec.deletedExpr}` : "";
  const activeFilter = filter ? `${filter}\n      and ` : "";
  const activeFilterCount = filter ? `${filter}\n    and ` : "";
  const sortGuard = spec.lookupSort.length
    ? `  if v_sort_by not in (${whitelist(spec.lookupSort)}) then\n    v_sort_by := '${defaultSort}';\n  end if;\n\n`
    : "";
  // Відбір підбору — ті самі оголошення `x-filter`, що й у списку. Половина
  // механізму була давно (пікер слав параметри в payload), а друга ні: фільтри
  // збиралися лише для `_list`, тож параметри доходили до SQL і там МОВЧКИ
  // ігнорувалися — на екрані це виглядало як «відбір не працює».
  //
  // Різниця зі списком лише в тому, ХТО задає відбір: у списку користувач
  // панеллю, у підборі — форма, і звузити його користувач не має права (рахунок
  // організації в полі «рахунок платника» це не звужений вибір, а помилка
  // вводу). Для SQL це та сама умова, тому й опис один.
  const hasFilters = spec.filters.length > 0;
  const filterDecl = hasFilters
    ? `  v_filters   jsonb := coalesce(payload->'filters', '{}'::jsonb);\n  v_unknown   text;\n` +
      spec.filters.map((f) => f.decl).join("\n") + "\n"
    : "";
  const filterCond = (indent: string) =>
    hasFilters ? "\n" + spec.filters.map((f) => `${indent}and ${f.cond}`).join("\n") : "";
  // Невідомий ключ — відмова, а не тиша. Форма, яка звужує підбір, вважає, що
  // звузила його; мовчазне ігнорування друкарської помилки в імені лишає на
  // екрані повний перелік і жодного сліду. Модель без оголошених фільтрів
  // відмовляє на будь-якому наборі — з тієї самої причини.
  const filterGuard = hasFilters
    ? `  select k into v_unknown\n` +
      `  from jsonb_object_keys(v_filters) k\n` +
      `  where k not in (${spec.filters.map((f) => `'${f.key}'`).join(", ")})\n` +
      `  limit 1;\n\n` +
      `  if v_unknown is not null then\n` +
      `    raise exception '@[core.lookupUnknownFilter]%',\n` +
      `      jsonb_build_object('filter', v_unknown, 'model', '${spec.model}')::text;\n` +
      `  end if;\n\n`
    : `  if payload ? 'filters' and payload->'filters' <> '{}'::jsonb then\n` +
      `    raise exception '@[core.lookupNoFilters]%',\n` +
      `      jsonb_build_object('model', '${spec.model}')::text;\n` +
      `  end if;\n\n`;
  return `drop function if exists ${spec.table}_lookup(bigint, jsonb);
create function ${spec.table}_lookup(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := greatest(coalesce((payload->>'pageSize')::int, 10), 1);
  v_sort_by   text := coalesce(payload->>'sortBy', '${defaultSort}');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir','asc')) = 'desc' then 'desc' else 'asc' end;
${filterDecl}  v_rows      jsonb;
  v_total     int;
begin
${sortGuard}${filterGuard}  select count(*)::int into v_total
  from ${spec.fromClause}${joinsCount}
  where ${activeFilterCount}(
${searchClause(spec.searchExprsLookup, "    ")}
  )${filterCond("  ")};

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
${cols}
    ) as r
    from ${spec.fromClause}${joinsRows}
    where ${activeFilter}(
${searchClause(spec.searchExprsLookup, "      ")}
    )${filterCond("    ")}
    order by
${orderLadder(spec.lookupSort, "      ", spec.pkExpr)}
    limit v_page_size
    offset (v_page - 1) * v_page_size
  ) sub;

  return ${
    envelope([
      `'rows',    v_rows`,
      `'item',    null`,
      `'options', '{}'::jsonb`,
      `'totals',  jsonb_build_object('count', v_total, 'page', v_page, 'pageSize', v_page_size)`,
      `'extra',   '{}'::jsonb`,
    ])
  };
end;
$$;`;
}

// ── ієрархія (патерн A2v10: плоский список + дерево груп) ────────────────────
// Групи живуть в окремій таблиці {model}_group, а не в таблиці моделі з
// прапорцем is_group: список і lookup ніколи не мішають групи з елементами,
// пагінація і підбори не потребують фільтра «без груп», FK каскади прозорі.

function renderGroupTree(spec: ModelSpec): string {
  return `drop function if exists ${spec.table}_group_tree(bigint, jsonb);
create function ${spec.table}_group_tree(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select ${
    envelope([
      `'rows', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', g.id::text,
            'parentId', g.parent_id::text,
            'name', g.name
          ) order by g.name)
          from ${spec.groupTable} g
        ), '[]'::jsonb)`,
      `'item',    null`,
      `'options', '{}'::jsonb`,
      `'totals',  '{}'::jsonb`,
      `'extra',   '{}'::jsonb`,
    ])
  };
$$;`;
}

function renderGroupSave(spec: ModelSpec): string {
  return `drop function if exists ${spec.table}_group_save(bigint, jsonb);
create function ${spec.table}_group_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item   jsonb  := payload->'item';
  v_id     bigint := nullif(v_item->>'id', '')::bigint;
  v_parent bigint := nullif(v_item->>'parentId', '')::bigint;
  v_name   text   := nullif(trim(coalesce(v_item->>'name', '')), '');
  v_result jsonb;
begin
  if v_name is null then
    raise exception 'name обов''язковий';
  end if;

  if v_parent is not null and not exists (select 1 from ${spec.groupTable} where id = v_parent) then
    raise exception 'Батьківської групи не існує';
  end if;

  -- Цикл: групу не можна переносити під саму себе чи власного нащадка.
  if v_id is not null and v_parent is not null then
    if exists (
      with recursive d as (
        select id from ${spec.groupTable} where id = v_id
        union all
        select c.id from ${spec.groupTable} c join d on c.parent_id = d.id
      )
      select 1 from d where id = v_parent
    ) then
      raise exception 'Група не може бути підгрупою власного нащадка';
    end if;
  end if;

  if v_id is null then
    insert into ${spec.groupTable} (parent_id, name)
    values (v_parent, v_name)
    returning id into v_id;
  else
    update ${spec.groupTable}
    set parent_id = v_parent, name = v_name, updated_at = now()
    where id = v_id;
    if not found then
      raise exception 'Групу не знайдено';
    end if;
  end if;

  select jsonb_build_object('id', g.id::text, 'parentId', g.parent_id::text, 'name', g.name)
  into v_result
  from ${spec.groupTable} g
  where g.id = v_id;

  return ${
    envelope([
      `'item',    v_result`,
      `'rows',    '[]'::jsonb`,
      `'options', '{}'::jsonb`,
      `'totals',  '{}'::jsonb`,
      `'extra',   '{}'::jsonb`,
    ])
  };
end;
$$;`;
}

function renderGroupDelete(spec: ModelSpec): string {
  return `drop function if exists ${spec.table}_group_delete(bigint, jsonb);
create function ${spec.table}_group_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := nullif(payload->>'id', '')::bigint;
begin
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  -- Fail-closed: непорожня група не видаляється — ні каскаду на підгрупи,
  -- ні тихого переносу елементів у корінь.
  if exists (select 1 from ${spec.groupTable} where parent_id = v_id) then
    raise exception 'У групі є підгрупи — спочатку приберіть їх';
  end if;
  if exists (select 1 from ${spec.table} where group_id = v_id) then
    raise exception 'У групі є елементи — спочатку перемістіть їх';
  end if;

  delete from ${spec.groupTable} where id = v_id;
  if not found then
    raise exception 'Групу не знайдено';
  end if;

  return ${
    envelope([
      `'item',    null`,
      `'rows',    '[]'::jsonb`,
      `'options', '{}'::jsonb`,
      `'totals',  '{}'::jsonb`,
      `'extra',   jsonb_build_object('deletedId', v_id::text)`,
    ])
  };
end;
$$;`;
}

function renderMoveToGroup(spec: ModelSpec): string {
  return `drop function if exists ${spec.table}_move_to_group(bigint, jsonb);
create function ${spec.table}_move_to_group(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id    bigint := nullif(payload->>'id', '')::bigint;
  -- null — перемістити в корінь: окремої команди «з групи» немає навмисно,
  -- корінь — це просто ще одна ціль у тому самому діалозі.
  v_group bigint := nullif(payload->>'groupId', '')::bigint;
begin
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  if v_group is not null and not exists (select 1 from ${spec.groupTable} where id = v_group) then
    raise exception 'Групи не існує';
  end if;

  update ${spec.table}
  set group_id = v_group, updated_at = now()
  where id = v_id;
  if not found then
    raise exception 'Запис не знайдено';
  end if;

  return ${
    envelope([
      `'item',    null`,
      `'rows',    '[]'::jsonb`,
      `'options', '{}'::jsonb`,
      `'totals',  '{}'::jsonb`,
      `'extra',   jsonb_build_object('movedId', v_id::text)`,
    ])
  };
end;
$$;`;
}

// ── періодичні дані: зріз на дату, історія, перезапис ───────────────────────
//
// Ключ, дата, значення — четвертий типовий вид моделі, і однаковий скрізь. Без
// генерації кожен застосунок писав би той самий `distinct on` заново, і десятий
// раз — без індексу (це вже заміряно: перший такий регістр коштував ≈130 рядків
// рукописного SQL).
//
// Функції рахують ПОЛЯ СПИСКУ (`<Model>RowSchema`): зріз читають ті самі екрани
// й ті самі команди, що й список, тож розходитися формі рядка нема за чим.

/** `t.currency_id, t.period` — ключ плюс період, у порядку оголошення. */
function periodicKeyCols(spec: ModelSpec): string {
  return spec.periodic!.keyFields.map((f) => `t.${f.col}`).join(", ");
}

/** Відбір за ключем: незаданий ключ означає «усі», а не «жоден». */
function periodicKeyFilter(spec: ModelSpec, indent: string): string {
  return spec.periodic!.keyFields
    .map((f) => `${indent}and (payload->>'${f.key}' is null or t.${f.col} = ${srcExpr(f, "payload")})`)
    .join("\n");
}

function renderPeriodicAt(spec: ModelSpec): string {
  const p = spec.periodic!;
  const cols = fieldEntries(spec.listFields).map((e) => `        ${e}`).join(",\n");
  const joins = spec.listJoins.length ? "\n      " + spec.listJoins.join("\n      ") : "";
  return `drop function if exists ${spec.table}_at(bigint, jsonb);
create function ${spec.table}_at(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_on_date date := coalesce(nullif(payload->>'onDate', '')::date, current_date);
  v_rows    jsonb;
begin
  -- Зріз останнього: по одному рядку на ключ — найсвіжіший із тих, що не пізніші
  -- за дату. Саме тут потрібен індекс (ключ…, період desc), інакше це скан.
  select coalesce(jsonb_agg(sub.r), '[]'::jsonb) into v_rows
  from (
    select distinct on (${periodicKeyCols(spec)})
      jsonb_build_object(
${cols}
      ) as r
    from ${spec.fromClause}${joins}
    where t.${p.periodField.col} <= v_on_date
${periodicKeyFilter(spec, "      ")}
    order by ${periodicKeyCols(spec)}, t.${p.periodField.col} desc
  ) sub;

  return ${
    envelope([
      `'rows',    v_rows`,
      // Один рядок — значить ключ звузили до одного; тоді зріз зручніше читати
      // як item, і форма отримує його тим самим ключем, що й get.
      `'item',    case when jsonb_array_length(v_rows) = 1 then v_rows->0 else null end`,
      `'options', '{}'::jsonb`,
      `'totals',  '{}'::jsonb`,
      `'extra',   jsonb_build_object('onDate', v_on_date)`,
    ])
  };
end;
$$;`;
}

function renderPeriodicHistory(spec: ModelSpec): string {
  const p = spec.periodic!;
  const cols = fieldEntries(spec.listFields).map((e) => `      ${e}`).join(",\n");
  const joins = spec.listJoins.length ? "\n    " + spec.listJoins.join("\n    ") : "";
  return `drop function if exists ${spec.table}_history(bigint, jsonb);
create function ${spec.table}_history(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_from date := nullif(payload->>'dateFrom', '')::date;
  v_to   date := nullif(payload->>'dateTo', '')::date;
  v_rows jsonb;
begin
  -- Як значення мінялося: усі рядки ключа, свіжі зверху. Пагінації немає
  -- навмисно — історія одного ключа коротка, а «остання сторінка» тут нічого
  -- не означає.
  select coalesce(jsonb_agg(sub.r order by sub.period desc), '[]'::jsonb) into v_rows
  from (
    select
      t.${p.periodField.col} as period,
      jsonb_build_object(
${cols}
      ) as r
    from ${spec.fromClause}${joins}
    where (v_from is null or t.${p.periodField.col} >= v_from)
      and (v_to   is null or t.${p.periodField.col} <= v_to)
${periodicKeyFilter(spec, "      ")}
  ) sub;

  return ${
    envelope([
      `'rows',    v_rows`,
      `'item',    null`,
      `'options', '{}'::jsonb`,
      `'totals',  '{}'::jsonb`,
      `'extra',   '{}'::jsonb`,
    ])
  };
end;
$$;`;
}

function renderPeriodicSet(spec: ModelSpec): string {
  const p = spec.periodic!;
  const writable = spec.itemFields.filter((f) => f.key !== "id");
  const natural = new Set([...p.keyFields, p.periodField].map((f) => f.col));
  const valueFields = writable.filter((f) => !natural.has(f.col));

  const src = writable.map((f) => `      ${srcExpr(f, "v_item")} as ${f.col}`).join(",\n");
  const onClause = [...p.keyFields, p.periodField].map((f) => `t.${f.col} = s.${f.col}`).join("\n     and ");
  const update = [...valueFields.map((f) => updateSet(f, "t")), "updated_at = now()"].join(",\n    ");
  const insCols = writable.map((f) => f.col).join(", ");
  const insVals = writable.map((f) => insertVal(f)).join(", ");

  return `drop function if exists ${spec.table}_set(bigint, jsonb);
create function ${spec.table}_set(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item jsonb := coalesce(payload->'item', payload);
  v_id   bigint;
begin
  -- Перезапис значення НА ДАТУ: ключ тут природний (ключ + період), а не id.
  -- Саме цим set відрізняється від save: імпорт курсів за датою не знає
  -- ідентифікаторів рядків і не мусить їх шукати.
  merge into ${spec.table} t
  using (
    select
${src}
  ) s
    on ${onClause}
  when matched then update set
    ${update}
  when not matched then insert (${insCols})
    values (${insVals})
  returning t.id into v_id;

  return ${
    envelope([
      `'item',    (select ${spec.table}_get(user_id, jsonb_build_object('id', v_id::text)) -> 'data' -> 'item')`,
      `'rows',    '[]'::jsonb`,
      `'options', '{}'::jsonb`,
      `'totals',  '{}'::jsonb`,
      `'extra',   jsonb_build_object('id', v_id::text)`,
    ])
  };
end;
$$;`;
}

/**
 * Унікальний індекс `(ключ…, період desc)` — один на дві потреби.
 *
 * Унікальність: два значення на одну дату для одного ключа — не дані, а
 * помилка вводу, і `_set` без неї не мав би на що спиратися (`merge` шукає
 * рядок саме за цією парою). Ім'я індексу — джерело поля у відмові
 * (`uq_<model>_period` → `period`).
 *
 * Напрямок: `distinct on (ключ) order by ключ, період desc` бере індекс лише
 * тоді, коли напрямки збігаються — btree сканується цілком уперед або цілком
 * назад. Тому `desc` у самому індексі; на унікальність напрямок не впливає.
 *
 * DDL у генерованому файлі — виняток (структура належить struc.sql), і свідомий:
 * індекс виводиться з того самого оголошення, що й функції, а забутий він не
 * ламає нічого — просто зріз тихо стає скануванням.
 */
function renderPeriodicIndex(spec: ModelSpec): string {
  const p = spec.periodic!;
  const cols = [...p.keyFields.map((f) => f.col), `${p.periodField.col} desc`].join(", ");
  return `create unique index if not exists uq_${spec.model}_period\n  on ${spec.table} (${cols});`;
}

function renderFile(spec: ModelSpec): string {
  const header = `-- ⚠ ЗГЕНЕРОВАНО deno task sql:gen — НЕ РЕДАГУВАТИ.\n` +
    `-- Джерело: ${spec.model}.schema.ts + manifest.json. Override — db/${spec.model}.custom.sql\n`;
  return [
    header,
    renderList(spec),
    renderGet(spec),
    renderSave(spec),
    renderDelete(spec),
    ...(spec.softDelete ? [renderUndelete(spec)] : []),
    ...(spec.isRegister ? [] : [renderLookup(spec)]),
    ...(spec.periodic
      ? [renderPeriodicIndex(spec), renderPeriodicAt(spec), renderPeriodicHistory(spec), renderPeriodicSet(spec)]
      : []),
    ...(spec.isDocument ? [renderPost(spec), renderUnpost(spec)] : []),
    ...(spec.hierarchy
      ? [renderGroupTree(spec), renderGroupSave(spec), renderGroupDelete(spec), renderMoveToGroup(spec)]
      : []),
    "",
  ].join("\n\n");
}

// ── звіт: обгортка команди index ────────────────────────────────────────────
//
// У звіту немає CRUD — є одна команда вибірки. Але навколо самого запиту
// щоразу писалося те саме: розбір `payload.filters`, зворотне представлення
// ссылочного фільтра (`$filters`) і конверт відповіді. Це не просто дубль:
// саме він одного разу розійшовся — методологію вхідного сальдо правили у двох
// звітах окремо, і обидва вважалися джерелом правди.
//
// Тому обгортку генеруємо, а рукописним лишається те, заради чого звіт і
// пишуть, — запит. Розкладка та сама, що в CRUD:
//
//   db/_generated/<model>.index.gen.sql   app.<model>_index  ← генерується
//   db/<model>.sql                        app.<model>_data   ← пишеться руками
//
// Ядро отримує вже РОЗІБРАНІ фільтри (ссылка згорнута до id) і повертає
// `{rows, totals, extra}` — ні про конверт, ні про эхо воно не знає.

type ReportFilter = {
  /** Ключ у `payload.filters` — те саме ім'я, яким його називає панель. */
  key: string;
  /** Ключ у нормалізованому наборі: ссылка стає `<key>Id` (конвенція моделей). */
  normKey: string;
  required: boolean;
  /**
   * Джерело підпису для эха; порожнє — фільтр не ссылочний. Той самий резолв,
   * що в полях моделі: інакше ссылка на документ працювала б у формі й падала
   * у фільтрі звіту — на тій самій анотації.
   */
  ref?: Ref;
  isString: boolean;
};

type ReportSpec = { schema: string; model: string; filters: ReportFilter[] };

/**
 * Ключ фільтра їде в SQL текстом усередині `jsonb_build_object`, тож мусить
 * бути звичайним ідентифікатором. `assertIdentifier` тут не годиться — ключі
 * camelCase (`dateFrom`), і це нормально: це JSON-ключ, а не ім'я колонки.
 */
function assertJsonKey(value: string, label: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${label}: ключ фільтра «${value}» має бути ідентифікатором`);
  }
}

/**
 * Дві половини одного оголошення мусять називати той самий ключ подання.
 *
 * Фільтр звіту — єдине місце, де форму ссылочного значення пишуть РУКАМИ
 * (`Type.Object({ id, name })`); у моделі це скаляр `bankId`, і розійтися там
 * нема з чим. А эхо обгортки віддає `{id, <displayKey>}`, де `displayKey` за
 * умовчанням — перше поле цілі з `x-lookup`, тобто зовсім не завжди `name`.
 * Эхо приходить першим у `v_out := v_filters || …`, тож воно ЗАТИРАЄ підпис,
 * покладений формою: відбір діє, а назва в панелі порожня.
 *
 * Мовчить при цьому все — схема валідна, SQL зелений, числа правильні, — і
 * шукати причину людина йде у форму й у пікер, а не в згенеровану обгортку.
 * Довідники, у яких `x-lookup` стоїть на назві, ховають це роками; ламається
 * воно на першому ж довіднику, у якого перший `x-lookup` — код.
 *
 * Мовчазне «оголосили лише `{id}`» помилкою не рахуємо: там нічого не
 * суперечить, эхо просто дописує підпис.
 */
export function assertFilterDisplayKey(model: string, key: string, prop: TSchema, ref: Ref) {
  const declared = declaredObjectKeys(prop);
  const shape = declared.filter((name) => name !== "id");
  if (!shape.length || declared.includes(ref.displayKey)) return;

  throw new Error(
    `${model}: фільтр «${key}» оголошений як { ${declared.join(", ")} }, ` +
      `а подання моделі ${ref.targetTable} — колонка «${ref.display}»` +
      `${prop["x-ref"]?.display ? "" : " (перше поле з x-lookup)"}. ` +
      `Додайте display: "${camelToSnake(shape[0])}" в x-ref або оголосіть фільтр як ` +
      `{ id, ${ref.displayKey} }`,
  );
}

async function buildReportSpec(
  appRoot: string,
  modelPath: string,
  map: ModelMetaMap,
  verbose: boolean,
): Promise<ReportSpec> {
  const { model, path } = schemaModuleFor(appRoot, modelPath);
  const manifest = JSON.parse(
    await Deno.readTextFile(join(appRoot, modelPath, "manifest.json")),
  ) as FeatureManifest;
  const schemaName = manifest.schema ?? "app";
  assertIdentifier(schemaName, "schema");
  assertIdentifier(model, "model");

  const Pascal = pascalCase(model);
  const mod = await importSchema(path);
  const filtersSchema = mod[`${Pascal}FiltersSchema`];

  // Звіт без фільтрів можливий, але майже завжди це описка в імені експорту, а
  // виглядає вона як робоча генерація. Тому голосно, але не фатально.
  if (!filtersSchema) {
    console.warn(
      `⚠ ${modelPath}: немає ${Pascal}FiltersSchema — обгортка буде без фільтрів. ` +
        `Якщо фільтри у звіту є, звір ім'я експорту.`,
    );
  }

  const props = filtersSchema?.properties ?? {};
  const required = new Set<string>(filtersSchema?.required ?? []);
  const filters: ReportFilter[] = [];

  for (const [key, prop] of Object.entries(props)) {
    assertJsonKey(key, `${model}.${key}`);
    const xref = prop["x-ref"];
    if (xref) {
      const ref = resolveRef(xref, camelToSnake(key), map, `${model}.${key} (фільтр)`);
      assertFilterDisplayKey(model, key, prop, ref);
      filters.push({
        key,
        normKey: `${key}Id`,
        required: required.has(key),
        ref,
        isString: false,
      });
      continue;
    }
    filters.push({
      key,
      normKey: key,
      required: required.has(key),
      isString: isStringType(prop),
    });
  }

  if (verbose) {
    const shown = filters.map((f) =>
      `${f.normKey}${f.required ? "*" : ""}${f.ref ? `→${f.ref.targetSchema}.${f.ref.targetTable}` : ""}`
    );
    console.log(`· ${model}: звіт, фільтри=[${shown.join(", ")}]`);
  }

  return { schema: schemaName, model, filters };
}

function renderReportIndex(spec: ReportSpec): string {
  const fn = `${spec.schema}.${spec.model}`;

  // Нормалізація. Порожній рядок прирівняний до «не задано»: панель шле саме
  // його, коли поле очистили, і `null` тут з'явився б лише в теорії.
  const normPairs = spec.filters.map((f) =>
    f.ref
      ? `    '${f.normKey}', nullif(v_filters->'${f.key}'->>'id', '')`
      : f.isString
      ? `    '${f.normKey}', nullif(v_filters->>'${f.key}', '')`
      : `    '${f.normKey}', v_filters->'${f.key}'`
  );

  // Эхо ссылочного фільтра: id прислав клієнт, підпис знає лише база. Ключ
  // підпису — той самий, що в моделях (`displayKey`): у довідників це `name`,
  // тобто нічого не змінилося, а документ показується представленням шапки.
  const echoPairs = spec.filters.filter((f) => f.ref).map((f) => {
    const r = f.ref!;
    const target = `${r.targetSchema}.${r.targetTable}`;
    const from = r.displayInHeader
      ? `${target} x join app.document xh on xh.id = x.${r.targetPk}`
      : `${target} x`;
    return `    '${f.key}',\n` +
      `    (select jsonb_build_object('id', x.${r.targetPk}::text, '${r.displayKey}', ${
        refDisplaySql(r, "x", "xh")
      })\n` +
      `       from ${from} where x.${r.targetPk} = (v_norm->>'${f.normKey}')::bigint)`;
  });

  const echo = echoPairs.length
    ? `  v_out := v_filters || jsonb_strip_nulls(jsonb_build_object(\n${
      echoPairs.join(",\n")
    }\n  ));`
    : `  v_out := v_filters;`;

  // Перевірка обов'язкових. Оператор `?` замість порівняння з null: після
  // jsonb_strip_nulls «не задано» — це відсутність ключа, однаково для рядка,
  // числа й ссылки, тож одна перевірка на всі види.
  const checks = spec.filters.filter((f) => f.required).map((f) =>
    `  if not (v_norm ? '${f.normKey}') then\n` +
    `    return ${refusal(f.key)};\n` +
    `  end if;\n`
  );

  return `-- ⚠ ЗГЕНЕРОВАНО deno task sql:gen — НЕ РЕДАГУВАТИ.
-- Джерело: ${spec.model}.schema.ts (${pascalCase(spec.model)}FiltersSchema) + manifest.json.
-- Сам запит звіту — рукописний, у db/${spec.model}.sql: ${fn}_data(user_id, filters).

drop function if exists ${fn}_index(bigint, jsonb);
create function ${fn}_index(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_filters jsonb := coalesce(payload->'filters', '{}'::jsonb);
  v_norm    jsonb;
  v_out     jsonb;
  v_data    jsonb;
begin
  -- Ссылка згортається до id: далі всередині звіту вона нікому не потрібна.
  v_norm := jsonb_strip_nulls(jsonb_build_object(
${normPairs.join(",\n")}
  ));

  -- Назад ссылка їде з підписом із бази: id міг прийти сам, без назви (перехід
  -- із іншого звіту), і тоді пікер стояв би порожнім при діючому фільтрі.
${echo}

${checks.length ? checks.join("\n") + "\n" : ""}  v_data := coalesce(${fn}_data(user_id, v_norm), '{}'::jsonb);

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item',     v_data->'item',
      'rows',     coalesce(v_data->'rows', '[]'::jsonb),
      'options',  coalesce(v_data->'options', '{}'::jsonb),
      'totals',   coalesce(v_data->'totals', '{}'::jsonb),
      'extra',    coalesce(v_data->'extra', '{}'::jsonb),
      '$filters', v_out
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
end;
$$;
`;
}

/**
 * Відмова через незаповнений обов'язковий фільтр.
 *
 * Эхо `$filters` у відмову теж кладеться: без нього панель втратила б підписи
 * ссылочних фільтрів рівно тоді, коли користувач і має їх доповнювати.
 *
 * Текст — маркер: сервер мови користувача не знає. Поле називається одне —
 * перше незаповнене; перелічувати всі означало б показати той самий рядок
 * кілька разів, а які саме фільтри обов'язкові, видно з зірочок у панелі.
 */
function refusal(field: string): string {
  return `jsonb_build_object(
      'ok', false,
      'data', jsonb_build_object(
        'item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb,
        'totals', '{}'::jsonb, 'extra', '{}'::jsonb, '$filters', v_out
      ),
      'messages', jsonb_build_array(jsonb_build_object(
        'type', 'error',
        'text', '@[core.reportFilterRequired]',
        'field', '${field}'
      )),
      'meta', '{}'::jsonb
    )`;
}

// ── вилучення метаданих ─────────────────────────────────────────────────────────

function schemaModuleFor(appRoot: string, modelPath: string) {
  const model = basename(modelPath);
  return { model, path: join(appRoot, modelPath, `${model}.schema.ts`) };
}

async function importSchema(path: string): Promise<Record<string, TSchema>> {
  return await import(toFileUrl(resolve(path)).href);
}

/** manifest.json моделі; undefined — файлу немає або він нечитабельний. */
async function modelManifest(appRoot: string, modelPath: string): Promise<FeatureManifest | undefined> {
  try {
    return JSON.parse(
      await Deno.readTextFile(join(appRoot, modelPath, "manifest.json")),
    ) as FeatureManifest;
  } catch {
    return undefined;
  }
}

/**
 * Спільна шапка документа — контракт фреймворку `client/shared/schema.ts`
 * (переїхав з app/shared, щоб `client` не залежав від застосунку). У монорепо
 * `client/` — сусід `app/`; коли scripts стануть пакетом (борг 3.4), шлях
 * резолвитиметься через залежність.
 */
/**
 * Схема спільної шапки документа — контракт ФРЕЙМВОРКУ, тож береться звідти ж,
 * звідки її бере сам застосунок: з його карти імпортів.
 *
 * Доти тут стояв шлях `appRoot/../client/shared/schema.ts` — розкладка
 * МОНОРЕПОЗИТОРІЮ, зашита в інструмент, який роздається з JSR. У встановленому
 * застосунку каталогу `client/` немає й бути не може (фреймворк лежить у
 * `vendor/jsr.io/@altera/client/<версія>`, а `@client/` — аліас), тому
 * `type: "document"` там не генерувався взагалі: `Module not found`. Помітно це
 * ставало не одразу — документи приїжджали в застосунок готовими файлами з
 * монорепозиторію, — а далі кожна правка схеми документа означала повернення до
 * копіювання між деревами, від якого й пішли.
 *
 * Версію бере ЗАСТОСУНОК, а не інструмент: якби `tools` імпортував
 * `@altera/client` своєю залежністю, у застосунку опинилися б дві версії
 * клієнта — рівно та пастка, що вже стріляла з `@altera/server` (див. CLAUDE.md,
 * «Версію фреймворку теж називає застосунок»).
 */
async function loadDocumentHeaderSchema(appRoot: string): Promise<TSchema> {
  const specifier = await documentHeaderSpecifier(appRoot);
  const mod = await import(specifier) as Record<string, TSchema>;
  const schema = mod["DocumentHeaderSchema"];
  if (!schema) throw new Error(`${specifier}: немає DocumentHeaderSchema`);
  return schema;
}

/**
 * Куди веде `@client/shared/schema.ts` у ЦЬОМУ застосунку.
 *
 * Експортована заради проби: сам імпорт схеми перевіряється лише повним
 * прогоном генерації, а зламався тут саме РЕЗОЛВ — і зламався тихо, бо в
 * монорепозиторії обидві гілки ведуть в одне місце.
 */
export async function documentHeaderSpecifier(appRoot: string): Promise<string> {
  const SUBPATH = "shared/schema.ts";
  const configDir = resolve(appRoot, "..");

  // Карта імпортів застосунку — джерело істини: у монорепо `@client/` веде на
  // сусідній каталог, у встановленому застосунку — на пакет із реєстру, і
  // обидва випадки закриває той самий рядок.
  const prefix = await clientPrefix(configDir);
  if (prefix) {
    // `jsr:/@altera/client@^0.9.1/` — форма для КАРТИ імпортів; як специфікатор
    // імпорту скісна після схеми зайва.
    if (/^(jsr|npm|https?):/.test(prefix)) return `${prefix.replace(/^jsr:\//, "jsr:")}${SUBPATH}`;
    return toFileUrl(resolve(configDir, prefix, SUBPATH)).href;
  }

  // Карти немає (чужа розкладка) — лишається сусідній каталог монорепозиторію.
  const neighbour = join(configDir, "client", SUBPATH);
  try {
    await Deno.stat(neighbour);
    return toFileUrl(neighbour).href;
  } catch {
    throw new Error(
      `шапку документа не знайдено: у ${configDir}/deno.json немає імпорту "@client/", ` +
        `а ${neighbour} не існує. Тип "document" генерується зі схеми фреймворку — ` +
        `оголоси @client/ у карті імпортів застосунку`,
    );
  }
}

/** Значення `@client/` (або `@altera/client`) з deno.json застосунку. */
async function clientPrefix(configDir: string): Promise<string | undefined> {
  for (const name of ["deno.json", "deno.jsonc"]) {
    let text: string;
    try {
      text = await Deno.readTextFile(join(configDir, name));
    } catch {
      continue;
    }
    // Конфіг Deno — JSONC: рядкові коментарі в ньому законні (у шаблоні вони є).
    const imports = (parseJsonc(text) as { imports?: Record<string, string> }).imports ?? {};
    const alias = imports["@client/"];
    if (alias) return alias.endsWith("/") ? alias : `${alias}/`;
    // Без аліаса — саме ім'я пакета: `jsr:@altera/client@^0.9.1` → підшлях.
    const pkg = imports["@altera/client"];
    if (pkg) return `${pkg}/`;
  }
  return undefined;
}

/**
 * Каталоги моделей — усе, що оголосило себе манифестом.
 *
 * Той самий обхід, що будує реєстр рантайму, і з тим самим доводом: у
 * `sql.json` лежать моделі, які везуть СВІЙ SQL, а посилатися можна й на ту,
 * чий SQL лежить у ядрі (`admin/user` — це `app.users` із `@core/access`).
 * «Мій SQL пишуть інші» і «на мене не можна посилатися» — різні речі, і доти
 * вони були одним.
 */
export async function collectModelDirs(appRoot: string): Promise<string[]> {
  const dirs: string[] = [];

  const visit = async (dir: string) => {
    try {
      await Deno.stat(join(dir, "manifest.json"));
      dirs.push(dir);
    } catch {
      // Каталог без манифеста — не модель; спускаємося далі.
    }
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isDirectory || entry.name.startsWith("_")) continue;
      await visit(join(dir, entry.name));
    }
  };

  await visit(appRoot);
  return dirs;
}

// перший прохід: карта моделей для резолву x-ref
async function buildModelMap(appRoot: string, verbose: boolean): Promise<ModelMetaMap> {
  const map: ModelMetaMap = new Map();

  for (const dir of await collectModelDirs(appRoot)) {
    const manifest = JSON.parse(
      await Deno.readTextFile(join(dir, "manifest.json")),
    ) as FeatureManifest;
    const model = manifest.model?.trim() || basename(dir);
    const path = join(dir, `${model}.schema.ts`);

    try {
      await Deno.stat(path);
    } catch {
      // Мовчазний пропуск тут коштував найдорожче: модель зникала з карти без
      // сліду, а вилазило це за два кроки — «модель не знайдена (x-ref)» на
      // ЧУЖОМУ полі. Тепер причина названа в місці, де вона виникла.
      if (verbose) {
        console.log(`· ${model}: немає ${model}.schema.ts — на модель не можна послатися (x-ref)`);
      }
      continue;
    }

    const schemaName = manifest.schema ?? "app";
    const isDocument = manifest.type === "document";
    const mod = await importSchema(path);
    const item = mod[`${pascalCase(model)}ItemSchema`];
    const props = item?.properties ?? {};
    // Документ показують представленням із шапки, і власного `x-lookup` у його
    // схемі шукати нема де: спільних реквізитів документ у себе не описує
    // взагалі, а `name` в нього немає — саме тому ссылка на документ падала
    // з «column r_shipment.name does not exist» ще до того, як дійшла до ключа.
    let displayCol = isDocument ? DOCUMENT_DISPLAY_COL : "name";
    for (const [key, prop] of Object.entries(props)) {
      if (prop["x-lookup"] && isStringType(prop)) {
        displayCol = prop["x-db-col"] ?? camelToSnake(key);
        break;
      }
    }

    map.set(model, {
      schema: schemaName,
      model,
      table: manifest.table?.trim() || model,
      // Документ не має власної identity: первинний ключ його таблиці — це
      // посилання на шапку. Хто цього не знає, будує join у неіснуючу колонку.
      pk: isDocument ? "document_id" : "id",
      displayCol,
      isDocument,
    });
  }

  return map;
}

/**
 * Звірити константу з реальною шапкою — на першому ж документі застосунку.
 *
 * `DOCUMENT_HEADER_COLS` вирішує, куди генератор іде за поданням ссылки на
 * документ. Нова колонка в `DocumentHeaderSchema` без рядка тут означала б, що
 * `display: "<нова>"` мовчки шукається в таблиці МОДЕЛІ — і публікація падає з
 * «column does not exist» на чужому полі, за два кроки від причини.
 */
function assertHeaderColsKnown(headerFields: Field[], model: string) {
  const unknown = headerFields
    .filter((f) => f.key !== "id" && !DOCUMENT_HEADER_COLS.has(f.col))
    .map((f) => f.col);
  if (unknown.length) {
    throw new Error(
      `${model}: у шапці документа з'явилися колонки [${unknown.join(", ")}], ` +
        `яких не знає DOCUMENT_HEADER_COLS у generate-model-sql.ts — допиши їх, ` +
        `інакше x-ref із таким display шукатиме колонку в таблиці моделі`,
    );
  }
}

async function buildSpec(
  appRoot: string,
  modelPath: string,
  map: ModelMetaMap,
  verbose: boolean,
): Promise<ModelSpec> {
  const { model, path } = schemaModuleFor(appRoot, modelPath);
  const manifest = JSON.parse(
    await Deno.readTextFile(join(appRoot, modelPath, "manifest.json")),
  ) as FeatureManifest;
  const schemaName = manifest.schema ?? "app";
  assertIdentifier(schemaName, "schema");
  assertIdentifier(model, "model");

  const Pascal = pascalCase(model);
  const mod = await importSchema(path);
  const itemSchema = mod[`${Pascal}ItemSchema`];
  const rowSchema = mod[`${Pascal}RowSchema`];
  const lookupSchema = mod[`${Pascal}LookupRowSchema`];

  // Регістр — це дані, а не картка: на нього ніхто не посилається, тож і
  // підбирати його в пікері нема кому й нема чим (представлення в рядка курсу
  // валют немає взагалі). Тому `lookup` йому не генерується, а `LookupRowSchema`
  // не вимагається — інакше довелося б писати схему заради функції, яку ніхто
  // не покличе.
  const isRegister = manifest.type === "register";
  if (!itemSchema || !rowSchema || (!lookupSchema && !isRegister)) {
    throw new Error(
      `${model}: очікую ${Pascal}ItemSchema/${Pascal}RowSchema` +
        (isRegister ? "" : `/${Pascal}LookupRowSchema`),
    );
  }

  const isDocument = manifest.type === "document";

  const hierarchy = manifest.hierarchy === true;
  if (hierarchy && isDocument) {
    throw new Error(`${model}: hierarchy можлива лише для catalog, не для document`);
  }

  // Номер документа генератор і так підставляє через app.doc_next_number —
  // оголошення numbering у документа лише називає шаблон для сіду.
  const numberedField = isDocument ? null : (manifest.numbering?.field?.trim() || null);

  // Документ не описує спільні реквізити у власній схемі — генератор підмішує
  // DocumentHeaderSchema сам. Поля шапки живуть у app.document (аліас h),
  // реквізити документа — у app.<model> (аліас t) з ключем document_id.
  const headerFields = isDocument
    ? parseObject(await loadDocumentHeaderSchema(appRoot), schemaName, map, `${model}.header`, "h").fields
    : [];
  const headerKeys = new Set(headerFields.map((f) => f.key));
  assertHeaderColsKnown(headerFields, model);

  const parsed = parseObject(itemSchema, schemaName, map, model);
  for (const f of parsed.fields) {
    if (isDocument && headerKeys.has(f.key)) {
      throw new Error(
        `${model}.${f.key}: поле спільної шапки документа не описують у схемі моделі`,
      );
    }
  }
  const tables = parsed.tables;
  const itemFields = isDocument ? [...headerFields, ...parsed.fields.filter((f) => f.key !== "id")] : parsed.fields;

  // Ссылка в підборі описується так само, як у списку: ключем ВКЛАДЕНОГО
  // об'єкта (`counterparty`), а сама анотація `x-ref` лишається на полі
  // `counterpartyId` в ItemSchema. Двоїти її по схемах не можна — розійдуться:
  // LookupRowSchema тоді розібрав би `counterparty` як звичайну колонку
  // `t.counterparty`, якої в таблиці немає.
  const refByAs = new Map(itemFields.filter((f) => f.ref).map((f) => [f.ref!.as, f]));
  // Аліас lookup-полів визначає походження ключа: шапка чи таблиця моделі.
  const lookupFields = lookupSchema
    ? parseObject(lookupSchema, schemaName, map, `${model}.lookup`).fields
      .map((f) =>
        refByAs.get(f.key) ??
          (isDocument && headerKeys.has(f.key) ? { ...f, alias: "h" } : f)
      )
    : [];

  const rowKeys = new Set(Object.keys(rowSchema.properties ?? {}));
  const listFields = itemFields.filter((f) =>
    rowKeys.has(f.key) || (f.ref && rowKeys.has(f.ref.as))
  );

  const filters = buildFilters(itemFields, model);

  // search (list): ref.searchable → display; скаляр з x-search → alias.col; фоллбек — усі строкові
  const searchExprsList: string[] = [];
  for (const f of itemFields) {
    if (f.ref?.searchable) searchExprsList.push(refDisplaySql(f.ref));
    else if (!f.ref && f.search) searchExprsList.push(`${f.alias}.${f.col}`);
  }
  if (searchExprsList.length === 0) {
    for (const f of itemFields) {
      if (f.isString && f.key !== "id") searchExprsList.push(`${f.alias}.${f.col}`);
    }
  }

  // search (lookup): те саме, що в списку. Раніше ссылки звідси свідомо
  // викидалися — «без ref-joins», — але це був наслідок того, що join-ів у
  // lookup не було взагалі: оголошений `searchable` мовчки не діяв у підборі й
  // діяв у списку, тобто той самий рядок схеми означав різне.
  const searchExprsLookup: string[] = [];
  for (const f of itemFields) {
    if (f.ref?.searchable) searchExprsLookup.push(refDisplaySql(f.ref));
    else if (!f.ref && f.search) searchExprsLookup.push(`${f.alias}.${f.col}`);
  }
  if (searchExprsLookup.length === 0) {
    for (const f of itemFields) {
      if (f.isString && f.key !== "id") searchExprsLookup.push(`${f.alias}.${f.col}`);
    }
  }

  // sort (list): токен = JSON-ключ (= ListColumn.key на фронті), вираз = alias.col
  const listSort: SortEntry[] = [];
  for (const f of listFields) {
    if (f.ref?.sortable) listSort.push({ token: f.ref.as, expr: refDisplaySql(f.ref) });
    else if (!f.ref && f.sortable) listSort.push({ token: f.key, expr: `${f.alias}.${f.col}` });
  }

  // sort (lookup): скалярні sortable у складі lookup-полів
  const lookupKeys = new Set(lookupFields.map((f) => f.key));
  const lookupSort: SortEntry[] = itemFields
    .filter((f) => !f.ref && f.sortable && lookupKeys.has(f.key))
    .map((f) => ({ token: f.key, expr: `${f.alias}.${f.col}` }));

  // joins для list: ref-поля, які потрібні у виводі/пошуку/сортуванні
  const listRefFields = itemFields.filter((f) =>
    f.ref && (f.ref.searchable || f.ref.sortable || rowKeys.has(f.ref.as))
  );
  const listJoins = refJoins(listRefFields);

  // Періодичні дані: ключ і період називаються ПОЛЯМИ схеми, а не колонками —
  // так само, як numbering.field. Помилка в імені має бути видно на генерації,
  // а не на першому виклику: без цієї перевірки `_at` мовчки різав би не по
  // тому ключу.
  const periodicMeta = manifest.periodic;
  const fieldByKey = new Map(itemFields.map((f) => [f.key, f]));
  const periodic = periodicMeta
    ? {
      keyFields: periodicMeta.key.map((name) => {
        const field = fieldByKey.get(name);
        if (!field) throw new Error(`${model}: periodic.key містить поле "${name}", якого немає в ItemSchema`);
        return field;
      }),
      periodField: (() => {
        const field = fieldByKey.get(periodicMeta.period);
        if (!field) {
          throw new Error(`${model}: periodic.period = "${periodicMeta.period}", але такого поля немає в ItemSchema`);
        }
        if (!field.isDate && !field.isTimestamp) {
          throw new Error(`${model}: periodic.period = "${periodicMeta.period}" мусить бути датою (x-db-type: date)`);
        }
        return field;
      })(),
    }
    : null;
  if (periodic && periodic.keyFields.length === 0) {
    throw new Error(`${model}: periodic.key порожній — без ключа зріз останнього не має сенсу`);
  }

  // joins для lookup: ссылки у виводі підбору плюс ті, за якими він шукає.
  const lookupJoins = refJoins([
    ...lookupFields.filter((f) => f.ref),
    ...itemFields.filter((f) => f.ref?.searchable),
  ]);

  // Позначка живе в шапці документа (app.document) або в самій таблиці довідника.
  const hasDeleted = isDocument || itemFields.some((f) => f.col === "is_deleted");

  // Без groupId у схемі save мовчки губив би належність до групи при кожному
  // збереженні форми — краще голосно на генерації.
  if (hierarchy && !itemFields.some((f) => f.col === "group_id")) {
    throw new Error(`${model}: hierarchy вимагає поля groupId (колонка group_id) в ItemSchema`);
  }

  if (verbose) {
    const refs = itemFields.filter((f) => f.ref).map((f) => f.ref!.as);
    console.log(
      `· ${model}: tables=[${tables.map((t) => t.table)}] refs=[${refs}] ` +
        `listSort=[${listSort.map((s) => s.token)}] lookupSort=[${lookupSort.map((s) => s.token)}]`,
    );
  }

  return {
    model,
    schema: schemaName,
    table: `${schemaName}.${model}`,
    pk: isDocument ? "document_id" : "id",
    isDocument,
    isRegister,
    fromClause: isDocument
      ? `app.document h\n    join ${schemaName}.${model} t on t.document_id = h.id`
      : `${schemaName}.${model} t`,
    pkExpr: isDocument ? "h.id" : "t.id",
    deletedExpr: hasDeleted ? (isDocument ? "h.is_deleted" : "t.is_deleted") : "",
    softDelete: hasDeleted
      ? (isDocument ? { table: "app.document", pk: "id" } : { table: `${schemaName}.${model}`, pk: isDocument ? "document_id" : "id" })
      : null,
    headerFields,
    itemFields,
    tables,
    listFields,
    lookupFields,
    filters,
    searchExprsList,
    searchExprsLookup,
    listSort,
    lookupSort,
    listJoins,
    lookupJoins,
    periodic,
    numberedField,
    hierarchy,
    groupTable: `${schemaName}.${model}_group`,
    rowHasGroupName: hierarchy && rowKeys.has("groupName"),
  };
}

// ── main ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = [...Deno.args];
  const verbose = args.includes("--verbose");
  const positional = args.filter((a) => !a.startsWith("--"));
  const appRoot = resolve(positional[0] ?? "./app");
  const filter = positional[1];

  const sqlManifest = JSON.parse(
    await Deno.readTextFile(join(appRoot, "sql.json")),
  ) as SqlManifest;
  const allModels = sqlManifest.models ?? [];

  // 1) карта всіх моделей (для x-ref), 2) генерація.
  //
  // Карта — з манифестів усього дерева, а генерація — з `sql.json`: посилатися
  // можна на ширше коло, ніж те, чий SQL збирається.
  const map = await buildModelMap(appRoot, verbose);
  if (verbose) console.log(`· карта моделей: [${[...map.keys()]}]`);

  const models = allModels.filter((m) => !filter || m === filter);
  if (filter && models.length === 0) {
    console.error(`✗ ${filter}: немає такого запису в sql.json`);
    Deno.exit(1);
  }

  let count = 0;
  const failed: Array<{ modelPath: string; message: string }> = [];

  for (const modelPath of models) {
    // Порядок перевірок важливий: спершу оголошені причини пропуску (відмова
    // в манифесті, тип моделі), і лише потім наявність файлу схеми. Зворотний
    // порядок скаржився б на ім'я файлу там, де модель і так не генерується.
    const manifest = await modelManifest(appRoot, modelPath);

    if (manifest?.sql?.generate === false) {
      // Оголошена відмова. Причина буває різна — CRUD написаний руками в
      // db/<model>.sql (збирач візьме його legacy-гілкою) або взагалі живе в
      // ядрі, як у меню. Друкуємо завжди: пропуск має бути видно.
      console.log(`· ${modelPath}: sql.generate=false — генерація вимкнена, пропуск`);
      continue;
    }

    const manifestType = manifest?.type;
    const isReport = manifestType === "report";
    const GENERATED_TYPES = ["catalog", "document", "register", "report"];
    if (manifestType && !GENERATED_TYPES.includes(manifestType)) {
      if (verbose) console.log(`· ${modelPath}: type=${manifestType} — генерація CRUD не потрібна`);
      continue;
    }

    const { model, path } = schemaModuleFor(appRoot, modelPath);
    try {
      await Deno.stat(path);
    } catch {
      // Файлу немає з двох різних причин, і плутати їх дорого. Пакет ядра
      // (@core/*) схеми не має взагалі — це норма. А от каталог моделі, у
      // якому лежить схема під ІНШИМ іменем, — це мовчазний пропуск не з тієї
      // причини: модель виглядає охопленою, хоча генератор її не бачить.
      const stray = await straySchemaFile(appRoot, modelPath, model);
      if (stray) {
        console.warn(
          `⚠ ${modelPath}: генератор шукає ${model}.schema.ts, а поруч лежить ${stray}. ` +
            `Модель пропущена. Якщо CRUD тут написаний руками — оголоси це явно: ` +
            `"sql": { "generate": false } у manifest.json.`,
        );
      } else if (verbose) {
        console.log(`· ${modelPath}: немає schema.ts — пропуск`);
      }
      continue;
    }

    // Помилка однієї моделі не спиняє решту: інакше одна неузгоджена схема
    // лишає без генерації всі моделі, що стоять у sql.json нижче за неї.
    // Ненульовий код виходу при цьому зберігається — див. нижче.
    try {
      const outDir = join(appRoot, modelPath, "db", "_generated");
      await Deno.mkdir(outDir, { recursive: true });

      // У звіту генерується не CRUD, а ОБГОРТКА команди index: розбір фільтрів,
      // перевірка обов'язкових, эхо `$filters` і конверт. Сам запит лишається
      // рукописним — у db/<model>.sql, функцією <model>_data.
      const [outFile, text] = isReport
        ? [
          join(outDir, `${model}.index.gen.sql`),
          renderReportIndex(await buildReportSpec(appRoot, modelPath, map, verbose)),
        ]
        : await (async () => {
          const spec = await buildSpec(appRoot, modelPath, map, verbose);
          return [join(outDir, `${spec.model}.crud.gen.sql`), renderFile(spec)] as const;
        })();

      await Deno.writeTextFile(outFile, text);
      console.log(`✓ ${modelPath} → ${outFile}`);
      count++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✗ ${modelPath}: ${message}`);
      failed.push({ modelPath, message });
    }
  }

  console.log(`\nЗгенеровано моделей: ${count}`);

  if (failed.length) {
    console.error(`Не вдалося: ${failed.length} — [${failed.map((f) => f.modelPath).join(", ")}]`);
    Deno.exit(1);
  }
}

/**
 * Схема під іншим іменем у каталозі моделі (`userGroup.schema.ts` там, де
 * генератор чекає `user_group.schema.ts`). Повертає ім'я файлу або null.
 */
async function straySchemaFile(
  appRoot: string,
  modelPath: string,
  model: string,
): Promise<string | null> {
  try {
    for await (const entry of Deno.readDir(join(appRoot, modelPath))) {
      if (entry.isFile && entry.name.endsWith(".schema.ts") && entry.name !== `${model}.schema.ts`) {
        return entry.name;
      }
    }
  } catch {
    // Каталогу немає — це пакет ядра (@core/*), а не модель застосунку.
  }
  return null;
}

if (import.meta.main) {
  await main();
}
