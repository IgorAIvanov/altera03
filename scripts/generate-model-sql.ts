// Детермінований генератор стандартних CRUD-SQL функцій моделі.
// Джерело правди — <model>.schema.ts (TypeBox) + manifest.json.
// Емітить db/_generated/<model>.crud.gen.sql зі стандартною п'ятіркою
// list/get/save/delete/lookup.
//
// Підтримує: плоский catalog, x-ref (ссылки), x-table (табличні частини).
// Деталі — docs/sql-codegen.md.
//
// Запуск:  deno run -A ./scripts/generate-model-sql.ts ./app [catalog/bank] --verbose

import { basename, join, resolve, toFileUrl } from "jsr:@std/path";

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
  "x-ref"?: XRef;
  "x-table"?: XTable;
};

type SqlManifest = { models?: string[] };
type DocumentMeta = { name?: string; shortName?: string; prefix?: string; sortOrder?: number };
type FeatureManifest = {
  model?: string;
  type?: string;
  schema?: string;
  document?: DocumentMeta;
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
  baseFilter: string; // "" або "not h.is_deleted"
  headerFields: Field[]; // поля app.document (лише для документа)
  itemFields: Field[]; // скалярні поля шапки
  tables: TableSpec[];
  listFields: Field[]; // поля шапки у списку (за Row)
  lookupFields: Field[];
  searchExprsList: string[];
  searchExprsLookup: string[];
  listSort: SortEntry[];
  lookupSort: SortEntry[];
  listJoins: string[];
  hasIsActive: boolean;
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
  };
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

// колонки об'єкта для набору полів: скаляр + (за наявності) вкладена ссылка
function fieldEntries(fields: Field[]): string[] {
  return fields.flatMap((f) => (f.ref ? [outExpr(f), refEntry(f)] : [outExpr(f)]));
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

/** where-умова: базовий фільтр моделі (для документа — не позначені на видалення). */
function baseAnd(spec: ModelSpec): string {
  return spec.baseFilter ? `${spec.baseFilter}\n    and ` : "";
}

// ── рендер функцій ─────────────────────────────────────────────────────────────

function renderList(spec: ModelSpec): string {
  const defaultSort = spec.listSort[0]?.token ?? spec.pk;
  const rowCols = fieldEntries(spec.listFields).map((e) => `      ${e}`).join(",\n");
  const joins = spec.listJoins.length ? "\n    " + spec.listJoins.join("\n    ") : "";
  const joinsCount = spec.listJoins.length ? "\n  " + spec.listJoins.join("\n  ") : "";
  const sortGuard = spec.listSort.length
    ? `  if v_sort_by not in (${whitelist(spec.listSort)}) then\n    v_sort_by := '${defaultSort}';\n  end if;\n\n`
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
  v_rows      jsonb;
  v_total     int;
begin
${sortGuard}  select count(*)::int into v_total
  from ${spec.fromClause}${joinsCount}
  where ${baseAnd(spec)}(
${searchClause(spec.searchExprsList, "    ")}
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
${rowCols}
    ) as r
    from ${spec.fromClause}${joins}
    where ${baseAnd(spec)}(
${searchClause(spec.searchExprsList, "      ")}
    )
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
  v_number  varchar(20);
  v_type_id bigint;
  v_result  jsonb;
begin
  if v_org is null then
    raise exception 'organizationId обов''язковий';
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
      v_number := app.doc_next_number('${spec.model}', v_org);
    else
      select h.number into v_number from app.document h where h.id = v_id;
    end if;
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
  const requiredFields = writable.filter((f) => f.required && f.isString);

  const checks = requiredFields
    .map((f) =>
      `  if nullif(trim(coalesce(v_item->>'${f.key}', '')), '') is null then\n` +
      `    raise exception '${f.key} обов''язковий';\n  end if;`
    ).join("\n");

  const headerSrc = spec.itemFields.map((f) => `      ${srcExpr(f, "v_item")} as ${f.col}`).join(",\n");
  const updateSetSql = [
    ...writable.map((f) => updateSet(f, "t")),
    `updated_at = now()`,
  ].join(",\n    ");
  const insertCols = writable.map((f) => f.col).join(", ");
  const insertVals = writable.map((f) => insertVal(f)).join(", ");

  const lineMerges = spec.tables.map((tbl) => `\n${renderLineMerge(tbl)}\n`).join("");

  const { object, joins } = itemObject(spec, "v_id");
  const joinSql = joins.length ? "\n  " + joins.join("\n  ") : "";

  return `drop function if exists ${spec.table}_save(bigint, jsonb);
create function ${spec.table}_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item   jsonb := payload->'item';
  v_id     bigint;
  v_result jsonb;
begin
${checks}

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
    spec.isDocument
      // Шапка володіє записом: рядки документа й проводки підуть каскадом.
      ? `delete from app.document where id = v_id;`
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

function renderLookup(spec: ModelSpec): string {
  const defaultSort = spec.lookupSort[0]?.token ?? spec.lookupFields[0]?.col ?? spec.pk;
  const cols = fieldEntries(spec.lookupFields).map((e) => `      ${e}`).join(",\n");
  const filter = spec.hasIsActive ? "t.is_active = true" : spec.baseFilter;
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

function renderFile(spec: ModelSpec): string {
  const header = `-- ⚠ ЗГЕНЕРОВАНО deno task sql:gen — НЕ РЕДАГУВАТИ.\n` +
    `-- Джерело: ${spec.model}.schema.ts + manifest.json. Override — db/${spec.model}.custom.sql\n`;
  return [
    header,
    renderList(spec),
    renderGet(spec),
    renderSave(spec),
    renderDelete(spec),
    renderLookup(spec),
    ...(spec.isDocument ? [renderPost(spec), renderUnpost(spec)] : []),
    "",
  ].join("\n\n");
}

// ── вилучення метаданих ─────────────────────────────────────────────────────────

function schemaModuleFor(appRoot: string, modelPath: string) {
  const model = basename(modelPath);
  return { model, path: join(appRoot, modelPath, `${model}.schema.ts`) };
}

async function importSchema(path: string): Promise<Record<string, TSchema>> {
  return await import(toFileUrl(resolve(path)).href);
}

/** Тип моделі з manifest.json (catalog | document | report | register). */
async function modelType(appRoot: string, modelPath: string): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(
      await Deno.readTextFile(join(appRoot, modelPath, "manifest.json")),
    ) as FeatureManifest;
    return manifest.type;
  } catch {
    return undefined;
  }
}

/** Спільна шапка документа — app/shared/schema.ts, єдина для всіх документів. */
async function loadDocumentHeaderSchema(appRoot: string): Promise<TSchema> {
  const mod = await importSchema(join(appRoot, "shared", "schema.ts"));
  const schema = mod["DocumentHeaderSchema"];
  if (!schema) throw new Error("app/shared/schema.ts: немає DocumentHeaderSchema");
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

  const hasIsActive = itemFields.some((f) => f.col === "is_active");

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
    baseFilter: isDocument ? "not h.is_deleted" : "",
    headerFields,
    itemFields,
    tables,
    listFields,
    lookupFields,
    searchExprsList,
    searchExprsLookup,
    listSort,
    lookupSort,
    listJoins,
    hasIsActive,
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
  let count = 0;
  for (const modelPath of models) {
    const { path } = schemaModuleFor(appRoot, modelPath);
    try {
      await Deno.stat(path);
    } catch {
      if (verbose) console.log(`· ${modelPath}: немає schema.ts — пропуск`);
      continue;
    }
    const manifestType = await modelType(appRoot, modelPath);
    if (manifestType && manifestType !== "catalog" && manifestType !== "document") {
      // Звіт не має CRUD: у нього одна команда вибірки, написана руками в
      // db/<model>.sql. Схема лишається — з неї живе форма параметрів.
      if (verbose) console.log(`· ${modelPath}: type=${manifestType} — генерація CRUD не потрібна`);
      continue;
    }
    const spec = await buildSpec(appRoot, modelPath, map, verbose);
    const outDir = join(appRoot, modelPath, "db", "_generated");
    await Deno.mkdir(outDir, { recursive: true });
    const outFile = join(outDir, `${spec.model}.crud.gen.sql`);
    await Deno.writeTextFile(outFile, renderFile(spec));
    console.log(`✓ ${modelPath} → ${outFile}`);
    count++;
  }

  console.log(`\nЗгенеровано моделей: ${count}`);
}

if (import.meta.main) {
  await main();
}
