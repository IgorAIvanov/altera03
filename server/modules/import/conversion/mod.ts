/**
 * Конвертація сировини в моделі — вхід `@altera/server/import`.
 *
 * Три шари, кожен без іншого живе: декларація правила (`rule.ts`) — те, що
 * пише набір застосунку; інтерпретатор (`convert.ts`) і шлюз (`gate.ts`) —
 * рядки джерела в payload-и без бази, для сухого прогону й проби; рушій
 * (`engine.ts`) — payload-и в моделі через `_save` / `_post`, з картою
 * `app.source_ref` і рішеннями `app.source_decision`.
 *
 * Вхід окремий від бареля навмисно: правила набору імпортує реєстр
 * `import-sets.generated.ts`, а барель тягне bootstrap із контролерами Danet.
 * Тут — лише typebox. Команду, що кличе рушій (межа транзакції, звідки рядки,
 * що з результатом), пише застосунок: ядро не знає ні джерела, ні екрана.
 * Деталі — `docs/import.md`, розділ «Конвертація».
 */
export {
  analytics,
  calc,
  constant,
  date,
  enumMap,
  isLookupMarker,
  isRefMarker,
  isSeedMarker,
  isSourceEnum,
  isSourceRef,
  lineNumber,
  lookup,
  number,
  readPath,
  ref,
  refMarker,
  rootOf,
  rule,
  seeded,
  text,
} from "./rule.ts";
export type {
  DeclarativeRule,
  Expr,
  FieldExpr,
  Join,
  LookupKey,
  LookupMarker,
  RefMarker,
  Rule,
  RuleSetDefaults,
  SeedMarker,
  SourceEnum,
  SourceRef,
  SourceRow,
  Table,
  TargetAccount,
  Transform,
  TransformLib,
  TransformOutput,
  TransformRule,
} from "./rule.ts";
export { convert, declaredReads } from "./convert.ts";
export type { ConvertInput, ConvertIssue, ConvertResult, SkippedRows } from "./convert.ts";
export { collectRefs, schemaErrors, staticCheck, stubRefs } from "./gate.ts";
export type { GateIssue } from "./gate.ts";
export { load, LoadCancelled } from "./engine.ts";
export type {
  DecisionProposal,
  EngineSql,
  LoadInput,
  LoadIssue,
  LoadResult,
  RuleSummary,
  TargetModel,
} from "./engine.ts";
