import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@shared/schema.ts";

// ── 1. Item — форма редагування та payload для save ───────────────────────────

export const BankItemSchema = Type.Object({
  id:   Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  code: Type.String({
    title: "Код", minLength: 1, maxLength: 9,
    "x-form": { order: 1, width: "sm" },
    "x-list": { width: "sm", sortable: true },
    "x-search": true,
  }),
  name: Type.String({
    title: "Назва", minLength: 1, maxLength: 100,
    "x-form": { order: 2, width: "full" },
    "x-list": { sortable: true },
    "x-lookup": true,
    "x-search": true,
  }),
  mfo: Type.Optional(Type.String({
    title: "МФО", maxLength: 6,
    "x-form": { order: 3, width: "sm" },
    "x-list": { width: "sm", sortable: true },
    "x-lookup": true,
    "x-search": true,
  })),
  isActive: Type.Optional(Type.Boolean({ title: "Активний", default: true })),
});
export type BankItem = Static<typeof BankItemSchema>;

// ── 2. Row — рядок списку ─────────────────────────────────────────────────────

export const BankRowSchema = Type.Object({
  id:       Type.String({ "x-db-type": "bigint" }),
  code:     Type.String(),
  name:     Type.String(),
  mfo:      Type.Optional(Type.String()),
  isActive: Type.Optional(Type.Boolean()),
});
export type BankRow = Static<typeof BankRowSchema>;

// ── 3. LookupRow — рядок пікера ───────────────────────────────────────────────

export const BankLookupRowSchema = Type.Object({
  id:  Type.String({ "x-db-type": "bigint" }),
  name: Type.String(),
  mfo:  Type.Optional(Type.String()),
});
export type BankLookupRow = Static<typeof BankLookupRowSchema>;

// ── 4. Payload schemas ────────────────────────────────────────────────────────

export const BankListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([
              Type.Literal("code"),
              Type.Literal("name"),
              Type.Literal("mfo"),
            ])),
  sortDir:  Type.Optional(SortDirSchema),
});
export type BankListPayload = Static<typeof BankListPayloadSchema>;

export const BankGetPayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type BankGetPayload = Static<typeof BankGetPayloadSchema>;

export const BankSavePayloadSchema = Type.Object({
  item: BankItemSchema,
});
export type BankSavePayload = Static<typeof BankSavePayloadSchema>;

export const BankDeletePayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type BankDeletePayload = Static<typeof BankDeletePayloadSchema>;

export const BankLookupPayloadSchema = Type.Object({
  search: Type.Optional(Type.String()),
  limit:  Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});
export type BankLookupPayload = Static<typeof BankLookupPayloadSchema>;

// ── 5. Response data shapes ───────────────────────────────────────────────────

export const BankListDataSchema = Type.Object({
  rows: Type.Array(BankRowSchema),
  totals: Type.Object({
    count:    Type.Number(),
    page:     Type.Number(),
    pageSize: Type.Number(),
  }),
});
export type BankListData = Static<typeof BankListDataSchema>;

export const BankGetDataSchema = Type.Object({
  item:    Type.Union([BankItemSchema, Type.Null()]),
  options: Type.Object({}),
});
export type BankGetData = Static<typeof BankGetDataSchema>;

export const BankSaveDataSchema = Type.Object({
  item: Type.Union([BankItemSchema, Type.Null()]),
});
export type BankSaveData = Static<typeof BankSaveDataSchema>;

export const BankLookupDataSchema = Type.Object({
  rows: Type.Array(BankLookupRowSchema),
});
export type BankLookupData = Static<typeof BankLookupDataSchema>;
