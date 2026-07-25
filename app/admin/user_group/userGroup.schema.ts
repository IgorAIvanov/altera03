import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

// ── 1. Item ───────────────────────────────────────────────────────────────────

/** Учасник групи. Ім'я їде разом з id, щоб форма не робила окремий lookup. */
export const UserGroupMemberSchema = Type.Object({
  id:   Type.String({ "x-db-type": "bigint" }),
  name: Type.String(),
});
export type UserGroupMember = Static<typeof UserGroupMemberSchema>;

export const UserGroupItemSchema = Type.Object({
  id:   Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  code: Type.String({
    title: "Код", minLength: 1, maxLength: 50,
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
  isActive: Type.Boolean({ title: "Активна", default: true }),
  /**
   * Меню групи й склад учасників. Обидва — повний стан, як і `rows` з правами.
   *
   * У ядрі цих полів немає: `app.user_group_menu` належить застосунку, тому
   * `get`/`save` цієї моделі підмінені на `user_group_get_ext`/`_save_ext`
   * (див. manifest.json і db/user_group.sql).
   */
  menuIds: Type.Array(Type.String({ "x-db-type": "bigint" }), { default: [] }),
  members: Type.Array(UserGroupMemberSchema, { default: [] }),
});
export type UserGroupItem = Static<typeof UserGroupItemSchema>;

// ── 2. Право — рядок табличної частини ────────────────────────────────────────

/**
 * Право — трійка «група → модель → дія». `model = '*'` означає всі моделі.
 * Ім'я моделі те саме, що в manifest.json і в ModelRuntimeService.execute().
 */
export const UserGroupPermissionSchema = Type.Object({
  id:        Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  model:     Type.String({ title: "Модель", minLength: 1, default: "*" }),
  action:    Type.String({ title: "Дія", minLength: 1, default: "view" }),
  isAllowed: Type.Boolean({ title: "Дозволено", default: true }),
});
export type UserGroupPermission = Static<typeof UserGroupPermissionSchema>;

// ── 3. Row — рядок списку ─────────────────────────────────────────────────────

export const UserGroupRowSchema = Type.Object({
  id:              Type.String({ "x-db-type": "bigint" }),
  code:            Type.String(),
  name:            Type.String(),
  isActive:        Type.Boolean(),
  memberCount:     Type.Number(),
  permissionCount: Type.Number(),
});
export type UserGroupRow = Static<typeof UserGroupRowSchema>;

// ── 4. Payload schemas ────────────────────────────────────────────────────────

export const UserGroupListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([
              Type.Literal("code"),
              Type.Literal("name"),
            ])),
  sortDir:  Type.Optional(SortDirSchema),
});
export type UserGroupListPayload = Static<typeof UserGroupListPayloadSchema>;

export const UserGroupGetPayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type UserGroupGetPayload = Static<typeof UserGroupGetPayloadSchema>;

/**
 * `rows` лежить поряд з `item`, а не всередині: саме такий payload читає
 * `app.user_group_save`. Через це форма перевизначає `saveItem()` — стандартний
 * шле лише `item`, і права мовчки не зберігалися б.
 */
export const UserGroupSavePayloadSchema = Type.Object({
  item: UserGroupItemSchema,
  rows: Type.Array(UserGroupPermissionSchema),
});
export type UserGroupSavePayload = Static<typeof UserGroupSavePayloadSchema>;

export const UserGroupDeletePayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type UserGroupDeletePayload = Static<typeof UserGroupDeletePayloadSchema>;

// ── 5. Root schema ────────────────────────────────────────────────────────────

export const UserGroupActionOptionSchema = Type.Object({
  id:   Type.String(),
  name: Type.String(),
});
export type UserGroupActionOption = Static<typeof UserGroupActionOptionSchema>;

export const UserGroupMenuOptionSchema = Type.Object({
  id:   Type.String({ "x-db-type": "bigint" }),
  name: Type.String(),
});
export type UserGroupMenuOption = Static<typeof UserGroupMenuOptionSchema>;

export const UserGroupEditRootSchema = Type.Object({
  item: UserGroupItemSchema,
  rows: Type.Array(UserGroupPermissionSchema, { default: [] }),
  options: Type.Object({
    actions: Type.Array(UserGroupActionOptionSchema, { default: [] }),
    menus:   Type.Array(UserGroupMenuOptionSchema, { default: [] }),
  }),
});
export type UserGroupEditRoot = Static<typeof UserGroupEditRootSchema>;
