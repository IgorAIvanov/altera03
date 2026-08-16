import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

/**
 * Тип зауваження.
 *
 * `order` (замовлення) стоїть окремо від `wish` навмисно: побажання це «добре б
 * колись», замовлення — «зробіть, це потрібно». Друге має ціну й строк, тому в
 * роботу його переводить власник рішення, а не виконавець (див. `remark_answer`
 * у ядрі).
 */
export const REMARK_KINDS = ["error", "question", "wish", "order"] as const;

/** Стан обробки — заявка ВИКОНАВЦЯ. Закритість це не стан, а `verifiedAt`. */
export const REMARK_STATUSES = ["new", "in_work", "answered", "fixed", "rejected"] as const;

export const RemarkRowSchema = Type.Object({
  id:           Type.String({ "x-db-type": "bigint" }),
  createdAt:    Type.String(),
  author:       Type.Union([Type.String(), Type.Null()]),
  kind:         Type.String(),
  title:        Type.String(),
  status:       Type.String(),
  area:         Type.Union([Type.String(), Type.Null()]),
  ctxRoute:     Type.Union([Type.String(), Type.Null()]),
  hasAnswer:    Type.Boolean(),
  fixedVersion: Type.Union([Type.String(), Type.Null()]),
  verifiedAt:   Type.Union([Type.String(), Type.Null()]),
  isDeleted:    Type.Boolean(),
});
export type RemarkRow = Static<typeof RemarkRowSchema>;

/**
 * Запис цілком. Поля трьох сторін лежать в одному об'єкті, але пишуться різними
 * командами: `save` бачить лише тип і текст, `answer` — лише відповідь,
 * `verify` — лише закриття. Форма показує все й редагує рівно свою частину.
 */
export const RemarkItemSchema = Type.Object({
  id:    Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  // --- людина
  kind:  Type.String({ default: "error" }),
  title: Type.String({ default: "" }),
  body:  Type.String({ default: "" }),
  // --- машина
  ctxRoute:     Type.Union([Type.String(), Type.Null()], { default: null }),
  ctxModel:     Type.Union([Type.String(), Type.Null()], { default: null }),
  ctxRecordId:  Type.Union([Type.String(), Type.Null()], { default: null }),
  ctxOrgId:     Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  ctxSolution:  Type.Union([Type.String(), Type.Null()], { default: null }),
  ctxFramework: Type.Union([Type.String(), Type.Null()], { default: null }),
  ctxUserAgent: Type.Union([Type.String(), Type.Null()], { default: null }),
  createdAt:    Type.Union([Type.String(), Type.Null()], { default: null }),
  author:       Type.Union([Type.String(), Type.Null()], { default: null }),
  // --- виконавець
  status:       Type.String({ default: "new" }),
  area:         Type.Union([Type.String(), Type.Null()], { default: null }),
  answer:       Type.Union([Type.String(), Type.Null()], { default: null }),
  answeredAt:   Type.Union([Type.String(), Type.Null()], { default: null }),
  fixedVersion: Type.Union([Type.String(), Type.Null()], { default: null }),
  feedbackRef:  Type.Union([Type.String(), Type.Null()], { default: null }),
  /** Посилання на раніше подане зауваження: id відбирає, `name` малює пікер. */
  duplicateOf: Type.Union([
    Type.Object({ id: Type.String({ "x-db-type": "bigint" }), name: Type.String() }),
    Type.Null(),
  ], { default: null }),
  // --- закриття
  verifiedAt:   Type.Union([Type.String(), Type.Null()], { default: null }),
  verifiedBy:   Type.Union([Type.String(), Type.Null()], { default: null }),
  isDeleted:    Type.Boolean({ default: false }),
});
export type RemarkItem = Static<typeof RemarkItemSchema>;

/** Рядок підбору: `name` уже несе номер. */
export const RemarkLookupRowSchema = Type.Object({
  id:   Type.String({ "x-db-type": "bigint" }),
  name: Type.String(),
});
export type RemarkLookupRow = Static<typeof RemarkLookupRowSchema>;

export const RemarkEditRootSchema = Type.Object({
  item: RemarkItemSchema,
});
export type RemarkEditRoot = Static<typeof RemarkEditRootSchema>;

/**
 * Одна колонка дошки: картки одного стану.
 *
 * Колонка тримає СВІЙ лік і СВОЮ сторінку, бо кожна вантажиться окремим
 * запитом. Спокуса взяти всі картки одним `list` і розкласти їх на клієнті
 * велика й хибна: `remark_list` віддає сторінку, а не набір, тож «розклали
 * двадцять» означало б, що дошка мовчки показує двадцять із двохсот.
 *
 * `total` — скільки записів у стані ВЗАГАЛІ, а не скільки завантажено; на цю
 * різницю й спирається «показати ще».
 */
export const RemarkBoardColumnSchema = Type.Object({
  /** Значення поля `status`, яким колонка задана. */
  key:   Type.String({ default: "" }),
  rows:  Type.Array(RemarkRowSchema, { default: [] }),
  total: Type.Number({ default: 0 }),
  /** Скільки сторінок уже взято (не номер поточної). */
  pages: Type.Number({ default: 1 }),
});
export type RemarkBoardColumn = Static<typeof RemarkBoardColumnSchema>;

/**
 * Корінь дошки.
 *
 * `columns` — дані (картки прийшли з сервера), `$query` — службовий стан
 * відбору; `$`-префікс і тримає цю межу.
 */
export const RemarkBoardRootSchema = Type.Object({
  columns: Type.Array(RemarkBoardColumnSchema, { default: [] }),
  $query: Type.Object({
    search:   Type.String({ default: "" }),
    kind:     Type.String({ default: "" }),
    openOnly: Type.String({ default: "" }),
    /**
     * Порядок карток у колонці — напрям, а не поле: сортувати дошку є чим лише
     * по даті. Свого порядку («перетягнув — запам'яталося») у дошки немає й не
     * буде тут: під нього потрібне поле в `app.remark`, а таблиця ядрова.
     * Робити його датою не можна — це переписувало б `created_at`, тобто час
     * подання зауваження.
     */
    sortDir: Type.Union([Type.Literal("asc"), Type.Literal("desc")], { default: "desc" }),
  }),
});
export type RemarkBoardRoot = Static<typeof RemarkBoardRootSchema>;

/** Відбори журналу. Ключі — контракт із `app.remark_list` (`payload->'filters'`). */
export const RemarkFiltersSchema = Type.Object({
  kind:     Type.Optional(Type.String()),
  status:   Type.Optional(Type.String()),
  // Рядок, а не boolean: `setFilters` викидає `false` як порожнє значення, і
  // відбір «лише відкриті» не доїхав би до сервера взагалі.
  openOnly: Type.Optional(Type.String()),
});
export type RemarkFilters = Static<typeof RemarkFiltersSchema>;

export const RemarkListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  filters:  Type.Optional(RemarkFiltersSchema),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([
    Type.Literal("createdAt"),
    Type.Literal("title"),
    Type.Literal("status"),
    Type.Literal("kind"),
  ])),
  sortDir: Type.Optional(SortDirSchema),
});
export type RemarkListPayload = Static<typeof RemarkListPayloadSchema>;
