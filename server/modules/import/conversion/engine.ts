/**
 * Рушій завантаження: payload-и правил → наші моделі, з картою ключів.
 *
 * Написаний у застосунку (перенесення з BAS) поруч з інтерпретатором і
 * піднятий сюди перенесенням коду після завершеної міграції — слів джерела в
 * ньому немає. Таблиці — ядра: `app.source_ref` (карта) і
 * `app.source_decision` (рішення людини).
 *
 * ЩО РОБИТЬ, по черзі:
 *
 *   1. ПЕРЕЗАЛИВКА (`mode: "replace"`, умовчання). Документи, які завело минуле
 *      завантаження з цього джерела (карта, `method = new`), зносяться колами —
 *      вони посилаються один на одного, і порядок наперед не вгадати.
 *      Довідники не зносяться: на них уже можуть посилатися живі документи.
 *      Режим `append` не зносить нічого — див. `LoadInput.mode`.
 *   2. ПРОХОДИ. Кожен об'єкт: рішення людини → карта → ключ (`rule.match`) →
 *      новий запис. Посилання, що чекає на ще не записаний об'єкт, відкладає
 *      об'єкт до наступного проходу; цикл іде, поки число записаних росте.
 *      Топологічного сортування немає: ієрархія розв'язується сама.
 *   3. ЦИКЛИ. Коли прохід не зрушив нічого, об'єкт, у якого нерозв'язані лише
 *      НЕОБОВ'ЯЗКОВІ поля верхнього рівня (у контрагента «основний договір», а
 *      договір посилається на контрагента), пишеться без них і дозаповнюється
 *      наприкінці. Обов'язкове поле в циклі — чесна помилка.
 *   4. ПРОВЕДЕННЯ — окремою фазою, строго за часом документа: наше проведення
 *      читає залишки на момент, і порядок розв'язання посилань тут хибний.
 *      Час — `docDate` з годиною, як у джерелі; документи однієї секунди — у
 *      порядку, в якому їх віддав запит (запит документів упорядковує їх
 *      моментом часу). Проводиться лише те, що проведене в джерелі
 *      (`isPosted` правила): непроведений там документ і в нас лягає
 *      непроведеним.
 *
 * ПРОГОНІВ ДВА (`stage`). «Залишки» — довідники, регістри й введення залишків
 * на D; «документи» — документи, введені в джерелі після D (`rule.stage`).
 * Правила іншого прогону не виконуються, але їхні типи посилань рушій знає:
 * документ після D посилається на контрагента, записаного прогоном залишків,
 * і знаходить його в карті. Документи після D проведені від залишків, тож
 * перезаливка залишків зносить і їх — інакше лишилися б проводки, пораховані
 * від старого сальдо.
 *
 * ЗАПИС — лише командами моделей (`_save`, `_post`), кожен об'єкт у своїй
 * точці збереження: помилка одного не ламає транзакцію, а йде в журнал. Журнал
 * — у результаті команди; довге завдання кладе його в `app.job.result` поза
 * нашою транзакцією, тож відкат переліку не забирає.
 *
 * ЗНАЙДЕНЕ ЗА КЛЮЧЕМ — ЛИШЕ ЗВ'ЯЗОК (рішення 26.09.2026). Сід і заведене
 * людиною перенесення не переписує; оновлює лише те, що завело само
 * (`method = new`), — повторний прогін підтягує в них правки джерела.
 *
 * Межу транзакції обирає той, хто кличе: рушій працює в тому з'єднанні, яке
 * йому дали.
 *
 * ПОВІДОМЛЕННЯ — маркери `@[core.conversion.*]`, розгортає їх клієнт. Причина,
 * що прийшла ззовні (відмова команди моделі чи бази, причина правила чи
 * рішення людини), не вкладається в маркер підстановкою, а їде поруч — полем
 * `cause`: вона сама буває маркером, а маркер усередині параметра клієнт не
 * розгортає, і розгортати не мусить (назва контрагента «@[…]» стала б ключем).
 */
import {
  isLookupMarker,
  isRefMarker,
  isSeedMarker,
  type LookupMarker,
  type RefMarker,
  type Rule,
  type RuleSetDefaults,
  type SeedMarker,
  type SourceRow,
  type TargetAccount,
} from "./rule.ts";
import { convert, type SkippedRows } from "./convert.ts";

// ── Контракт з тим, хто кличе ───────────────────────────────────────────────

/**
 * З'єднання, у якому працює рушій: тегований запит, сирий запит і точка
 * збереження. Це підмножина `TransactionSql` postgres.js — типом із драйвера
 * рушій не прив'язується, бо в ядро він піде без цього застосунку.
 */
export interface EngineSql {
  // deno-lint-ignore no-explicit-any
  <T = any[]>(strings: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
  // deno-lint-ignore no-explicit-any
  unsafe<T = any[]>(query: string, params?: unknown[]): PromiseLike<T>;
  savepoint<T>(fn: (sql: EngineSql) => Promise<T>): Promise<T>;
}

/** Що рушій знає про модель цілі: тип і ім'я SQL-функції команди. */
export interface TargetModel {
  type: string;
  /**
   * Команда моделі → ім'я функції без схеми (`groupSave` →
   * `counterparty_group_save`) або налаштування з ним, як у реєстрі ядра.
   */
  sqlCommands?: Record<string, string | { functionName?: string }>;
}

export interface LoadInput {
  /** Джерело сесії (`app.import_session.source`) — перший стовпчик ключа карти. */
  source: string;
  userId: string;
  params: Record<string, unknown>;
  /** Правила набору за іменем. */
  rules: Record<string, Rule>;
  /** Рядки запиту сесії; партії немає — `null`. */
  rows(query: string): Promise<SourceRow[] | null>;
  accounts: Record<string, TargetAccount>;
  /** Модель цілі за іменем; невідома — `undefined`. */
  model(entity: string): TargetModel | undefined;
  /**
   * Прогін: «залишки» (умовчання) чи «документи» після D. Виконуються лише
   * правила свого прогону (`rule.stage`).
   */
  stage?: "base" | "documents";
  /**
   * Що робити з уже завантаженим із цього джерела.
   *
   *   - `replace` (умовчання) — документи минулого завантаження зносяться й
   *     заводяться наново, записане перенесенням оновлюється. Для одноразового
   *     переносу з іншої програми це правильно: джерело — істина, ітерацій
   *     п'ять-десять.
   *   - `append` — лише нове: об'єкт, уже присутній у карті, не чіпається
   *     зовсім, нічого не зноситься. Для джерела, що вантажиться щодня роками
   *     (виписка банку): документ, заведений учора, людина вже доповнила й
   *     провела, і перезаливка знищила б саме її роботу.
   *
   * Тобто перезаливка — властивість прогону, а не рушія і не джерела.
   */
  mode?: "replace" | "append";
  /** Умовчання набору правил (колонки табличної частини джерела). */
  defaults?: RuleSetDefaults;
  /** Між проходами: чи просили зупинитися. */
  cancelled?(): Promise<boolean>;
  progress?(value: Record<string, unknown>): Promise<void>;
}

/** Що сталося з одним об'єктом. */
type Outcome = "created" | "updated" | "linked" | "kept" | "skipped" | "failed";

export interface RuleSummary {
  rule: string;
  entity: string;
  /** Партії запиту в сесії немає — правило не проганялося. */
  noData?: boolean;
  objects: number;
  created: number;
  updated: number;
  linked: number;
  /** Режим `append`: об'єкт уже в карті — лишено як є. */
  kept: number;
  skipped: number;
  failed: number;
  /** З них записано без циклічних полів і дозаповнено наприкінці. */
  refilled: number;
  /** Пропуски й попередження інтерпретатора — як у сухому прогоні. */
  convertSkipped: SkippedRows[];
  convertWarnings: SkippedRows[];
}

export interface LoadIssue {
  rule: string;
  /** Ключ об'єкта джерела. */
  key: string;
  /** Що це для людини: назва, код або ключ. */
  title: string;
  /** Маркер перекладу (ключі `core.conversion.*`) або текст відмови як є. */
  message: string;
  /**
   * Причина ззовні: відмова команди моделі чи бази, причина правила або
   * рішення людини. Сама буває маркером — показувати `resolveText` окремо.
   */
  cause?: string;
}

/** Пункт `source_decision.propose`: об'єкт джерела й рішення про нього. */
export interface DecisionProposal {
  source: string;
  kind: string;
  ref: string;
  decision: Record<string, unknown>;
  reason: string;
}

export interface LoadResult {
  rules: RuleSummary[];
  errors: LoadIssue[];
  /**
   * Записане, на що варто глянути: посилання на свідомо не перенесений об'єкт
   * у необов'язковому полі лягло порожнім.
   */
  warnings: LoadIssue[];
  /**
   * Рішення, які рушій ПРОПОНУЄ людині (дубль у джерелі — «злити»). Той, хто
   * кличе, пише їх поза транзакцією прогону: пропозиція мусить пережити й
   * пробу з відкатом.
   */
  proposals: DecisionProposal[];
  /** Документи, знесені перед прогоном (перезаливка). */
  purged: number;
  passes: number;
  posted: number;
  /** Записано, але не проведено, бо в джерелі документ непроведений. */
  unposted: number;
}

// ── Внутрішнє ───────────────────────────────────────────────────────────────

const PASS_LIMIT = 50;

/** Повідомлення з причиною ззовні — див. `LoadIssue.cause`. */
interface Said {
  message: string;
  cause?: string;
}

/**
 * Відмова, що скасовує лише точку збереження одного об'єкта. Причин буває
 * кілька (два нерозв'язні посилання) — кожна стає окремим рядком журналу.
 */
class ObjectError extends Error {
  readonly said: Said[];
  constructor(said: Said | Said[]) {
    const list = Array.isArray(said) ? said : [said];
    super(list[0]?.message ?? "");
    this.said = list;
  }
}

/** Об'єкт чекає на посилання — до наступного проходу. */
interface Waiting {
  refs: RefMarker[];
  /** Усі нерозв'язані стоять у необов'язкових полях верхнього рівня. */
  optionalOnly: boolean;
}

interface Work {
  rule: string;
  spec: Rule;
  /** Модель реєстру — за нею команди й тип (документ чи ні). */
  model: string;
  /** Ім'я в карті: таблиця, куди лягає запис (групи — `<модель>_group`). */
  entity: string;
  /** Тип об'єкта в карті: `refType` правила, для `transform` — його джерело. */
  kind: string;
  key: string;
  payload: Record<string, unknown>;
  done: boolean;
  /** Записано без циклічних полів — дозаповнити після проходів. */
  partial?: boolean;
  waiting?: Waiting;
  /** Відмова при спробі розірвати цикл на цьому об'єкті — для підсумку. */
  breakError?: Said[];
  /** Режим `append`: об'єкт уже був у карті до прогону — не чіпається. */
  kept?: boolean;
  /**
   * Не переноситься рішенням людини — посилання на нього лишаються порожніми.
   * `reason` — те, що людина написала в рішенні (може не бути).
   */
  skippedBy?: { reason?: string };
  /** Порядок у вибірці джерела — для документів однієї секунди. */
  seq: number;
}

interface MapEntry {
  id: string;
  method: string;
}

const IDENT = /^[a-z][a-z0-9_]*$/;

/** Поле схеми → колонка таблиці: `taxCode` → `tax_code`. */
function columnOf(field: string): string {
  return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function modelOf(rule: Rule): string {
  return rule.target.model.split("/").pop() ?? rule.target.model;
}

function entityOf(rule: Rule): string {
  return rule.target.entity ?? modelOf(rule);
}

function titleOf(work: Work): string {
  const p = work.payload;
  // Документ людина впізнає за номером і датою, а не за коментарем. Назва їде
  // в журнал як є, тож слів у ній немає — лише значення.
  if (typeof p.number === "string" && p.number && typeof p.docDate === "string") {
    return `№ ${p.number} · ${p.docDate.slice(0, 10)}`;
  }
  for (const value of [p.name, p.description, p.code]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  // Запис регістру назви не має — його називають поля ключа зіставлення.
  if (!work.spec.transform && work.spec.match?.length) {
    const parts = (work.spec.match?.[0] ?? []).map((field) => {
      const value = p[field];
      if (isRefMarker(value)) return value.$ref.presentation || value.$ref.ref;
      return typeof value === "string" && value ? value : null;
    }).filter(Boolean);
    return parts.length ? parts.join(" · ") : "*";
  }
  return work.key;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Що сказати про відмову: своя — як є, чужа (база, драйвер) — причиною. */
function saidOf(error: unknown, wrap?: string): Said[] {
  if (error instanceof ObjectError) {
    return wrap ? error.said.map((said) => ({ message: wrap, cause: said.cause ?? said.message })) : error.said;
  }
  /**
   * Порушення унікальності при записі НОВОГО об'єкта — майже завжди два
   * об'єкти джерела на один наш (два банки з одним МФО). Ключ зіставлення таких
   * не зводить свідомо, тож людині треба сказати, яке рішення тут потрібне.
   */
  if ((error as { code?: string })?.code === "23505") {
    return [{ message: "@[core.conversion.duplicateInTarget]", cause: messageOf(error) }];
  }
  return [wrap ? { message: wrap, cause: messageOf(error) } : { message: messageOf(error) }];
}

/**
 * Відмова команди моделі: повідомлення конверта — причиною, кожне окремо. Це
 * тексти застосунку (часто маркери його SQL), і склеювати їх не можна: маркер
 * розгортається лише цілим рядком.
 */
function envelopeSaid(result: unknown): Said[] {
  const messages = (result as { messages?: Array<{ text?: string }> })?.messages ?? [];
  const texts = messages.map((m) => m.text).filter((text): text is string => !!text);
  return texts.length
    ? texts.map((cause) => ({ message: "@[core.conversion.commandRefused]", cause }))
    : [{ message: "@[core.conversion.commandRefusedSilently]" }];
}

/**
 * Набір субконто (`analytics`): об'єкт, у якого ВСІ значення — маркери. Там
 * маркер стоїть на місці `{ id, name }`, а не id (так само читає `gate.ts`).
 */
function isAnalyticsSlot(value: Record<string, unknown>): boolean {
  const items = Object.values(value);
  return items.length > 0 && items.every(isRefMarker);
}

function stageOf(rule: Rule): "base" | "documents" {
  return rule.stage ?? "base";
}

function requiredOf(rule: Rule): Set<string> {
  return new Set((rule.target.schema as { required?: string[] }).required ?? []);
}

export async function load(sql: EngineSql, input: LoadInput): Promise<LoadResult> {
  const errors: LoadIssue[] = [];
  const warnings: LoadIssue[] = [];
  const proposals: DecisionProposal[] = [];
  const summaries = new Map<string, RuleSummary>();
  const works: Work[] = [];

  /** Журнал об'єкта: рядок на кожну причину, з тим самим ключем і назвою. */
  const issue = (into: LoadIssue[], work: Work, said: Said | Said[]) => {
    for (const { message, cause } of Array.isArray(said) ? said : [said]) {
      into.push({ rule: work.rule, key: work.key, title: titleOf(work), message, ...(cause ? { cause } : {}) });
    }
  };
  const fail = (work: Work, said: Said | Said[]) => {
    issue(errors, work, said);
    summaries.get(work.rule)!.failed++;
    work.done = true;
  };
  const count = (work: Work, outcome: Exclude<Outcome, "failed">) => {
    summaries.get(work.rule)![outcome]++;
    work.done = true;
  };

  // ── 0. Конвертація ─────────────────────────────────────────────────────────

  /**
   * Тип посилання → сутності карти, що його розв'язують (`refType`
   * декларативних правил). Їх буває кілька — елемент і група довідника
   * посилаються одним типом; ключ джерела однозначний, тож шукається серед усіх.
   */
  const entityByType = new Map<string, Set<string>>();
  for (const spec of Object.values(input.rules)) {
    if (spec.transform || !spec.refType) continue;
    const set = entityByType.get(spec.refType) ?? new Set<string>();
    set.add(entityOf(spec));
    entityByType.set(spec.refType, set);
  }

  /** Ключі кожного типу: об'єкти прогону й свідомо не перенесені (з причиною). */
  const pendingKeys = new Map<string, Map<string, Work>>();
  const skippedKeys = new Map<string, Record<string, string>>();
  const failedConvert = new Map<string, Set<string>>();

  const cache = new Map<string, SourceRow[] | null>();
  const rowsOf = async (query: string) => {
    if (!cache.has(query)) cache.set(query, await input.rows(query));
    return cache.get(query) ?? null;
  };

  const stage = input.stage ?? "base";
  /** Типи, які розв'язує ІНШИЙ прогін: їх немає в роботі, лише в карті. */
  const otherStageTypes = new Set<string>();
  for (const spec of Object.values(input.rules)) {
    if (stageOf(spec) !== stage && !spec.transform && spec.refType) otherStageTypes.add(spec.refType);
  }

  for (const [name, spec] of Object.entries(input.rules)) {
    if (stageOf(spec) !== stage) continue;
    const model = modelOf(spec);
    const entity = entityOf(spec);
    const summary: RuleSummary = {
      rule: name, entity, objects: 0, created: 0, updated: 0, linked: 0, kept: 0, skipped: 0, failed: 0, refilled: 0,
      convertSkipped: [], convertWarnings: [],
    };
    summaries.set(name, summary);
    const rows = await rowsOf(spec.query);
    if (!rows) {
      summary.noData = true;
      continue;
    }
    const joined: Record<string, SourceRow[]> = {};
    const extra = [
      ...Object.values(spec.join ?? {}).map((join) => join.query),
      ...(spec.transform ? [] : Object.values(spec.tables ?? {}).map((table) => table!.query)),
    ];
    for (const query of extra) {
      const joinedRows = await rowsOf(query);
      if (joinedRows) joined[query] = joinedRows;
    }
    const result = convert(spec, { rows, joined, params: input.params, accounts: input.accounts, defaults: input.defaults });
    const kind = spec.transform ? spec.source : spec.refType ?? spec.source;
    summary.convertSkipped = result.skipped;
    summary.convertWarnings = result.warnings;
    for (const issue of result.errors) {
      errors.push({ rule: name, key: issue.at, title: issue.at, message: issue.message });
      summary.failed++;
      const failed = failedConvert.get(kind) ?? new Set<string>();
      failed.add(issue.at);
      failedConvert.set(kind, failed);
    }
    skippedKeys.set(kind, { ...skippedKeys.get(kind), ...result.skippedKeys });
    const keys = pendingKeys.get(kind) ?? new Map<string, Work>();
    for (const object of result.objects) {
      const work: Work = {
        rule: name, spec, model, entity, kind, key: object.key, payload: object.payload, done: false, seq: works.length,
      };
      works.push(work);
      keys.set(object.key, work);
      summary.objects++;
    }
    pendingKeys.set(kind, keys);
  }

  // Модель цілі мусить існувати й мати SQL-функцію — інакше правило не
  // запишеться жодного разу, і казати про це треба одразу, а не на кожному рядку.
  for (const work of works) {
    if (!IDENT.test(work.entity) || !IDENT.test(work.model) || !input.model(work.model)) {
      fail(work, { message: `@[core.conversion.targetModelNotFound]${JSON.stringify({ model: work.spec.target.model })}` });
    }
  }

  // ── Карта й рішення ────────────────────────────────────────────────────────

  const map = new Map<string, MapEntry>();
  const mapKey = (entity: string, ref: string) => `${entity}|${ref}`;
  for (
    const row of await sql<{ ref: string; entity: string; entity_id: string; method: string }[]>`
      select ref, entity, entity_id::text, method from app.source_ref where source = ${input.source}
    `
  ) {
    map.set(mapKey(row.entity, row.ref), { id: row.entity_id, method: row.method });
  }

  const remember = async (tx: EngineSql, work: Work, id: string, method: string) => {
    await tx`
      insert into app.source_ref (source, kind, ref, entity, entity_id, method)
      values (${input.source}, ${work.kind}, ${work.key}, ${work.entity}, ${id}::bigint, ${method})
      on conflict (source, ref, entity)
      do update set entity_id = excluded.entity_id, method = excluded.method, kind = excluded.kind
    `;
    map.set(mapKey(work.entity, work.key), { id, method });
  };

  const decisions = new Map<string, Record<string, unknown>>();
  for (
    const row of await sql<{ kind: string; ref: string; decision: Record<string, unknown> }[]>`
      select kind, ref, decision from app.source_decision where source = ${input.source} and state = 'confirmed'
    `
  ) {
    decisions.set(`${row.kind}|${row.ref}`, row.decision);
  }

  // ── 1. Перезаливка документів ──────────────────────────────────────────────

  // У режимі «лише нове» перезаливки немає зовсім: що вже лежить у карті, того
  // рушій не торкається — ні знесенням, ні оновленням, ні проведенням.
  const append = input.mode === "append";
  if (append) {
    for (const work of works) if (!work.done && map.has(mapKey(work.entity, work.key))) work.kept = true;
  }

  // Зносяться документи свого прогону, а прогін залишків зносить і документи
  // після D: вони проведені від тих залишків, які зараз заміняться.
  const isDocumentRule = (spec: Rule) => input.model(modelOf(spec))?.type === "document";
  const documentEntities = [
    ...new Set(
      Object.values(input.rules)
        .filter((spec) => isDocumentRule(spec) && (stageOf(spec) === stage || stage === "base"))
        .map(entityOf),
    ),
  ];
  let purged = 0;
  if (!append && documentEntities.length) {
    const stale = await sql<{ entity: string; ref: string; id: string }[]>`
      select entity, ref, entity_id::text as id from app.source_ref
       where source = ${input.source} and method = 'new' and entity = any(${documentEntities})
    `;
    let left = stale.map((row) => row.id);
    while (left.length) {
      const still: string[] = [];
      for (const id of left) {
        try {
          await sql.savepoint(async (tx) => {
            await tx`delete from app.document where id = ${id}::bigint`;
          });
        } catch {
          // Документ ще комусь потрібен — знімемо наступним колом.
          still.push(id);
        }
      }
      if (still.length === left.length) {
        throw new Error(`@[core.conversion.purgeFailed]${JSON.stringify({ ids: still.join(", ") })}`);
      }
      purged += left.length - still.length;
      left = still;
    }
    for (const row of stale) map.delete(mapKey(row.entity, row.ref));
    await sql`
      delete from app.source_ref
       where source = ${input.source} and method = 'new' and entity = any(${documentEntities})
    `;
  }

  // ── Розв'язання посилань ───────────────────────────────────────────────────

  const nameCache = new Map<string, string | null>();
  const dimensionName = new Map<string, { table: string; column: string } | null>();

  /** Назва нашого запису для `{ id, name }` субконто — з оголошення виміру. */
  const nameOf = async (tx: EngineSql, entity: string, id: string): Promise<string | null> => {
    const cacheKey = `${entity}|${id}`;
    if (nameCache.has(cacheKey)) return nameCache.get(cacheKey)!;
    if (!dimensionName.has(entity)) {
      const [dim] = await tx<{ target_table: string; name_column: string | null; id_column: string }[]>`
        select target_table, name_column, id_column from app.analytic_dimension
         where model_key = ${entity} and entity_kind = 'catalog' limit 1
      `;
      dimensionName.set(entity, dim?.name_column ? { table: dim.target_table, column: dim.name_column } : null);
    }
    const dim = dimensionName.get(entity);
    let name: string | null = null;
    if (dim && /^[a-z_][a-z0-9_.]*$/.test(dim.table) && IDENT.test(dim.column)) {
      const table = dim.table.includes(".") ? dim.table : `app.${dim.table}`;
      const [row] = await tx.unsafe<{ name: string | null }[]>(`select ${dim.column}::text as name from ${table} where id = $1::bigint`, [id]);
      name = row?.name ?? null;
    }
    nameCache.set(cacheKey, name);
    return name;
  };

  /**
   * Чому посилання не розв'язується і чи розв'яжеться воно пізніше.
   * `null` — чекати (об'єкт ще в роботі); інакше — остаточна причина.
   * `skipped` — об'єкт свідомо не переноситься (`requires` правила): це не
   * дефект, а рішення, і необов'язкове поле тоді лишається порожнім.
   */
  const unresolvable = (marker: RefMarker, entities: string[]): (Said & { skipped?: boolean }) | null => {
    const { ref, type, presentation } = marker.$ref;
    const at = JSON.stringify({ ref: presentation || ref, type });
    if (!entities.length) return { message: `@[core.conversion.refNoRule]${at}` };
    const pending = pendingKeys.get(type)?.get(ref);
    if (!pending && otherStageTypes.has(type) && !pendingKeys.has(type)) {
      return {
        message: stage === "documents"
          ? `@[core.conversion.refNotInMapForDocuments]${at}`
          : `@[core.conversion.refInDocumentsStage]${at}`,
      };
    }
    if (pending && !pending.done) return null;
    if (pending) {
      return pending.skippedBy
        ? { message: `@[core.conversion.refSkippedByDecision]${at}`, cause: pending.skippedBy.reason, skipped: true }
        : { message: `@[core.conversion.refNotSaved]${at}` };
    }
    const skipped = skippedKeys.get(type)?.[ref];
    if (skipped) return { message: `@[core.conversion.refSkippedByRule]${at}`, cause: skipped, skipped: true };
    if (failedConvert.get(type)?.has(ref)) return { message: `@[core.conversion.refNotConverted]${at}` };
    return { message: `@[core.conversion.refNotInSnapshot]${at}` };
  };

  /**
   * Payload із розв'язаними посиланнями. Нерозв'язані лишаються маркерами й
   * перелічуються; `drop` — поля верхнього рівня, які записати порожніми
   * (двофазний запис циклу).
   */
  const resolve = async (tx: EngineSql, work: Work, drop = false) => {
    const waiting: RefMarker[] = [];
    const reasons: Said[] = [];
    /** Посилання на свідомо не перенесене в необов'язковому полі — поле порожнє. */
    const notes: Said[] = [];
    const required = requiredOf(work.spec);
    let optionalOnly = true;

    /** Субконто каже модель оголошенням виміру; поле — типом посилання. */
    const entitiesFor = (marker: RefMarker, dimension?: string): string[] =>
      dimension ? [dimension] : [...entityByType.get(marker.$ref.type) ?? []];

    const walk = async (value: unknown, top: string | null, dimensionEntity?: string): Promise<unknown> => {
      if (isSeedMarker(value)) {
        const id = await seededId(tx, value);
        if (id === null) {
          reasons.push({
            message: `@[core.conversion.seedNotFound]${JSON.stringify({ model: value.$seed.model, where: JSON.stringify(value.$seed.where) })}`,
          });
        }
        return id;
      }
      if (isLookupMarker(value)) {
        const found = await lookupId(tx, value);
        if (found.id !== null) return found.id;
        // «Кілька» — завжди помилка: порожнім полем вибору не зробиш. «Жодного»
        // з `orEmpty` у необов'язковому полі — порожньо з попередженням.
        if (!found.many && value.$lookup.orEmpty && top !== null && !required.has(top)) {
          notes.push({ message: found.said.message, cause: value.$lookup.orEmpty });
          return null;
        }
        reasons.push(found.said);
        return null;
      }
      if (isRefMarker(value)) {
        const entities = entitiesFor(value, dimensionEntity);
        for (const entity of entities) {
          const hit = map.get(mapKey(entity, value.$ref.ref));
          if (hit) return hit.id;
        }
        const reason = unresolvable(value, entities);
        if (reason?.skipped && top !== null && !required.has(top)) {
          notes.push({ message: reason.message, cause: reason.cause });
          return null;
        }
        // Посилання, що законно веде за межі перенесення (`ref(…, { orEmpty })`):
        // поле порожнє, людині — попередження з причиною правила.
        if (reason && value.$orEmpty) {
          notes.push({
            message: `@[core.conversion.refLeftEmpty]${JSON.stringify({ ref: value.$ref.presentation || value.$ref.ref, type: value.$ref.type })}`,
            cause: value.$orEmpty,
          });
          return null;
        }
        if (reason) reasons.push({ message: reason.message, cause: reason.cause });
        else waiting.push(value);
        if (top === null || required.has(top)) optionalOnly = false;
        return drop && top !== null && !required.has(top) ? null : value;
      }
      if (Array.isArray(value)) {
        const out = [];
        for (const item of value) out.push(await walk(item, null));
        return out;
      }
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        if (isAnalyticsSlot(record)) {
          // Субконто: модель — з оголошення виміру, а не з типу посилання.
          const dims = await dimensionModels(tx, Object.keys(record));
          for (const [dimension, marker] of Object.entries(record)) {
            const id = await walk(marker, null, dims.get(dimension) ?? undefined);
            out[dimension] = typeof id === "string"
              ? { id, name: await nameOf(tx, dims.get(dimension)!, id) ?? (marker as RefMarker).$ref.presentation }
              : id;
          }
          return out;
        }
        for (const [key, item] of Object.entries(record)) out[key] = await walk(item, null);
        return out;
      }
      return value;
    };

    const payload: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(work.payload)) {
      // Верхній рівень іде окремо, щоб знати поле: необов'язкове в циклі
      // пишеться порожнім, обов'язкове — ні.
      if (isRefMarker(value) || isLookupMarker(value) || isSeedMarker(value)) payload[field] = await walk(value, field);
      else {
        const before = waiting.length;
        payload[field] = await walk(value, null);
        if (waiting.length > before) optionalOnly = false;
      }
    }
    return { payload, waiting, reasons, notes, optionalOnly: optionalOnly && waiting.length > 0 };
  };

  /** Id засіяного рядка за ключем (`seeded` правила); немає — `null`. */
  const seedCache = new Map<string, string | null>();
  const seededId = async (tx: EngineSql, marker: SeedMarker): Promise<string | null> => {
    const { model, where } = marker.$seed;
    const cacheKey = JSON.stringify([model, where]);
    if (seedCache.has(cacheKey)) return seedCache.get(cacheKey)!;
    const table = model.split("/").pop() ?? model;
    const columns = Object.keys(where).map((field) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
    if (!IDENT.test(table) || !columns.length || !columns.every((c) => IDENT.test(c))) {
      throw new ObjectError({ message: `@[core.conversion.invalidName]${JSON.stringify({ name: model })}` });
    }
    const rows = await tx.unsafe<{ id: string }[]>(
      `select id::text as id from app.${table} where ${columns.map((c, i) => `${c}::text = $${i + 1}`).join(" and ")} limit 2`,
      Object.values(where).map(String),
    );
    const id = rows.length === 1 ? rows[0].id : null;
    seedCache.set(cacheKey, id);
    return id;
  };

  /**
   * Запис за значеннями полів рядка (`lookup` правила): ключ за ключем, до
   * першого влучення. Кілька рядків одним ключем — відповідь «кілька» одразу,
   * наступний ключ не пробується: збіг двох контрагентів за ЄДРПОУ не
   * розв'язується тим, що в одного з них знайшовся IBAN.
   *
   * Серед кандидатів — усі рядки таблиці, і позначені на видалення теж, — так
   * само, як у `match` і `seeded`: рушій не тлумачить стан запису, а знайдений
   * позначений контрагент — це питання до людини, а не привід завести дубль.
   */
  const lookupCache = new Map<string, { id: string | null; many?: boolean; said: Said }>();
  const lookupId = async (tx: EngineSql, marker: LookupMarker) => {
    const { model, keys, label } = marker.$lookup;
    const cacheKey = JSON.stringify([model, keys]);
    if (lookupCache.has(cacheKey)) return lookupCache.get(cacheKey)!;
    const tableOf = (name: string) => name.split("/").pop() ?? name;
    const condition = (where: Record<string, string>, alias: string) => {
      const columns = Object.keys(where).map(columnOf);
      if (!columns.length || !columns.every((c) => IDENT.test(c))) {
        throw new ObjectError({ message: `@[core.conversion.invalidName]${JSON.stringify({ name: Object.keys(where).join(" + ") })}` });
      }
      return columns.map((c, i) => `${alias}.${c}::text = $${i + 1}`).join(" and ");
    };
    let result: { id: string | null; many?: boolean; said: Said } | null = null;
    for (const key of keys) {
      const via = "via" in key ? key : null;
      const table = tableOf(via ? via.via : model);
      const pick = via ? columnOf(via.pick) : "id";
      if (!IDENT.test(table) || !IDENT.test(pick)) {
        throw new ObjectError({ message: `@[core.conversion.invalidName]${JSON.stringify({ name: via ? `${via.via}.${via.pick}` : model })}` });
      }
      const rows = await tx.unsafe<{ id: string }[]>(
        `select distinct t.${pick}::text as id from app.${table} t
          where ${condition(key.where, "t")} and t.${pick} is not null
          limit 2`,
        Object.values(key.where),
      );
      if (rows.length === 1) {
        result = { id: rows[0].id, said: { message: "" } };
        break;
      }
      if (rows.length > 1) {
        const said = Object.entries(key.where).map(([field, value]) => `${via ? `${tableOf(via.via)}.` : ""}${field} = ${value}`);
        result = {
          id: null,
          many: true,
          said: { message: `@[core.conversion.lookupAmbiguous]${JSON.stringify({ model, key: said.join(" + ") })}` },
        };
        break;
      }
    }
    result ??= {
      id: null,
      said: {
        message: keys.length
          ? `@[core.conversion.lookupNotFound]${JSON.stringify({ model, value: label })}`
          : `@[core.conversion.lookupNoKeys]${JSON.stringify({ model })}`,
      },
    };
    lookupCache.set(cacheKey, result);
    return result;
  };

  const dimensionCache = new Map<string, string | null>();
  const dimensionModels = async (tx: EngineSql, codes: string[]) => {
    const missing = codes.filter((code) => !dimensionCache.has(code));
    if (missing.length) {
      const rows = await tx<{ code: string; model_key: string }[]>`
        select code, model_key from app.analytic_dimension where code = any(${missing})
      `;
      for (const code of missing) dimensionCache.set(code, rows.find((r) => r.code === code)?.model_key ?? null);
    }
    return new Map(codes.map((code) => [code, dimensionCache.get(code) ?? null]));
  };

  // ── Запис ──────────────────────────────────────────────────────────────────

  const fnOf = (work: Work, command: string) => {
    const declared = input.model(work.model)?.sqlCommands?.[command];
    const name = typeof declared === "string" ? declared : declared?.functionName ??
      `${work.model}_${command.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;
    if (!IDENT.test(name)) throw new ObjectError({ message: `@[core.conversion.invalidName]${JSON.stringify({ name })}` });
    return `app.${name}`;
  };

  const call = async (tx: EngineSql, fn: string, payload: unknown) => {
    const [row] = await tx.unsafe<{ r: { ok?: boolean; data?: { item?: Record<string, unknown> } } }[]>(
      `select ${fn}($1::bigint, $2::jsonb) as r`,
      // Об'єкт, а не JSON.stringify: тип параметра драйвер бере з бази й для
      // jsonb серіалізує сам — рядок поїхав би туди jsonb-рядком, і
      // `payload->'item'` виявився б порожнім.
      [input.userId, payload],
    );
    if (!row?.r?.ok) throw new ObjectError(envelopeSaid(row?.r));
    return row.r.data?.item ?? null;
  };

  const save = async (tx: EngineSql, work: Work, payload: Record<string, unknown>) => {
    const item = await call(tx, fnOf(work, work.spec.target.command ?? "save"), { item: payload });
    const id = item?.id;
    if (id === null || id === undefined || id === "") throw new ObjectError({ message: "@[core.conversion.saveReturnedNoId]" });
    return String(id);
  };

  /**
   * Оновити запис, який завело перенесення: поверх того, що в ньому зараз, —
   * лише поля правила. Поле, заповнене людиною й невідоме правилу, лишається.
   * Порожнє поле правила (`undefined`) теж лишає наявне значення: інтерпретатор
   * так позначає «поля немає», а не «очистити».
   *
   * `null` — запису вже немає (прибрали руками): той, хто кличе, заведе новий.
   * Команда запису, відмінна від `save` (`groupSave`), свого `get` не має, і її
   * payload правило несе цілком — він пишеться як є.
   */
  const update = async (tx: EngineSql, work: Work, id: string, payload: Record<string, unknown>) => {
    const [exists] = await tx.unsafe<{ id: string }[]>(`select id::text as id from app.${work.entity} where id = $1::bigint`, [id]);
    if (!exists) return null;
    const command = work.spec.target.command ?? "save";
    if (command !== "save") return await save(tx, work, { ...payload, id });
    const current = await call(tx, fnOf(work, "get"), { id });
    if (!current) return null;
    const merged: Record<string, unknown> = { ...current };
    for (const [field, value] of Object.entries(payload)) if (value !== undefined) merged[field] = value;
    merged.id = id;
    return await save(tx, work, merged);
  };

  /**
   * Умова ключа `match` над рядком `t`: колонка = значення, а порожнє — або
   * пропуск ключа (`null`), або `is null`, коли правило каже, що порожнє —
   * теж значення (`matchEmpty`). Параметри нумеруються з `first`.
   */
  const matchWhere = (work: Work, fields: readonly string[], values: unknown[], first: number) => {
    const empty = (v: unknown) => v === null || v === undefined || v === "";
    const matchEmpty = !work.spec.transform && work.spec.matchEmpty === true;
    if (!matchEmpty && values.some(empty)) return null;
    if (values.some((v) => !empty(v) && typeof v === "object")) return null;
    const columns = fields.map((field) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
    if (!columns.every((c) => IDENT.test(c))) {
      throw new ObjectError({ message: `@[core.conversion.invalidName]${JSON.stringify({ name: fields.join(" + ") })}` });
    }
    const params: string[] = [];
    const where = columns.map((c, i) => {
      if (empty(values[i])) return `t.${c} is null`;
      params.push(String(values[i]));
      return `t.${c}::text = $${first + params.length - 1}`;
    }).join(" and ");
    return { where, params };
  };

  /** Рівень «ключ»: наявний рядок, якого не заводило перенесення. */
  const matchExisting = async (tx: EngineSql, work: Work, payload: Record<string, unknown>) => {
    if (work.spec.transform || !work.spec.match?.length) return null;
    for (const fields of work.spec.match) {
      const values = fields.map((field) => payload[field]);
      const cond = matchWhere(work, fields, values, 3);
      if (!cond) continue;
      const { where } = cond;
      const rows = await tx.unsafe<{ id: string }[]>(
        `select t.id::text as id from app.${work.entity} t
          where ${where}
            and not exists (select 1 from app.source_ref r
                             where r.source = $1 and r.entity = $2 and r.entity_id = t.id and r.method = 'new')
          limit 2`,
        [input.source, work.entity, ...cond.params],
      );
      if (rows.length > 1) {
        throw new ObjectError({
          message: `@[core.conversion.matchAmbiguous]${JSON.stringify({ key: fields.join(" + "), value: values.join(" + ") })}`,
        });
      }
      if (rows.length === 1) return rows[0].id;
    }
    return null;
  };

  /**
   * Знайдене за ключем лише пов'язується — і для довідника це все: назва
   * засіяного рядка людині не цікава. А в регістрі (тип моделі `register`)
   * ключ — це виміри й період, і сенс рядка саме в ресурсах (курс, завантажений
   * з НБУ на ту саму дату, рахунок у рядку «за умовчанням»): коли джерело каже про той самий
   * ключ інше, ніж наш рядок, мовчки лишити наше означало б загубити
   * налаштування клієнта. Переписувати рушій не має права (рішення
   * 26.09.2026), тож каже людині: що в джерелі, що в нас, — вирішувати їй.
   */
  const compareLinked = async (tx: EngineSql, work: Work, id: string, payload: Record<string, unknown>) => {
    if (work.spec.transform || input.model(work.model)?.type !== "register" || (work.spec.target.command ?? "save") !== "save") return;
    const keyFields = new Set(work.spec.match?.flat() ?? []);
    const current = await call(tx, fnOf(work, "get"), { id });
    if (!current) return;
    const text = (v: unknown) => v === null || v === undefined ? "" : String(v);
    const differs: string[] = [];
    for (const [field, value] of Object.entries(payload)) {
      if (field === "id" || keyFields.has(field) || value === undefined) continue;
      if (typeof value === "object" && value !== null) continue;
      if (text(value) === text(current[field])) continue;
      // 41.5 і «41.500000» — той самий курс: число порівнюється як число.
      if (typeof value === "number" && value === Number(current[field])) continue;
      // Посилання — з поданням джерела: голий id людині нічого не каже.
      const source = work.payload[field];
      const said = isRefMarker(source) ? `${source.$ref.presentation} (id ${text(value)})` : text(value);
      // Слів тут немає — лише значення: «джерело ≠ у нас» каже переклад.
      differs.push(`${field}: «${said}» ≠ «${text(current[field])}»`);
    }
    if (differs.length) {
      issue(warnings, work, { message: `@[core.conversion.linkedDiffers]${JSON.stringify({ fields: differs.join("; ") })}` });
    }
  };

  /**
   * Дубль у джерелі: новий запис упав на унікальності, а за ключем зіставлення
   * вже є рядок, який завело ЦЕ Ж перенесення з іншого об'єкта джерела (два
   * банки з одним МФО). Злити їх сам рушій не має права — це рішення людини,
   * — але запропонувати може: пропозиція з доводом лягає в `source_decision`,
   * людина підтверджує, і наступний прогін зводить обидва в один запис.
   */
  const proposeMerge = async (work: Work) => {
    if (work.spec.transform || !work.spec.match?.length) return;
    for (const fields of work.spec.match) {
      const values = fields.map((field) => work.payload[field]);
      let cond: ReturnType<typeof matchWhere>;
      try {
        cond = matchWhere(work, fields, values, 3);
      } catch {
        return;
      }
      if (!cond) continue;
      const rows = await sql.unsafe<{ ref: string }[]>(
        `select r.ref from app.${work.entity} t
           join app.source_ref r on r.source = $1 and r.entity = $2 and r.entity_id = t.id and r.method = 'new'
          where ${cond.where}
          limit 2`,
        [input.source, work.entity, ...cond.params],
      );
      if (rows.length !== 1 || rows[0].ref === work.key) continue;
      const other = pendingKeys.get(work.kind)?.get(rows[0].ref);
      proposals.push({
        source: input.source,
        kind: work.kind,
        ref: work.key,
        decision: {
          action: "merge",
          ref: rows[0].ref,
          title: titleOf(work),
          targetTitle: other ? titleOf(other) : rows[0].ref,
        },
        reason: `@[core.conversion.proposeMerge]${
          JSON.stringify({ key: fields.join(" + "), value: values.join(" + "), target: other ? titleOf(other) : rows[0].ref })
        }`,
      });
      return;
    }
  };

  const documents: Array<{ work: Work; id: string }> = [];
  const isDocument = (work: Work) => input.model(work.model)?.type === "document";

  /** Посилання, що лишилися порожніми (див. `resolve.notes`), — попередженням. */
  const note = (work: Work, notes: Said[]) => {
    const seen = new Set<string>();
    for (const said of notes) {
      const id = `${said.message}|${said.cause ?? ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      issue(warnings, work, said);
    }
  };

  /**
   * Один об'єкт. `true` — зрушив (записано, пов'язано, відмовлено остаточно).
   *
   * `breaking` — фаза розриву циклу: об'єкт, що чекає лише на необов'язкові
   * поля, пишеться без них. Відмова тут — не вирок: її могло спричинити саме
   * порожнє поле (рахунок без власника), тож об'єкт лишається чекати, а рушій
   * пробує розірвати цикл з іншого боку.
   */
  const step = async (work: Work, breaking: boolean): Promise<boolean> => {
    // «Лише нове»: що вже в карті, того не чіпає й рішення — воно стосується
    // переносу об'єкта, а об'єкт уже перенесено.
    if (work.kept) {
      count(work, "kept");
      return true;
    }
    // Рішення людини — первинне: воно сильніше за карту й за ключ.
    const decision = decisions.get(`${work.kind}|${work.key}`);
    if (decision?.action === "skip") {
      work.skippedBy = typeof decision.reason === "string" && decision.reason ? { reason: decision.reason } : {};
      count(work, "skipped");
      return true;
    }
    if (decision?.action === "link" && decision.id !== undefined) {
      await sql.savepoint((tx) => remember(tx, work, String(decision.id), "decision"));
      count(work, "linked");
      return true;
    }
    if (decision?.action === "merge" && typeof decision.ref === "string") {
      const target = map.get(mapKey(work.entity, decision.ref));
      if (target) {
        await sql.savepoint((tx) => remember(tx, work, target.id, "decision"));
        count(work, "linked");
        return true;
      }
      const other = pendingKeys.get(work.kind)?.get(decision.ref);
      if (other && !other.done) return false;
      fail(work, { message: `@[core.conversion.mergeTargetMissing]${JSON.stringify({ ref: decision.ref })}` });
      return true;
    }

    const known = map.get(mapKey(work.entity, work.key));
    if (known && known.method !== "new") {
      count(work, "linked");
      return true;
    }

    let partial = false;
    try {
      return await sql.savepoint(async (tx) => {
        const resolved = await resolve(tx, work, breaking);
        if (resolved.reasons.length) throw new ObjectError(resolved.reasons);
        if (resolved.waiting.length && !(breaking && resolved.optionalOnly)) {
          work.waiting = { refs: resolved.waiting, optionalOnly: resolved.optionalOnly };
          return false;
        }
        partial = resolved.waiting.length > 0;

        let outcome: "created" | "updated" | null = null;
        let id: string | null = null;
        if (known) {
          id = await update(tx, work, known.id, resolved.payload);
          if (id) outcome = "updated";
          // Запис, заведений минулим разом, прибрали руками — заводимо знову.
          else map.delete(mapKey(work.entity, work.key));
        }
        if (!outcome) {
          const found = isDocument(work) ? null : await matchExisting(tx, work, resolved.payload);
          if (found) {
            await remember(tx, work, found, "exact");
            await compareLinked(tx, work, found, resolved.payload);
            count(work, "linked");
            return true;
          }
          id = await save(tx, work, resolved.payload);
          await remember(tx, work, id, "new");
          outcome = "created";
        }
        if (partial) work.partial = true;
        if (isDocument(work)) documents.push({ work, id: id! });
        note(work, resolved.notes);
        count(work, outcome);
        return true;
      });
    } catch (error) {
      // І своя відмова (`ObjectError`), і відмова бази (обмеження, тригер) —
      // помилка ОБ'ЄКТА: точка збереження її вже відкотила.
      if (breaking && partial) {
        work.breakError = saidOf(error);
        return false;
      }
      fail(work, saidOf(error));
      if ((error as { code?: string })?.code === "23505") await proposeMerge(work);
      return true;
    }
  };

  // ── 2–3. Проходи ───────────────────────────────────────────────────────────

  let passes = 0;
  while (works.some((w) => !w.done) && passes < PASS_LIMIT) {
    if (await input.cancelled?.()) throw new LoadCancelled();
    passes++;
    let moved = 0;
    const todo = works.filter((w) => !w.done);
    for (const [index, work] of todo.entries()) {
      if (index % 200 === 0) {
        await input.progress?.({ phase: "save", pass: passes, done: works.length - todo.length + index, of: works.length });
      }
      if (await step(work, false)) moved++;
    }
    if (moved > 0) continue;

    // Прохід не зрушив нічого — лишилися цикли. Розривати всі одразу не можна:
    // організація й її основний рахунок записалися б обидва порожніми, а
    // рахунок без власника база не прийме. Тому кожен кандидат спершу
    // пробується ЗВИЧАЙНО — його посилання могли розв'язатися щойно розірваним
    // сусідом, — і лише потім без циклічних полів. Так пара розривається з
    // одного боку, а всі пари — за один прохід, а не по проходу на пару.
    let broken = 0;
    for (const work of works.filter((w) => !w.done && w.waiting?.optionalOnly)) {
      if (work.done) continue;
      if (await step(work, false) || await step(work, true)) broken++;
    }
    if (!broken) break;
  }
  for (const work of works.filter((w) => !w.done)) {
    const refs = JSON.stringify({
      refs: (work.waiting?.refs ?? []).map((m) => `«${m.$ref.presentation || m.$ref.ref}» (${m.$ref.type})`).join(", "),
    });
    fail(
      work,
      work.breakError
        ? work.breakError.map((said) => ({ message: `@[core.conversion.cycleNotBroken]${refs}`, cause: said.cause ?? said.message }))
        : work.waiting?.refs.length
        ? { message: `@[core.conversion.refsUnresolved]${refs}` }
        : { message: "@[core.conversion.passLimit]" },
    );
  }

  // Дозаповнення циклів: тепер посилання мусять розв'язатися.
  for (const work of works.filter((w) => w.partial)) {
    const id = map.get(mapKey(work.entity, work.key))?.id;
    if (!id) continue;
    try {
      await sql.savepoint(async (tx) => {
        const resolved = await resolve(tx, work);
        if (resolved.reasons.length) throw new ObjectError(resolved.reasons);
        if (resolved.waiting.length) throw new ObjectError({ message: "@[core.conversion.refsUnresolvedAfterPasses]" });
        await update(tx, work, id, resolved.payload);
        note(work, resolved.notes);
      });
      summaries.get(work.rule)!.refilled++;
    } catch (error) {
      issue(errors, work, saidOf(error, "@[core.conversion.refillFailed]"));
    }
  }

  // ── 4. Проведення — за часом документа ─────────────────────────────────────

  // Час документа — ISO з годиною («2026-09-01T10:15:00») або дата без неї
  // (введення залишків); рядком вони порівнюються правильно, бо дата без часу
  // — це початок доби. Та сама секунда — порядок вибірки джерела.
  const dateOf = (work: Work) => String(work.payload.docDate ?? work.payload.date ?? "");
  documents.sort((a, b) => dateOf(a.work).localeCompare(dateOf(b.work)) || a.work.seq - b.work.seq);
  let posted = 0;
  let unposted = 0;
  for (const [index, { work, id }] of documents.entries()) {
    if (index % 50 === 0) await input.progress?.({ phase: "post", done: index, of: documents.length });
    // Непроведений у джерелі — непроведений і в нас: проведення — це стан
    // «заповнено правильно», і вирішувати його за бухгалтера рушій не має права.
    if (work.payload.isPosted === false) {
      unposted++;
      continue;
    }
    try {
      await sql.savepoint((tx) => call(tx, fnOf(work, "post"), { id }));
      posted++;
    } catch (error) {
      issue(errors, work, saidOf(error, "@[core.conversion.postFailed]"));
    }
  }

  return { rules: [...summaries.values()], errors, warnings, proposals, purged, passes, posted, unposted };
}

/** Зупинка на прохання людини — той, хто кличе, відкочує транзакцію. */
export class LoadCancelled extends Error {
  constructor() {
    super("@[core.conversion.cancelled]");
  }
}
