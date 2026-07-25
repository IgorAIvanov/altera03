import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

// ── 1. Пункт меню — рядок табличної частини форми ─────────────────────────────

/**
 * Батько задається `parentCode`, а не id: у формі пункт може бути щойно
 * доданим і ще не мати id, а прив'язати до нього дочірній треба одразу.
 * Тому `code` унікальний у межах меню — це перевіряє `menu_save`.
 */
export const MenuEntrySchema = Type.Object({
  id:         Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  parentCode: Type.Union([Type.String(), Type.Null()], { title: "Батьківський", default: null }),
  code:       Type.String({ title: "Код", minLength: 1, maxLength: 100, default: "" }),
  name:       Type.String({ title: "Назва", minLength: 1, maxLength: 255, default: "" }),
  iconKey:    Type.Union([Type.String(), Type.Null()], { title: "Іконка", default: null }),
  routePath:  Type.Union([Type.String(), Type.Null()], { title: "Маршрут", default: null }),
  sortOrder:  Type.Number({ title: "Порядок", default: 0 }),
  isActive:   Type.Boolean({ title: "Активний", default: true }),
});
export type MenuEntry = Static<typeof MenuEntrySchema>;

// ── 2. Item — форма редагування та payload для save ───────────────────────────

export const MenuFormItemSchema = Type.Object({
  id:   Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  code: Type.String({
    title: "Код", minLength: 1, maxLength: 100,
    "x-form": { order: 1, width: "sm" },
    "x-list": { width: "sm", sortable: true },
    "x-search": true,
  }),
  name: Type.String({
    title: "Назва", minLength: 1, maxLength: 255,
    "x-form": { order: 2, width: "full" },
    "x-list": { sortable: true },
    "x-lookup": true,
    "x-search": true,
  }),
  isActive: Type.Boolean({ title: "Активне", default: true }),
  /** Групи, яким призначене меню. Повний стан, а не дельта. */
  groupIds: Type.Array(Type.String({ "x-db-type": "bigint" }), { default: [] }),
  /** Пункти меню. Теж повний стан: чого немає в масиві — видаляється. */
  entries:  Type.Array(MenuEntrySchema, { default: [] }),
});
export type MenuFormItem = Static<typeof MenuFormItemSchema>;

// ── 3. Row — рядок списку ─────────────────────────────────────────────────────

export const MenuRowSchema = Type.Object({
  id:         Type.String({ "x-db-type": "bigint" }),
  code:       Type.String(),
  name:       Type.String(),
  isActive:   Type.Boolean(),
  itemCount:  Type.Number(),
  groupCount: Type.Number(),
});
export type MenuListRow = Static<typeof MenuRowSchema>;

// ── 4. LookupRow ──────────────────────────────────────────────────────────────

export const MenuLookupRowSchema = Type.Object({
  id:   Type.String({ "x-db-type": "bigint" }),
  name: Type.String(),
});
export type MenuLookupRow = Static<typeof MenuLookupRowSchema>;

// ── 5. Payload schemas ────────────────────────────────────────────────────────

export const MenuListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([
              Type.Literal("code"),
              Type.Literal("name"),
              Type.Literal("itemCount"),
              Type.Literal("groupCount"),
            ])),
  sortDir:  Type.Optional(SortDirSchema),
});
export type MenuListPayload = Static<typeof MenuListPayloadSchema>;

export const MenuGetPayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type MenuGetPayload = Static<typeof MenuGetPayloadSchema>;

export const MenuSavePayloadSchema = Type.Object({
  item: MenuFormItemSchema,
});
export type MenuSavePayload = Static<typeof MenuSavePayloadSchema>;

export const MenuDeletePayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type MenuDeletePayload = Static<typeof MenuDeletePayloadSchema>;

// ── 6. Root schema — дзеркало `data` форми редагування ($root) ────────────────

export const MenuGroupOptionSchema = Type.Object({
  id:   Type.String({ "x-db-type": "bigint" }),
  name: Type.String(),
});
export type MenuGroupOption = Static<typeof MenuGroupOptionSchema>;

export const MenuEditRootSchema = Type.Object({
  item: MenuFormItemSchema,
  options: Type.Object({
    groups: Type.Array(MenuGroupOptionSchema, { default: [] }),
  }),
});
export type MenuEditRoot = Static<typeof MenuEditRootSchema>;
