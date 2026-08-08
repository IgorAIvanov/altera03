import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

// ── 1. Item — форма редагування та payload для save ───────────────────────────

export const ChartOfAccountItemSchema = Type.Object({
  id:   Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  code: Type.String({
    title: "Рахунок", minLength: 1, maxLength: 10,
    "x-form": { order: 1, width: "sm" },
    "x-list": { width: "6rem", sortable: true },
    "x-lookup": true,
    "x-search": true,
  }),
  name: Type.String({
    title: "Найменування", minLength: 1, maxLength: 500,
    "x-form": { order: 2, width: "full" },
    "x-list": { sortable: true },
    "x-lookup": true,
    "x-search": true,
  }),
  accountType: Type.Union([
    Type.Literal("active"),
    Type.Literal("passive"),
    Type.Literal("active_passive"),
  ], {
    title: "Вид рахунку", default: "active",
    "x-form": { order: 3, width: "md" },
    "x-list": { width: "8rem" },
  }),
  // Ієрархія по коду, а не по id: субрахунок 361 належить рахунку 36.
  parentCode: Type.Optional(Type.String({
    title: "Належить рахунку", maxLength: 10,
    "x-form": { order: 4, width: "sm" },
    "x-list": { width: "6rem" },
  })),
  isGroup: Type.Optional(Type.Boolean({
    title: "Група (рахунок вищого рівня)", default: false,
    "x-form": { order: 5 },
  })),
  isOffBalance: Type.Optional(Type.Boolean({
    title: "Позабалансовий", default: false,
    "x-form": { order: 6 },
  })),
  isCurrency: Type.Optional(Type.Boolean({
    title: "Валютний облік", default: false,
    "x-form": { order: 7 },
  })),
  isQuantitative: Type.Optional(Type.Boolean({
    title: "Кількісний облік", default: false,
    "x-form": { order: 8 },
  })),
  isDeleted: Type.Optional(Type.Boolean({ title: "Позначено на видалення", default: false })),
  sortOrder: Type.Optional(Type.Number({ title: "Порядок", "x-db-type": "int", default: 0 })),
});
export type ChartOfAccountItem = Static<typeof ChartOfAccountItemSchema>;

// ── 2. Row — рядок списку ─────────────────────────────────────────────────────

export const ChartOfAccountRowSchema = Type.Object({
  id:          Type.String({ "x-db-type": "bigint" }),
  code:        Type.String(),
  name:        Type.String(),
  accountType: Type.String(),
  parentCode:  Type.Optional(Type.String()),
  isGroup:     Type.Optional(Type.Boolean()),
  isCurrency:  Type.Optional(Type.Boolean()),
  isDeleted:    Type.Optional(Type.Boolean()),
});
export type ChartOfAccountRow = Static<typeof ChartOfAccountRowSchema>;

// ── 3. LookupRow — рядок пікера ───────────────────────────────────────────────

export const ChartOfAccountLookupRowSchema = Type.Object({
  id:   Type.String({ "x-db-type": "bigint" }),
  code: Type.String(),
  name: Type.String(),
});
export type ChartOfAccountLookupRow = Static<typeof ChartOfAccountLookupRowSchema>;

// ── 4. Payload schemas ────────────────────────────────────────────────────────

export const ChartOfAccountListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([
              Type.Literal("code"),
              Type.Literal("name"),
            ])),
  sortDir:  Type.Optional(SortDirSchema),
});
export type ChartOfAccountListPayload = Static<typeof ChartOfAccountListPayloadSchema>;

export const ChartOfAccountGetPayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type ChartOfAccountGetPayload = Static<typeof ChartOfAccountGetPayloadSchema>;

export const ChartOfAccountSavePayloadSchema = Type.Object({
  item: ChartOfAccountItemSchema,
});
export type ChartOfAccountSavePayload = Static<typeof ChartOfAccountSavePayloadSchema>;

export const ChartOfAccountDeletePayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type ChartOfAccountDeletePayload = Static<typeof ChartOfAccountDeletePayloadSchema>;

export const ChartOfAccountLookupPayloadSchema = Type.Object({
  search: Type.Optional(Type.String()),
  limit:  Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});
export type ChartOfAccountLookupPayload = Static<typeof ChartOfAccountLookupPayloadSchema>;

// ── 5. Response data shapes ───────────────────────────────────────────────────

export const ChartOfAccountListDataSchema = Type.Object({
  rows: Type.Array(ChartOfAccountRowSchema),
  totals: Type.Object({
    count:    Type.Number(),
    page:     Type.Number(),
    pageSize: Type.Number(),
  }),
});
export type ChartOfAccountListData = Static<typeof ChartOfAccountListDataSchema>;

export const ChartOfAccountGetDataSchema = Type.Object({
  item:    Type.Union([ChartOfAccountItemSchema, Type.Null()]),
  options: Type.Object({}),
});
export type ChartOfAccountGetData = Static<typeof ChartOfAccountGetDataSchema>;

export const ChartOfAccountSaveDataSchema = Type.Object({
  item: Type.Union([ChartOfAccountItemSchema, Type.Null()]),
});
export type ChartOfAccountSaveData = Static<typeof ChartOfAccountSaveDataSchema>;

export const ChartOfAccountLookupDataSchema = Type.Object({
  rows: Type.Array(ChartOfAccountLookupRowSchema),
});
export type ChartOfAccountLookupData = Static<typeof ChartOfAccountLookupDataSchema>;

// ── 6. Root schema — дзеркало `data` форми редагування ($root) ────────────────

export const ChartOfAccountEditRootSchema = Type.Object({
  item:    ChartOfAccountItemSchema,
  options: Type.Object({}),
});
export type ChartOfAccountEditRoot = Static<typeof ChartOfAccountEditRootSchema>;
