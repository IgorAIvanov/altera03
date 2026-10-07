/**
 * Інтерпретатор правил: рядки джерела → payload-и цілі з маркерами посилань.
 *
 * Бази тут немає свідомо: на вході рядки й параметри сесії, на виході об'єкти
 * й звіт. Тому та сама функція працює і в сухому прогоні (команда `dryRun`), і в
 * рушії завантаження, і в тесті — розійтися їм нема де.
 *
 * ПРОКСІ. Функція правила (`calc`, `transform`) отримує не рядок, а його
 * проксі: читання неоголошеного реквізиту кидає помилку, а прочитане
 * записується. Звідси два висновки звіту — «прочитано поза `reads`» (помилка
 * правила) і «оголошено, але на вибірці жодного разу не прочитано»
 * (попередження: або реквізит зайвий у `reads`, або вибірка не зачепила гілку).
 */
import {
  type Expr,
  type FieldExpr,
  isSourceEnum,
  isSourceRef,
  isViaKey,
  type Join,
  type LookupMarker,
  type ResolvedLookupKey,
  readPath,
  refMarker,
  rootOf,
  type Rule,
  type RuleSetDefaults,
  type SourceRow,
  type Table,
  type TargetAccount,
  type TransformLib,
  type TransformOutput,
} from "./rule.ts";

export interface ConvertInput {
  /** Рядки запиту правила (`rule.query`). */
  rows: SourceRow[];
  /** Рядки приєднаних запитів — за ім'ям пункту плану. */
  joined?: Record<string, SourceRow[]>;
  /** Параметри сесії (`app.import_session.params`). */
  params?: Record<string, unknown>;
  /** Довідкові дані цілі — знімок, а не запит: план рахунків за кодом. */
  accounts?: Record<string, TargetAccount>;
  /** Умовчання набору: імена колонок табличної частини джерела. */
  defaults?: RuleSetDefaults;
}

export interface ConvertIssue {
  /** Ключ об'єкта або номер рядка, де вилізло. */
  at: string;
  message: string;
}

export interface SkippedRows {
  reason: string;
  count: number;
  /** Кілька подань для людини — не весь перелік. */
  sample: string[];
}

export interface ConvertResult {
  objects: TransformOutput[];
  /** Рядків усього / відкинуто умовою `when`. */
  rows: number;
  filtered: number;
  skipped: SkippedRows[];
  /**
   * Ключі об'єктів, які правило свідомо не переносить (`requires`), з причиною.
   * Рушію — щоб посилання на такий об'єкт назвати пропуском із причиною, а не
   * «немає в знімку».
   */
  skippedKeys: Record<string, string>;
  /** Перенесене, на що варто глянути: та сама форма, що й пропуски. */
  warnings: SkippedRows[];
  errors: ConvertIssue[];
  /** Реквізити, які справді прочитано (верхній рівень і `join.реквізит`). */
  read: string[];
  /** Оголошені в `reads` / `calc`, але на вибірці не прочитані жодного разу. */
  unread: string[];
}

class UndeclaredRead extends Error {}

const SAMPLE = 5;

/** Ключ для з'єднання й групування: посилання — за ключем, перелічення — за ім'ям. */
function joinKey(value: unknown): string {
  if (isSourceRef(value)) return value.ref;
  if (isSourceEnum(value)) return value.enum;
  return value === null || value === undefined ? "" : String(value);
}

/** Значення для `when`: посилання й перелічення порівнюються за поданням. */
function comparable(value: unknown): unknown {
  if (isSourceRef(value) || isSourceEnum(value)) return value.presentation;
  return value ?? null;
}

function num(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(parsed)) throw new Error(`@[core.conversion.notNumber]${JSON.stringify({ value: String(value) })}`);
  return parsed;
}

/**
 * Сирий рядок під проксі. Звіт (подання рядка в пропусках і попередженнях) —
 * не читання правила: йому не можна ні падати на неоголошеному, ні записувати
 * прочитане.
 */
const RAW = Symbol("raw");

/**
 * Подання рядка для людини: спершу посилання й перелічення (їхні подання
 * людина впізнає — організація, рахунок, контрагент), рядки — лише добрати.
 * Порядок ключів сировини тут не спирається ні на що: jsonb сортує їх за
 * довжиною, і `amountCr` у ньому раніше за `organization`.
 */
function describe(row: SourceRow): string {
  const raw = (row as Record<symbol, unknown>)[RAW] as SourceRow | undefined ?? row;
  const values = Object.values(raw);
  const parts = values
    .filter((value) => isSourceRef(value) || isSourceEnum(value))
    .map((value) => (value as { presentation: string }).presentation)
    .slice(0, 3);
  for (const value of values) {
    if (parts.length >= 3) break;
    if (typeof value === "string" && value !== "") parts.push(value);
  }
  return parts.join(" · ");
}

/**
 * Проксі рядка: пускає лише `allowed` (повні шляхи, «X» або «join.X») і
 * записує прочитане в `seen`.
 */
function guard(row: SourceRow, allowed: Set<string>, seen: Set<string>, prefix = ""): SourceRow {
  return new Proxy(row, {
    get(target, key, receiver) {
      if (key === RAW) return target;
      if (typeof key !== "string") return Reflect.get(target, key, receiver);
      const path = prefix ? `${prefix}.${key}` : key;
      const value = Reflect.get(target, key, receiver);
      // Приєднаний рядок — теж проксі: дозволені в ньому лише «alias.X». Пари
      // `join` не знайшов — під псевдонімом `null`, і прочитати його законно.
      if (!prefix && [...allowed].some((item) => item.startsWith(`${key}.`))) {
        return value && typeof value === "object" ? guard(value as SourceRow, allowed, seen, key) : value;
      }
      if (!allowed.has(path)) {
        throw new UndeclaredRead(`@[core.conversion.undeclaredRead]${JSON.stringify({ path })}`);
      }
      seen.add(path);
      return value;
    },
    ownKeys() {
      // Перебір рядка теж читання — віддаємо лише дозволене.
      // Без повторів: кілька полів одного `join` («a.x», «a.y») дають корінь «a»
      // двічі, а пастка з повторами — TypeError самого рушія JS.
      const keys = prefix
        ? [...allowed].filter((item) => item.startsWith(`${prefix}.`)).map((item) => item.slice(prefix.length + 1))
        : [...allowed].map(rootOf);
      return [...new Set(keys)];
    },
  });
}

/** Ключ з'єднання за одним реквізитом або кількома (складений). */
function keyPaths(paths: string | readonly string[]): readonly string[] {
  return typeof paths === "string" ? [paths] : paths;
}

function compositeKey(row: SourceRow, paths: string | readonly string[]): string {
  return keyPaths(paths).map((path) => joinKey(readPath(row, path))).join("|");
}

/** Приєднати рядки `join` під їхніми псевдонімами; немає пари — `null`. */
function withJoins(row: SourceRow, joins: Record<string, Join>, index: Map<string, Map<string, SourceRow>>): SourceRow {
  const result: SourceRow = { ...row };
  for (const [alias, join] of Object.entries(joins)) {
    result[alias] = index.get(alias)?.get(compositeKey(row, join.on)) ?? null;
  }
  return result;
}

function buildJoinIndex(
  joins: Record<string, Join>,
  joined: Record<string, SourceRow[]>,
  errors: ConvertIssue[],
): Map<string, Map<string, SourceRow>> {
  const index = new Map<string, Map<string, SourceRow>>();
  for (const [alias, join] of Object.entries(joins)) {
    const byKey = new Map<string, SourceRow>();
    const rows = joined[join.query];
    if (!rows) {
      errors.push({ at: `join:${alias}`, message: `@[core.conversion.noQueryRows]${JSON.stringify({ query: join.query })}` });
    }
    for (const row of rows ?? []) {
      const key = compositeKey(row, join.by ?? join.on);
      // Декларативний join — «один до одного». Дубль ключа означає, що запит
      // віддає не зріз, а історію: правило мусило б вибирати, а вибір — не join.
      if (byKey.has(key)) {
        errors.push({
          at: `join:${alias}`,
          message: `@[core.conversion.joinDuplicateKey]${JSON.stringify({ key, query: join.query })}`,
        });
        continue;
      }
      byKey.set(key, row);
    }
    index.set(alias, byKey);
  }
  return index;
}

function evaluate(
  expr: FieldExpr,
  row: SourceRow,
  seen: Set<string>,
  accounts?: Record<string, TargetAccount>,
  line?: number,
): unknown {
  const e: Expr = typeof expr === "string" ? { op: "field", path: expr } : expr;
  switch (e.op) {
    case "const":
      return e.value;
    case "line":
      if (line === undefined) throw new Error("@[core.conversion.lineNumberOutsideTable]");
      return line;
    case "seeded":
      return { $seed: { model: e.model, where: { ...e.where } } };
    case "lookup": {
      // Значення читаються ТУТ, а шукає рушій: бази інтерпретатор не бачить.
      // Ключ із порожнім полем пропускається — порожній ЄДРПОУ не мусить
      // зводити всіх, у кого його немає. Не лишилося жодного — маркер однаково
      // їде: «шукати нічим» для рушія той самий ісход, що «не знайдено».
      const scalar = (path: string): string | null => {
        seen.add(path);
        const value = readPath(row, path);
        if (value === null || value === undefined) return null;
        if (typeof value === "object") throw new Error(`@[core.conversion.lookupNotScalar]${JSON.stringify({ path })}`);
        const text = String(value).trim();
        return text === "" ? null : text;
      };
      const keys: ResolvedLookupKey[] = [];
      for (const key of e.keys) {
        // Усі поля ВСІХ ключів читаються, навіть коли перший уже знайшов би:
        // шукає рушій, і покриття інакше казало б «оголошено й не прочитано».
        const where = Object.entries(isViaKey(key) ? key.where : key).map(([field, path]) => [field, scalar(path)] as const);
        if (where.some(([, value]) => value === null)) continue;
        const filled = Object.fromEntries(where) as Record<string, string>;
        keys.push(isViaKey(key) ? { via: key.via, where: filled, pick: key.pick } : { where: filled });
      }
      const first = keys[0];
      const marker: LookupMarker = {
        $lookup: { model: e.model, keys, label: first ? Object.values(first.where).join(" · ") : "" },
      };
      if (e.orEmpty) marker.$lookup.orEmpty = e.orEmpty;
      return marker;
    }
    case "field": {
      seen.add(e.path);
      const value = readPath(row, e.path);
      return value === undefined ? null : value;
    }
    case "ref": {
      seen.add(e.path);
      const value = readPath(row, e.path);
      if (e.type && !(isSourceRef(value) && value.type === e.type)) return null;
      if (e.unlessSame) {
        seen.add(e.unlessSame);
        const other = readPath(row, e.unlessSame);
        if (isSourceRef(value) && isSourceRef(other) && value.ref === other.ref) return null;
      }
      const marker = refMarker(value);
      return marker && e.orEmpty ? { ...marker, $orEmpty: e.orEmpty } : marker;
    }
    case "text": {
      seen.add(e.path);
      const value = readPath(row, e.path);
      const trimmed = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
      return trimmed === "" ? undefined : trimmed;
    }
    case "date": {
      seen.add(e.path);
      const value = readPath(row, e.path);
      if (typeof value !== "string" || value === "" || value.startsWith("0001-01-01")) return null;
      return value.slice(0, 10);
    }
    case "number": {
      seen.add(e.path);
      const value = readPath(row, e.path);
      return value === null || value === undefined || value === "" ? null : num(value);
    }
    case "enum": {
      seen.add(e.path);
      const value = readPath(row, e.path);
      if (value === null || value === undefined) {
        if (e.hasFallback) return e.fallback;
        throw new Error(`@[core.conversion.enumEmpty]${JSON.stringify({ path: e.path })}`);
      }
      const name = isSourceEnum(value) ? value.enum : String(value);
      if (!(name in e.map)) {
        throw new Error(`@[core.conversion.enumUnmapped]${JSON.stringify({ value: name, path: e.path })}`);
      }
      return e.map[name];
    }
    case "analytics": {
      seen.add(e.account);
      for (const path of e.subconto) seen.add(path);
      const account = readPath(row, e.account);
      const code = isSourceRef(account) ? account.presentation.trim() : "";
      if (!code) return {};
      if (!accounts) throw new Error("@[core.conversion.noAccountsSnapshot]");
      const target = accounts[code];
      if (!target) throw new Error(`@[core.conversion.accountNotInPlan]${JSON.stringify({ code })}`);
      const own = new Set(target.dimensions);
      const result: Record<string, unknown> = {};
      for (const path of e.subconto) {
        const value = readPath(row, path);
        if (!isSourceRef(value)) continue;
        const dimension = e.byType[value.type];
        if (dimension && own.has(dimension)) result[dimension] = refMarker(value);
      }
      return result;
    }
    case "calc": {
      for (const input of e.inputs) seen.add(input);
      const values = e.inputs.map((input) => {
        const value = readPath(row, input);
        return value === undefined ? null : value;
      });
      return e.fn(...values);
    }
  }
}

/** Реквізити, які читає вираз поля. */
function exprReads(expr: FieldExpr): string[] {
  if (typeof expr === "string") return [expr];
  switch (expr.op) {
    case "const":
    case "seeded":
    case "line":
      return [];
    case "lookup":
      return expr.keys.flatMap((key) => Object.values(isViaKey(key) ? key.where : key));
    case "calc":
      return expr.inputs;
    case "analytics":
      return [expr.account, ...expr.subconto];
    case "ref":
      return expr.unlessSame ? [expr.path, expr.unlessSame] : [expr.path];
    default:
      return [expr.path];
  }
}

/**
 * Колонки рядка частини: посилання на власника й порядок — з правила, інакше з
 * умовчань набору. Власника не назвав ніхто — `by` порожній, і це помилка
 * частини (`buildTableIndex`); порядку не назвав ніхто — рядки йдуть так, як
 * їх віддав запит.
 */
function tableColumns(table: Table, defaults: RuleSetDefaults): { by?: string; order?: string } {
  return { by: table.by ?? defaults.tableOwner, order: table.order ?? defaults.tableOrder };
}

/** Реквізити рядка частини, які вона оголосила: зв'язок, порядок і поля. */
function tableReads(table: Table, defaults: RuleSetDefaults): string[] {
  const { by, order } = tableColumns(table, defaults);
  const reads = new Set<string>([by, order].filter((path): path is string => !!path));
  for (const expr of Object.values(table.fields)) for (const path of exprReads(expr)) reads.add(path);
  return [...reads];
}

/** Рядки частини за ключем власника, уже впорядковані. */
function buildTableIndex(
  tables: Record<string, Table>,
  joined: Record<string, SourceRow[]>,
  defaults: RuleSetDefaults,
  errors: ConvertIssue[],
): Map<string, Map<string, SourceRow[]>> {
  const index = new Map<string, Map<string, SourceRow[]>>();
  for (const [field, table] of Object.entries(tables)) {
    const byOwner = new Map<string, SourceRow[]>();
    const { by, order } = tableColumns(table, defaults);
    if (!by) {
      errors.push({ at: `table:${field}`, message: `@[core.conversion.tableOwnerUndeclared]${JSON.stringify({ field })}` });
      index.set(field, byOwner);
      continue;
    }
    const rows = joined[table.query];
    if (!rows) {
      errors.push({ at: `table:${field}`, message: `@[core.conversion.noQueryRows]${JSON.stringify({ query: table.query })}` });
    }
    for (const row of rows ?? []) {
      const owner = joinKey(readPath(row, by));
      const list = byOwner.get(owner) ?? [];
      list.push(row);
      byOwner.set(owner, list);
    }
    if (order) {
      for (const list of byOwner.values()) list.sort((a, b) => num(readPath(a, order)) - num(readPath(b, order)));
    }
    index.set(field, byOwner);
  }
  return index;
}

/** Реквізити, які правило оголосило: поля, `calc`, `when`, ключ, `reads`. */
export function declaredReads(rule: Rule, defaults: RuleSetDefaults = {}): string[] {
  const reads = new Set<string>();
  if (rule.transform) {
    for (const path of rule.transform.reads) reads.add(path);
    for (const path of rule.transform.groupBy ?? []) reads.add(path);
  } else {
    for (const path of keyPaths(rule.key)) reads.add(path);
    for (const expr of Object.values(rule.fields) as FieldExpr[]) {
      for (const path of exprReads(expr)) reads.add(path);
    }
    for (const table of Object.values(rule.tables ?? {}) as Table[]) {
      for (const path of tableReads(table, defaults)) reads.add(`${table.section}.${path}`);
    }
  }
  for (const path of Object.keys(rule.when ?? {})) reads.add(path);
  return [...reads];
}

export function convert(rule: Rule, input: ConvertInput): ConvertResult {
  const errors: ConvertIssue[] = [];
  const skipped = new Map<string, SkippedRows>();
  const skippedKeys: Record<string, string> = {};
  const seen = new Set<string>();
  const objects: TransformOutput[] = [];
  const params = Object.freeze({ ...(input.params ?? {}) });

  const joins = rule.join ?? {};
  const index = buildJoinIndex(joins, input.joined ?? {}, errors);
  const tables = (rule.transform ? {} : rule.tables ?? {}) as Record<string, Table>;
  const defaults = input.defaults ?? {};
  const tableIndex = buildTableIndex(tables, input.joined ?? {}, defaults, errors);

  // Умова `when` — частина декларації, тож відбір за нею не пропуск, а межа
  // правила: рядки поза нею належать іншому правилу того самого джерела.
  const when = Object.entries(rule.when ?? {});
  const rows = input.rows
    .filter((row) => when.every(([path, value]) => comparable(readPath(row, path)) === value))
    .map((row) => withJoins(row, joins, index));
  for (const [path] of when) seen.add(path);

  const warned = new Map<string, SkippedRows>();
  const note = (into: Map<string, SkippedRows>) => (row: SourceRow, reason: string) => {
    const entry = into.get(reason) ?? { reason, count: 0, sample: [] };
    entry.count++;
    if (entry.sample.length < SAMPLE) entry.sample.push(describe(row));
    into.set(reason, entry);
  };
  const skip = note(skipped);
  const warn = note(warned);

  if (rule.transform) {
    const allowed = new Set(declaredReads(rule, defaults));
    const accounts = input.accounts ?? {};
    const lib: TransformLib = { ref: refMarker, num, params, skip, warn, account: (code) => accounts[code] ?? null };
    const groups = new Map<string, SourceRow[]>();
    for (const row of rows) {
      const key = (rule.transform.groupBy ?? []).map((path) => joinKey(readPath(row, path))).join("|");
      const group = groups.get(key) ?? [];
      group.push(guard(row, allowed, seen));
      groups.set(key, group);
    }
    for (const [key, group] of groups) {
      try {
        objects.push(...rule.transform.fn(group, lib));
      } catch (error) {
        errors.push({ at: key || "—", message: error instanceof Error ? error.message : String(error) });
      }
    }
  } else {
    const keys = new Set<string>();
    rows.forEach((row, i) => {
      const key = compositeKey(row, rule.key);
      const at = key || `#${i + 1}`;
      if (!key) {
        errors.push({ at, message: `@[core.conversion.emptyKey]${JSON.stringify({ key: keyPaths(rule.key).join(" + ") })}` });
        return;
      }
      if (keys.has(key)) {
        errors.push({ at, message: "@[core.conversion.duplicateKey]" });
        return;
      }
      keys.add(key);
      for (const path of keyPaths(rule.key)) seen.add(path);
      const payload: Record<string, unknown> = {};
      try {
        for (const [field, expr] of Object.entries(rule.fields) as [string, FieldExpr][]) {
          payload[field] = evaluate(expr, row, seen, input.accounts);
        }
        for (const [field, table] of Object.entries(tables)) {
          const lines = tableIndex.get(field)?.get(key) ?? [];
          const lineSeen = new Set<string>();
          payload[field] = lines.map((line, index) => {
            const out: Record<string, unknown> = {};
            for (const [lineField, expr] of Object.entries(table.fields)) {
              out[lineField] = evaluate(expr, line, lineSeen, input.accounts, index + 1);
            }
            return out;
          });
          if (lines.length) {
            const { by, order } = tableColumns(table, defaults);
            if (by) lineSeen.add(by);
            if (order) lineSeen.add(order);
          }
          for (const path of lineSeen) seen.add(`${table.section}.${path}`);
        }
        const missing = Object.entries(rule.requires ?? {})
          .find(([field]) => payload[field] === undefined || payload[field] === null || payload[field] === "");
        if (missing) {
          skip(row, missing[1] as string);
          skippedKeys[key] = missing[1] as string;
          return;
        }
        objects.push({ key, payload });
      } catch (error) {
        errors.push({ at, message: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  const declared = declaredReads(rule, defaults);
  return {
    objects,
    rows: input.rows.length,
    filtered: input.rows.length - rows.length,
    skipped: [...skipped.values()],
    skippedKeys,
    warnings: [...warned.values()],
    errors,
    read: [...seen].sort(),
    unread: rows.length ? declared.filter((path) => !seen.has(path)).sort() : [],
  };
}
