// Схема демо-довідника «Контрагенти» — єдине джерело типів для форми, списку,
// пікера і генератора SQL. Анотації `x-*` читає саме генератор:
//   x-search  — поле бере участь у пошуку `ilike`;
//   x-lookup  — поле потрапляє в рядок пікера;
//   x-db-type — тип колонки, якщо він не виводиться з TypeBox (bigint → string).
import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

// ── Item — форма редагування та payload для save ──────────────────────────────

export const CounterpartyItemSchema = Type.Object({
  id: Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  code: Type.String({
    title: "Код", minLength: 1, maxLength: 20,
    "x-form": { order: 1, width: "sm" },
    "x-list": { width: "sm", sortable: true },
    "x-search": true,
  }),
  name: Type.String({
    title: "Найменування", minLength: 1, maxLength: 200,
    "x-form": { order: 2, width: "full" },
    "x-list": { sortable: true },
    "x-lookup": true,
    "x-search": true,
  }),
  edrpou: Type.Optional(Type.String({
    title: "ЄДРПОУ", maxLength: 10,
    "x-form": { order: 3, width: "sm" },
    "x-list": { width: "8rem", sortable: true },
    "x-lookup": true,
    "x-search": true,
  })),
  isActive: Type.Optional(Type.Boolean({ title: "Активний", default: true })),
});
export type CounterpartyItem = Static<typeof CounterpartyItemSchema>;

// ── Row — рядок списку ────────────────────────────────────────────────────────

export const CounterpartyRowSchema = Type.Object({
  id:       Type.String({ "x-db-type": "bigint" }),
  code:     Type.String(),
  name:     Type.String(),
  edrpou:   Type.Optional(Type.String()),
  isActive: Type.Optional(Type.Boolean()),
});
export type CounterpartyRow = Static<typeof CounterpartyRowSchema>;

// ── LookupRow — рядок пікера ──────────────────────────────────────────────────

export const CounterpartyLookupRowSchema = Type.Object({
  id:     Type.String({ "x-db-type": "bigint" }),
  name:   Type.String(),
  edrpou: Type.Optional(Type.String()),
});
export type CounterpartyLookupRow = Static<typeof CounterpartyLookupRowSchema>;

// ── Payload ───────────────────────────────────────────────────────────────────

export const CounterpartyListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([
              Type.Literal("code"),
              Type.Literal("name"),
              Type.Literal("edrpou"),
            ])),
  sortDir:  Type.Optional(SortDirSchema),
});
export type CounterpartyListPayload = Static<typeof CounterpartyListPayloadSchema>;

export const CounterpartyGetPayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type CounterpartyGetPayload = Static<typeof CounterpartyGetPayloadSchema>;

export const CounterpartySavePayloadSchema = Type.Object({
  item: CounterpartyItemSchema,
});
export type CounterpartySavePayload = Static<typeof CounterpartySavePayloadSchema>;

export const CounterpartyDeletePayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type CounterpartyDeletePayload = Static<typeof CounterpartyDeletePayloadSchema>;

export const CounterpartyLookupPayloadSchema = Type.Object({
  search: Type.Optional(Type.String()),
  limit:  Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});
export type CounterpartyLookupPayload = Static<typeof CounterpartyLookupPayloadSchema>;

// ── Відповіді ─────────────────────────────────────────────────────────────────

export const CounterpartyListDataSchema = Type.Object({
  rows: Type.Array(CounterpartyRowSchema),
  totals: Type.Object({
    count:    Type.Number(),
    page:     Type.Number(),
    pageSize: Type.Number(),
  }),
});
export type CounterpartyListData = Static<typeof CounterpartyListDataSchema>;

export const CounterpartyGetDataSchema = Type.Object({
  item:    Type.Union([CounterpartyItemSchema, Type.Null()]),
  options: Type.Object({}),
});
export type CounterpartyGetData = Static<typeof CounterpartyGetDataSchema>;

export const CounterpartyLookupDataSchema = Type.Object({
  rows: Type.Array(CounterpartyLookupRowSchema),
});
export type CounterpartyLookupData = Static<typeof CounterpartyLookupDataSchema>;

// ── Root — дзеркало `data` форми редагування ($root) ──────────────────────────

/** `$root` форми редагування: `item` (дані) + `options`. */
export const CounterpartyEditRootSchema = Type.Object({
  item:    CounterpartyItemSchema,
  options: Type.Object({}),
});
export type CounterpartyEditRoot = Static<typeof CounterpartyEditRootSchema>;
