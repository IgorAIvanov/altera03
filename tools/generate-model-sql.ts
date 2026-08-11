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

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

// ── TypeBox schema shape (рантайм = JSON Schema об'єкт) ───────────────────────

type XRef = {
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
   * Автонумерація (@core/numerator). Правило й лічильник живуть у базі, тут —
   * лише те, що потрібно генератору: яке поле заповнювати. Сам шаблон їде в
   * сід через assemble-sql-package.ts.
   */
  numbering?: { field: string; template?: string; strategy?: string; period?: string; name?: string };
};

type Ref = {
  fkCol: string; // колонка-FK на цій таблиці (counterparty_id)
  as: string; // ключ вкладеного об'єкта (counterparty)
  display: string; // display-колонка цілі (name)
  targetSchema: string;
  targetTable: string;
  targetPk: string;
  alias: string; // аліас join (r_counterparty)
  sortable: boolean;
  searchable: boolean;
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

type ModelMeta = { schema: string; model: string; pk: string; displayCol: string };
type ModelMetaMap = Map<string, ModelMeta>;

// ── helpers ──────────────────────────────────────────────────────────────────

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function pascalCase(model: string): string {
  return model.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

function isStringType(s: TSchema): boolean {
  if (s.type === "string") return true;
  return Array.isArray(s.anyOf) && s.anyOf.some((m) => m.type === "string");
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

  let ref: Ref | undefined;
  const xref = prop["x-ref"];
  if (xref) {
    const target = map.get(xref.model);
    if (!target) {
      throw new Error(`${owner}.${key} → модель '${xref.model}' не знайдена (x-ref)`);
    }
    const as = xref.as ?? xref.model;
    ref = {
      fkCol: xref.fk ?? col,
      as,
      display: xref.display ?? target.displayCol,
      targetSchema: target.schema,
      targetTable: target.model,
      targetPk: target.pk,
      alias: `r_${as}`,
      sortable: xref.sortable === true,
      searchable: xref.searchable === true,
    };
  }

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
    boolDefaultSql: prop.default === false ? "false" : "true",
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
      spec.mirror = {
        key: r.as,
        expr: `(select jsonb_build_object('id', x.${r.targetPk}::text, '${r.display}', x.${r.display})
     from ${r.targetSchema}.${r.targetTable} x where x.${r.targetPk} = ${varName2})`,
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

  for (const [key, prop] of Object.entries(props)) {
    // Транзієнтне поле живе тільки в типі форми (напр. токен вкладення, який
    // підставляє рантайм) — колонки під нього немає, у SQL воно не потрапляє.
    if (prop["x-transient"]) continue;

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

// вивід вкладеного об'єкта ссылки
function refEntry(f: Field): string {
  const r = f.ref!;
  return `'${r.as}', case when ${r.alias}.${r.targetPk} is null then null ` +
    `else jsonb_build_object('id', ${r.alias}.${r.targetPk}::text, '${r.display}', ${r.alias}.${r.display}) end`;
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
    const r = f.ref;
    joins.push(
      `left join ${r.targetSchema}.${r.targetTable} ${r.alias} on ${r.alias}.${r.targetPk} = ${f.alias}.${r.fkCol}`,
    );
  }
  return joins;
}

// extract+cast значення поля з jsonb-виразу jsonVar
function srcExpr(f: Field, jsonVar: string): string {
  // jsonb-колонка: беремо піддерево (->), а не текст (->>), інакше значення
  // поїде в БД як рядок і впаде на типі.
  if (f.isJson) return `${jsonVar}->'${f.key}'`;
  const g = `${jsonVar}->>'${f.key}'`;
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

function renderPost(spec: ModelSpec): string {
  return `drop function if exists ${spec.table}_post(bigint, jsonb);
create function ${spec.table}_post(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := nullif(payload->>'id', '')::bigint;
begin
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  perform app.doc_post_begin(user_id, v_id);
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

function renderUnpost(spec: ModelSpec): string {
  return `drop function if exists ${spec.table}_unpost(bigint, jsonb);
create function ${spec.table}_unpost(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := nullif(payload->>'id', '')::bigint;
begin
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  perform app.doc_unpost(user_id, v_id);

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
  const filter = spec.deletedExpr ? `not ${spec.deletedExpr}` : "";
  const activeFilter = filter ? `${filter}\n      and ` : "";
  const activeFilterCount = filter ? `${filter}\n    and ` : "";
  const sortGuard = spec.lookupSort.length
    ? `  if v_sort_by not in (${whitelist(spec.lookupSort)}) then\n    v_sort_by := '${defaultSort}';\n  end if;\n\n`
    : "";
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
  v_rows      jsonb;
  v_total     int;
begin
${sortGuard}  select count(*)::int into v_total
  from ${spec.fromClause}
  where ${activeFilterCount}(
${searchClause(spec.searchExprsLookup, "    ")}
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
${cols}
    ) as r
    from ${spec.fromClause}
    where ${activeFilter}(
${searchClause(spec.searchExprsLookup, "      ")}
    )
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
    renderLookup(spec),
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
  /** Джерело підпису для эха; порожнє — фільтр не ссылочний. */
  ref?: { table: string; pk: string; display: string };
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
      const target = map.get(xref.model);
      if (!target) {
        throw new Error(`${model}.${key}: модель '${xref.model}' не знайдена (x-ref фільтра)`);
      }
      filters.push({
        key,
        normKey: `${key}Id`,
        required: required.has(key),
        ref: {
          table: `${target.schema}.${target.model}`,
          pk: target.pk,
          display: xref.display ?? target.displayCol,
        },
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
      `${f.normKey}${f.required ? "*" : ""}${f.ref ? `→${f.ref.table}` : ""}`
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

  const echoPairs = spec.filters.filter((f) => f.ref).map((f) =>
    `    '${f.key}',\n` +
    `    (select jsonb_build_object('id', x.${f.ref!.pk}::text, 'name', x.${f.ref!.display})\n` +
    `       from ${f.ref!.table} x where x.${f.ref!.pk} = (v_norm->>'${f.normKey}')::bigint)`
  );

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
async function loadDocumentHeaderSchema(appRoot: string): Promise<TSchema> {
  const schemaPath = join(appRoot, "..", "client", "shared", "schema.ts");
  const mod = await importSchema(schemaPath);
  const schema = mod["DocumentHeaderSchema"];
  if (!schema) throw new Error(`${schemaPath}: немає DocumentHeaderSchema`);
  return schema;
}

// перший прохід: карта моделей для резолву x-ref
async function buildModelMap(appRoot: string, models: string[]): Promise<ModelMetaMap> {
  const map: ModelMetaMap = new Map();
  for (const modelPath of models) {
    const { model, path } = schemaModuleFor(appRoot, modelPath);
    try {
      await Deno.stat(path);
    } catch {
      continue;
    }
    const manifest = JSON.parse(
      await Deno.readTextFile(join(appRoot, modelPath, "manifest.json")),
    ) as FeatureManifest;
    const schemaName = manifest.schema ?? "app";
    const mod = await importSchema(path);
    const item = mod[`${pascalCase(model)}ItemSchema`];
    const props = item?.properties ?? {};
    let displayCol = "name";
    for (const [key, prop] of Object.entries(props)) {
      if (prop["x-lookup"] && isStringType(prop)) {
        displayCol = prop["x-db-col"] ?? camelToSnake(key);
        break;
      }
    }
    map.set(model, { schema: schemaName, model, pk: "id", displayCol });
  }
  return map;
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
  if (!itemSchema || !rowSchema || !lookupSchema) {
    throw new Error(
      `${model}: очікую ${Pascal}ItemSchema/${Pascal}RowSchema/${Pascal}LookupRowSchema`,
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

  // Аліас lookup-полів визначає походження ключа: шапка чи таблиця моделі.
  const lookupFields = parseObject(lookupSchema, schemaName, map, `${model}.lookup`).fields
    .map((f) => (isDocument && headerKeys.has(f.key) ? { ...f, alias: "h" } : f));

  const rowKeys = new Set(Object.keys(rowSchema.properties ?? {}));
  const listFields = itemFields.filter((f) =>
    rowKeys.has(f.key) || (f.ref && rowKeys.has(f.ref.as))
  );

  const filters = buildFilters(itemFields, model);

  // search (list): ref.searchable → display; скаляр з x-search → alias.col; фоллбек — усі строкові
  const searchExprsList: string[] = [];
  for (const f of itemFields) {
    if (f.ref?.searchable) searchExprsList.push(`${f.ref.alias}.${f.ref.display}`);
    else if (!f.ref && f.search) searchExprsList.push(`${f.alias}.${f.col}`);
  }
  if (searchExprsList.length === 0) {
    for (const f of itemFields) {
      if (f.isString && f.key !== "id") searchExprsList.push(`${f.alias}.${f.col}`);
    }
  }

  // search (lookup): лише скалярні поля шапки (без ref-joins)
  const searchExprsLookup: string[] = [];
  for (const f of itemFields) {
    if (!f.ref && f.search) searchExprsLookup.push(`${f.alias}.${f.col}`);
  }
  if (searchExprsLookup.length === 0) {
    for (const f of itemFields) {
      if (f.isString && f.key !== "id") searchExprsLookup.push(`${f.alias}.${f.col}`);
    }
  }

  // sort (list): токен = JSON-ключ (= ListColumn.key на фронті), вираз = alias.col
  const listSort: SortEntry[] = [];
  for (const f of listFields) {
    if (f.ref?.sortable) listSort.push({ token: f.ref.as, expr: `${f.ref.alias}.${f.ref.display}` });
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

  // 1) карта всіх моделей (для x-ref), 2) генерація
  const map = await buildModelMap(appRoot, allModels);
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
    if (manifestType && manifestType !== "catalog" && manifestType !== "document" && !isReport) {
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
