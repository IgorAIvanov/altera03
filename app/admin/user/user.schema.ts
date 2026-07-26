import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

// ── 1. Item ───────────────────────────────────────────────────────────────────

/**
 * Пароля тут немає свідомо: `app.user_save` його не приймає взагалі. Хеш
 * рахує TS (PBKDF2-SHA256), тож пароль ходить окремою командою `setPassword` —
 * так схема хешування лишається в одному місці.
 */
/**
 * Зв'язка користувача із зовнішнім провайдером входу.
 *
 * `externalId` — стабільний ідентифікатор у провайдера (OIDC `sub`), а не
 * e-mail: e-mail міняють, і зв'язка тихо переїхала б на іншу людину. Решта
 * полів довідкові — їх заповнює сам вхід.
 */
export const UserIdentitySchema = Type.Object({
  id:         Type.Optional(Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint" })),
  provider:   Type.String({ title: "Провайдер", minLength: 1, maxLength: 50 }),
  externalId: Type.String({ title: "Зовнішній ідентифікатор", minLength: 1, maxLength: 255 }),
  email:       Type.Optional(Type.Union([Type.String(), Type.Null()])),
  displayName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  lastLoginAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
export type UserIdentity = Static<typeof UserIdentitySchema>;

export const UserItemSchema = Type.Object({
  id:    Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  login: Type.String({
    title: "Логін", minLength: 1, maxLength: 100,
    "x-form": { order: 1, width: "sm" },
    "x-list": { width: "sm", sortable: true },
    "x-search": true,
  }),
  fullName: Type.String({
    title: "Повне ім'я", minLength: 1, maxLength: 255,
    "x-form": { order: 2, width: "full" },
    "x-list": { sortable: true },
    "x-lookup": true,
    "x-search": true,
  }),
  isActive: Type.Boolean({ title: "Активний", default: true }),
  /** Групи користувача. Повний стан, а не дельта. */
  groupIds: Type.Array(Type.String({ "x-db-type": "bigint" }), { default: [] }),
  /**
   * Зв'язки із зовнішніми провайдерами входу. Теж повний стан.
   *
   * Без рядка тут зовнішній вхід не пускає нікого: провайдер підтверджує, що
   * людина та сама, але не те, що їй у цій системі щось можна.
   */
  identities: Type.Array(UserIdentitySchema, { default: [] }),
});
export type UserItem = Static<typeof UserItemSchema>;

// ── 2. Row ────────────────────────────────────────────────────────────────────

export const UserRowSchema = Type.Object({
  id:         Type.String({ "x-db-type": "bigint" }),
  login:      Type.String(),
  fullName:   Type.String(),
  isActive:   Type.Boolean(),
  groupCount: Type.Number(),
});
export type UserRow = Static<typeof UserRowSchema>;

// ── 3. LookupRow ──────────────────────────────────────────────────────────────

export const UserLookupRowSchema = Type.Object({
  id:   Type.String({ "x-db-type": "bigint" }),
  name: Type.String(),
});
export type UserLookupRow = Static<typeof UserLookupRowSchema>;

// ── 4. Payload schemas ────────────────────────────────────────────────────────

export const UserListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([
              Type.Literal("login"),
              Type.Literal("fullName"),
              Type.Literal("isActive"),
            ])),
  sortDir:  Type.Optional(SortDirSchema),
});
export type UserListPayload = Static<typeof UserListPayloadSchema>;

export const UserGetPayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type UserGetPayload = Static<typeof UserGetPayloadSchema>;

export const UserSavePayloadSchema = Type.Object({
  item: UserItemSchema,
});
export type UserSavePayload = Static<typeof UserSavePayloadSchema>;

export const UserDeletePayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type UserDeletePayload = Static<typeof UserDeletePayloadSchema>;

/** Payload команди `setPassword` (TS-команда, див. db/user.commands.ts). */
export const UserSetPasswordPayloadSchema = Type.Object({
  id:       Type.String({ "x-db-type": "bigint" }),
  password: Type.String({ minLength: 8 }),
});
export type UserSetPasswordPayload = Static<typeof UserSetPasswordPayloadSchema>;

// ── 5. Root schema ────────────────────────────────────────────────────────────

export const UserGroupOptionSchema = Type.Object({
  id:   Type.String({ "x-db-type": "bigint" }),
  name: Type.String(),
});
export type UserGroupOption = Static<typeof UserGroupOptionSchema>;

export const UserEditRootSchema = Type.Object({
  item: UserItemSchema,
  options: Type.Object({
    groups: Type.Array(UserGroupOptionSchema, { default: [] }),
  }),
});
export type UserEditRoot = Static<typeof UserEditRootSchema>;
