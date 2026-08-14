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
  duplicateOf:  Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  // --- закриття
  verifiedAt:   Type.Union([Type.String(), Type.Null()], { default: null }),
  verifiedBy:   Type.Union([Type.String(), Type.Null()], { default: null }),
  isDeleted:    Type.Boolean({ default: false }),
});
export type RemarkItem = Static<typeof RemarkItemSchema>;

export const RemarkEditRootSchema = Type.Object({
  item: RemarkItemSchema,
});
export type RemarkEditRoot = Static<typeof RemarkEditRootSchema>;

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
