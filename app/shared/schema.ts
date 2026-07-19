import { Type, type Static } from "@sinclair/typebox";

export const OptionRowSchema = Type.Object({
  id:   Type.String(),
  name: Type.String(),
});
export type OptionRow = Static<typeof OptionRowSchema>;

export const PagePayloadSchema = Type.Object({
  page:     Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200, default: 50 })),
});
export type PagePayload = Static<typeof PagePayloadSchema>;

export const SortDirSchema = Type.Union([Type.Literal("asc"), Type.Literal("desc")]);
export type SortDir = Static<typeof SortDirSchema>;

/**
 * Службове поле `$query` контейнера `$root` — стан фільтра списку.
 * Двонаправлене: клієнт шле його як payload, БД може повернути ефективний
 * (нормалізований) варіант, який дзеркалиться назад через assign().
 * Дефолти через `default` → Value.Create засіває стан ще до першого запиту.
 */
export const QuerySchema = Type.Object({
  search:   Type.String({ default: "" }),
  page:     Type.Number({ minimum: 1, default: 1 }),
  pageSize: Type.Number({ minimum: 1, maximum: 200, default: 20 }),
  sortBy:   Type.String({ default: "" }),
  sortDir:  Type.Union([Type.Literal("asc"), Type.Literal("desc")], { default: "asc" }),
});
export type Query = Static<typeof QuerySchema>;

/** Підсумки списку (лічильник + ехо пагінації від БД). */
export const TotalsSchema = Type.Object({
  count:    Type.Number({ default: 0 }),
  page:     Type.Number({ default: 1 }),
  pageSize: Type.Number({ default: 20 }),
});
export type Totals = Static<typeof TotalsSchema>;
