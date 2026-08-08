import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

// ── Item ──────────────────────────────────────────────────────────────────────

export const CounterpartyItemSchema = Type.Object({
  id:   Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint" }),
  code: Type.String({
    title: "Код", minLength: 1, maxLength: 20,
    "x-list": { sortable: true },
    "x-search": true,
  }),
  name: Type.String({
    title: "Найменування", minLength: 1, maxLength: 200,
    "x-list": { sortable: true },
    "x-lookup": true,
    "x-search": true,
  }),
  isDeleted: Type.Optional(Type.Boolean({ title: "Позначено на видалення", default: false })),
});
export type CounterpartyItem = Static<typeof CounterpartyItemSchema>;

/** `$root` форми редагування: `item` (дані) + `options`. */
export const CounterpartyEditRootSchema = Type.Object({
  item:    CounterpartyItemSchema,
  options: Type.Object({}),
});
export type CounterpartyEditRoot = Static<typeof CounterpartyEditRootSchema>;

// ── Row ───────────────────────────────────────────────────────────────────────

export const CounterpartyRowSchema = Type.Object({
  id:       Type.String({ "x-db-type": "bigint" }),
  code:     Type.String(),
  name:     Type.String(),
  isDeleted: Type.Optional(Type.Boolean()),
});
export type CounterpartyRow = Static<typeof CounterpartyRowSchema>;

// ── LookupRow ─────────────────────────────────────────────────────────────────

export const CounterpartyLookupRowSchema = Type.Object({
  id:   Type.String({ "x-db-type": "bigint" }),
  name: Type.String(),
});
export type CounterpartyLookupRow = Static<typeof CounterpartyLookupRowSchema>;

// ── Payloads ──────────────────────────────────────────────────────────────────

export const CounterpartyListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([Type.Literal("code"), Type.Literal("name")])),
  sortDir:  Type.Optional(SortDirSchema),
});
export type CounterpartyListPayload = Static<typeof CounterpartyListPayloadSchema>;
