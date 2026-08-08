import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

export const CurrencyItemSchema = Type.Object({
  id:   Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  code: Type.String({
    title: "Код", minLength: 3, maxLength: 3,
    "x-form": { order: 1, width: "sm" },
    "x-list": { width: "6rem", sortable: true },
    "x-lookup": true,
    "x-search": true,
  }),
  name: Type.String({
    title: "Назва", minLength: 1, maxLength: 100,
    "x-form": { order: 2, width: "full" },
    "x-list": { sortable: true },
    "x-search": true,
  }),
  numericCode: Type.Optional(Type.String({
    title: "Цифровий код", maxLength: 3,
    "x-form": { order: 3, width: "sm" },
    "x-list": { width: "7rem" },
  })),
  symbol: Type.Optional(Type.String({
    title: "Символ", maxLength: 8,
    "x-form": { order: 4, width: "sm" },
    "x-list": { width: "5rem" },
  })),
  isDeleted: Type.Optional(Type.Boolean({ title: "Позначено на видалення", default: false })),
});
export type CurrencyItem = Static<typeof CurrencyItemSchema>;

export const CurrencyEditRootSchema = Type.Object({
  item:    CurrencyItemSchema,
  options: Type.Object({}),
});
export type CurrencyEditRoot = Static<typeof CurrencyEditRootSchema>;

export const CurrencyRowSchema = Type.Object({
  id:          Type.String({ "x-db-type": "bigint" }),
  code:        Type.String(),
  name:        Type.String(),
  numericCode: Type.Optional(Type.String()),
  symbol:      Type.Optional(Type.String()),
  isDeleted:    Type.Optional(Type.Boolean()),
});
export type CurrencyRow = Static<typeof CurrencyRowSchema>;

export const CurrencyLookupRowSchema = Type.Object({
  id:   Type.String({ "x-db-type": "bigint" }),
  code: Type.String(),
  name: Type.String(),
});
export type CurrencyLookupRow = Static<typeof CurrencyLookupRowSchema>;

export const CurrencyListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([Type.Literal("code"), Type.Literal("name")])),
  sortDir:  Type.Optional(SortDirSchema),
});
export type CurrencyListPayload = Static<typeof CurrencyListPayloadSchema>;

export const CurrencyLookupPayloadSchema = Type.Object({
  search: Type.Optional(Type.String()),
  limit:  Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});
export type CurrencyLookupPayload = Static<typeof CurrencyLookupPayloadSchema>;
