import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

// ── Item ──────────────────────────────────────────────────────────────────────

export const NomenclatureItemSchema = Type.Object({
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
  unit: Type.Optional(Type.String({ title: "Од. вим.", maxLength: 20 })),
  // Належність до групи (ієрархія). У формі не редагується — перенесення
  // робиться зі списку командою moveToGroup; поле тут, щоб save її не губив.
  groupId: Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  isDeleted: Type.Optional(Type.Boolean({ title: "Позначено на видалення", default: false })),
});
export type NomenclatureItem = Static<typeof NomenclatureItemSchema>;

/** `$root` форми редагування: `item` (дані) + `options`. */
export const NomenclatureEditRootSchema = Type.Object({
  item:    NomenclatureItemSchema,
  options: Type.Object({}),
});
export type NomenclatureEditRoot = Static<typeof NomenclatureEditRootSchema>;

// ── Row ───────────────────────────────────────────────────────────────────────

export const NomenclatureRowSchema = Type.Object({
  id:        Type.String({ "x-db-type": "bigint" }),
  code:      Type.String(),
  name:      Type.String(),
  unit:      Type.Optional(Type.String()),
  // Заповнює генератор list за конвенцією ієрархії (join таблиці груп).
  groupName: Type.Optional(Type.String()),
  isDeleted:  Type.Optional(Type.Boolean()),
});
export type NomenclatureRow = Static<typeof NomenclatureRowSchema>;

// ── LookupRow ─────────────────────────────────────────────────────────────────

export const NomenclatureLookupRowSchema = Type.Object({
  id:   Type.String({ "x-db-type": "bigint" }),
  name: Type.String(),
});
export type NomenclatureLookupRow = Static<typeof NomenclatureLookupRowSchema>;

// ── Payloads ──────────────────────────────────────────────────────────────────

export const NomenclatureListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([Type.Literal("code"), Type.Literal("name")])),
  sortDir:  Type.Optional(SortDirSchema),
  /** Відмічені групи дерева; фільтр включає підгрупи. Порожньо — весь список. */
  groupIds: Type.Optional(Type.Array(Type.String())),
});
export type NomenclatureListPayload = Static<typeof NomenclatureListPayloadSchema>;
