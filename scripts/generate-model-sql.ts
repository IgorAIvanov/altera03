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
type FeatureManifest = { model?: string; type?: string; schema?: string };

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
  isString: boolean;
  isBool: boolean;
  isBigint: boolean;
  isInt: boolean;
  isNumeric: boolean;
  isDate: boolean;
  isTimestamp: boolean;
  required: boolean; // для save (у required[] і не id)
  search: boolean;
  sortable: boolean;
  boolDefaultSql: string;
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
): Field {
  const col = prop["x-db-col"] ?? camelToSnake(key);
  const dbType = prop["x-db-type"];
  const isBigint = dbType === "bigint";
  const isInt = dbType === "int" || dbType === "integer";
  const isNumeric = dbType === "numeric";
  const isDate = dbType === "date";
  const isTimestamp = dbType === "timestamptz";
  const isBool = prop.type === "boolean";
  const isString = !isBigint && !isInt && !isNumeric && !isDate && !isTimestamp && !isBool &&
    isStringType(prop);

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
    isString,
    isBool,
    isBigint,
    isInt,
    isNumeric,
    isDate,
    isTimestamp,
    required: requiredKeys.has(key) && key !== "id",
    search: prop["x-search"] === true,
    sortable: prop["x-list"]?.sortable === true,
    boolDefaultSql: prop.default === false ? "false" : "true",
    ref,
  };
}

// розбір об'єктної схеми на скалярні поля + табличні частини
function parseObject(
  schema: TSchema,
  parentSchema: string,
  map: ModelMetaMap,
  owner: string,
): { fields: Field[]; tables: TableSpec[] } {
  const props = schema.properties ?? {};
  const requiredKeys = new Set(schema.required ?? []);
  const fields: Field[] = [];
  const tables: TableSpec[] = [];

  for (const [key, prop] of Object.entries(props)) {
    if (prop.type === "array" && prop["x-table"]) {
      const xt = prop["x-table"];
      const line = parseObject(prop.items ?? {}, parentSchema, map, `${owner}.${key}`);
      tables.push({
        key,
        schema: parentSchema,
        table: xt.table,
        parentFk: xt.parentFk,
        orderBy: xt.orderBy ?? "id",
        fields: line.fields,
      });
    } else {
      fields.push(toField(key, prop, requiredKeys, map, owner));
    }
  }
  return { fields, tables };
}

// ── SQL-вирази ────────────────────────────────────────────────────────────────

// вивід скалярної колонки: 'jsonKey', alias.col[::text]
function outExpr(alias: string, f: Field): string {
  const ref = `${alias}.${f.col}`;
  return `'${f.key}', ${f.isBigint ? `${ref}::text` : ref}`;
}

// вивід вкладеного об'єкта ссылки
function refEntry(f: Field): string {
  const r = f.ref!;
  return `'${r.as}', case when ${r.alias}.${r.targetPk} is null then null ` +
    `else jsonb_build_object('id', ${r.alias}.${r.targetPk}::text, '${r.display}', ${r.alias}.${r.display}) end`;
}

// колонки об'єкта для набору полів: скаляр + (за наявності) вкладена ссылка
function fieldEntries(fields: Field[], alias: string): string[] {
  return fields.flatMap((f) => (f.ref ? [outExpr(alias, f), refEntry(f)] : [outExpr(alias, f)]));
}

function refJoins(fields: Field[], baseAlias: string): string[] {
  const seen = new Set<string>();
  const joins: string[] = [];
  for (const f of fields) {
    if (!f.ref || seen.has(f.ref.alias)) continue;
    seen.add(f.ref.alias);
    const r = f.ref;
    joins.push(
      `left join ${r.targetSchema}.${r.targetTable} ${r.alias} on ${r.alias}.${r.targetPk} = ${baseAlias}.${r.fkCol}`,
    );
  }
  return joins;
}

// extract+cast значення поля з jsonb-виразу jsonVar
function srcExpr(f: Field, jsonVar: string): string {
  const g = `${jsonVar}->>'${f.key}'`;
  if (f.isBigint) return `nullif(${g}, '')::bigint`;
  if (f.isInt) return `nullif(${g}, '')::int`;
  if (f.isNumeric) return `nullif(${g}, '')::numeric`;
  if (f.isDate) return `nullif(${g}, '')::date`;
  if (f.isTimestamp) return `nullif(${g}, '')::timestamptz`;
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
  const cols = fieldEntries(tbl.fields, "l").map((e) => `          ${e}`).join(",\n");
  const joins = refJoins(tbl.fields, "l").map((j) => `        ${j}`).join("\n");
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
    ...fieldEntries(spec.itemFields, "t"),
    ...spec.tables.map((tbl) => `'${tbl.key}', ${tableAgg(tbl, parentExpr)}`),
  ];
  return {
    object: `jsonb_build_object(\n${entries.map((e) => `        ${e}`).join(",\n")}\n      )`,
    joins: refJoins(spec.itemFields, "t"),
  };
}

// ── рендер функцій ─────────────────────────────────────────────────────────────

function renderList(spec: ModelSpec): string {
  const defaultSort = spec.listSort[0]?.token ?? spec.pk;
  const rowCols = fieldEntries(spec.listFields, "t").map((e) => `      ${e}`).join(",\n");
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
  from ${spec.table} t${joinsCount}
  where (
${searchClause(spec.searchExprsList, "    ")}
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
${rowCols}
    ) as r
    from ${spec.table} t${joins}
    where (
${searchClause(spec.searchExprsList, "      ")}
    )
    order by
${orderLadder(spec.listSort, "      ", `t.${spec.pk}`)}
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
  const { object, joins } = itemObject(spec, "t.id");
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
          from ${spec.table} t${joinSql}
          where t.${spec.pk} = (payload->>'id')::bigint
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
  const updateSet = writable
    .map((f) => (f.isBool ? `${f.col} = coalesce(s.${f.col}, lt.${f.col})` : `${f.col} = s.${f.col}`))
    .join(",\n    ");
  const insCols = [tbl.parentFk, ...writable.map((f) => f.col)].join(", ");
  const insVals = [
    "v_id",
    ...writable.map((f) => (f.isBool ? `coalesce(s.${f.col}, ${f.boolDefaultSql})` : `s.${f.col}`)),
  ].join(", ");
  return `  merge into ${tbl.schema}.${tbl.table} lt
  using (
    select
${src}
    from jsonb_array_elements(coalesce(v_item->'${tbl.key}', '[]'::jsonb)) e
  ) s
    on lt.id = s.id
  when matched then update set
    ${updateSet}
  when not matched then insert (${insCols})
    values (${insVals})
  when not matched by source and lt.${tbl.parentFk} = v_id then delete;`;
}

function renderSave(spec: ModelSpec): string {
  const writable = spec.itemFields.filter((f) => f.key !== "id");
  const requiredFields = writable.filter((f) => f.required && f.isString);

  const checks = requiredFields
    .map((f) =>
      `  if nullif(trim(coalesce(v_item->>'${f.key}', '')), '') is null then\n` +
      `    raise exception '${f.key} обов''язковий';\n  end if;`
    ).join("\n");

  const headerSrc = spec.itemFields.map((f) => `      ${srcExpr(f, "v_item")} as ${f.col}`).join(",\n");
  const updateSet = [
    ...writable.map((f) =>
      f.isBool ? `${f.col} = coalesce(s.${f.col}, t.${f.col})` : `${f.col} = s.${f.col}`
    ),
    `updated_at = now()`,
  ].join(",\n    ");
  const insertCols = writable.map((f) => f.col).join(", ");
  const insertVals = writable
    .map((f) => (f.isBool ? `coalesce(s.${f.col}, ${f.boolDefaultSql})` : `s.${f.col}`))
    .join(", ");

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
    ${updateSet}
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

  delete from ${spec.table} where ${spec.pk} = v_id;

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
  const cols = fieldEntries(spec.lookupFields, "t").map((e) => `      ${e}`).join(",\n");
  const activeFilter = spec.hasIsActive ? `t.is_active = true\n      and ` : "";
  const activeFilterCount = spec.hasIsActive ? `t.is_active = true\n    and ` : "";
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
  from ${spec.table} t
  where ${activeFilterCount}(
${searchClause(spec.searchExprsLookup, "    ")}
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
${cols}
    ) as r
    from ${spec.table} t
    where ${activeFilter}(
${searchClause(spec.searchExprsLookup, "      ")}
    )
    order by
${orderLadder(spec.lookupSort, "      ", `t.${spec.pk}`)}
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

  const { fields: itemFields, tables } = parseObject(itemSchema, schemaName, map, model);
  const lookupFields = parseObject(lookupSchema, schemaName, map, `${model}.lookup`).fields;

  const rowKeys = new Set(Object.keys(rowSchema.properties ?? {}));
  const listFields = itemFields.filter((f) =>
    rowKeys.has(f.key) || (f.ref && rowKeys.has(f.ref.as))
  );

  // search (list): ref.searchable → display; скаляр з x-search → t.col; фоллбек — усі строкові
  const searchExprsList: string[] = [];
  for (const f of itemFields) {
    if (f.ref?.searchable) searchExprsList.push(`${f.ref.alias}.${f.ref.display}`);
    else if (!f.ref && f.search) searchExprsList.push(`t.${f.col}`);
  }
  if (searchExprsList.length === 0) {
    for (const f of itemFields) {
      if (f.isString && f.key !== "id") searchExprsList.push(`t.${f.col}`);
    }
  }

  // search (lookup): лише скалярні поля шапки (без ref-joins)
  const searchExprsLookup: string[] = [];
  for (const f of itemFields) {
    if (!f.ref && f.search) searchExprsLookup.push(`t.${f.col}`);
  }
  if (searchExprsLookup.length === 0) {
    for (const f of itemFields) {
      if (f.isString && f.key !== "id") searchExprsLookup.push(`t.${f.col}`);
    }
  }

  // sort (list): токен = JSON-ключ (= ListColumn.key на фронті), вираз = t.col
  const listSort: SortEntry[] = [];
  for (const f of listFields) {
    if (f.ref?.sortable) listSort.push({ token: f.ref.as, expr: `${f.ref.alias}.${f.ref.display}` });
    else if (!f.ref && f.sortable) listSort.push({ token: f.key, expr: `t.${f.col}` });
  }

  // sort (lookup): скалярні sortable у складі lookup-полів
  const lookupKeys = new Set(lookupFields.map((f) => f.key));
  const lookupSort: SortEntry[] = itemFields
    .filter((f) => !f.ref && f.sortable && lookupKeys.has(f.key))
    .map((f) => ({ token: f.key, expr: `t.${f.col}` }));

  // joins для list: ref-поля, які потрібні у виводі/пошуку/сортуванні
  const listRefFields = itemFields.filter((f) =>
    f.ref && (f.ref.searchable || f.ref.sortable || rowKeys.has(f.ref.as))
  );
  const listJoins = refJoins(listRefFields, "t");

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
    pk: "id",
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
