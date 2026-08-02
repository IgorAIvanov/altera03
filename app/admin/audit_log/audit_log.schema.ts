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

export const AuditLogListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
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