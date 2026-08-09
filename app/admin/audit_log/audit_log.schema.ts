import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

export const AuditLogRowSchema = Type.Object({
  id:         Type.String({ "x-db-type": "bigint" }),
  occurredAt: Type.String(),
  user:       Type.String(),
  model:      Type.String(),
  command:    Type.String(),
  recordId:   Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint" }),
  isSuccess:  Type.Boolean(),
});
export type AuditLogRow = Static<typeof AuditLogRowSchema>;

/**
 * Панель фільтрів списку. Ключі — контракт із `app.audit_log_list`; він читає
 * їх як `payload->'filters'->>'...'`, тож розбіжність імен тиха.
 *
 * `result` — рядок, а не boolean: `setFilters` видаляє `false` як порожнє
 * значення, тому відбір «лише помилки» не дійшов би до сервера взагалі.
 */
export const AuditLogFiltersSchema = Type.Object({
  dateFrom: Type.Optional(Type.String()),
  dateTo:   Type.Optional(Type.String()),
  // Ссылка — ОДИН ключ з об'єктом: id відбирає, `name` малює пікер у панелі.
  user:     Type.Optional(Type.Object({
    id:   Type.String({ "x-db-type": "bigint" }),
    name: Type.String(),
  })),
  model:    Type.Optional(Type.String()),
  command:  Type.Optional(Type.String()),
  recordId: Type.Optional(Type.String({ "x-db-type": "bigint" })),
  result:   Type.Optional(Type.Union([Type.Literal("success"), Type.Literal("failure")])),
});
export type AuditLogFilters = Static<typeof AuditLogFiltersSchema>;

export const AuditLogListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  /**
   * Ключі моделей, чия НАЗВА збіглася з пошуком: у журналі лежить `bank`, а в
   * колонці стоїть «Банки», і перекласти ключ уміє лише клієнт — він і рахує
   * збіг (`extraPayload()`), SQL додає перелік до пошуку через `or`.
   */
  modelKeys: Type.Optional(Type.Array(Type.String())),
  filters:  Type.Optional(AuditLogFiltersSchema),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([
    Type.Literal("occurredAt"),
    Type.Literal("user"),
    Type.Literal("model"),
    Type.Literal("command"),
    Type.Literal("recordId"),
    Type.Literal("isSuccess"),
  ])),
  sortDir: Type.Optional(SortDirSchema),
});
export type AuditLogListPayload = Static<typeof AuditLogListPayloadSchema>;

export const AuditLogListDataSchema = Type.Object({
  rows: Type.Array(AuditLogRowSchema),
  totals: Type.Object({
    count: Type.Number(),
    page: Type.Number(),
    pageSize: Type.Number(),
  }),
});
export type AuditLogListData = Static<typeof AuditLogListDataSchema>;