import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

// ── 1. Item — форма редагування та payload для save ───────────────────────────
//
// Еталон поля-секрету. `token` позначений `x-secret`: колонки під нього немає
// (генератор його пропускає), рантайм вилучає його з `save` і тримає
// зашифрованим в `app.secret`. Значення в моделі — НАМІР: відсутнє чи `""` —
// не змінювати, рядок — записати, `null` — очистити. У відповідь рантайм
// дописує `tokenSet` і `tokenChangedAt`, а самого токена не віддає ніколи.

export const ExternalServiceItemSchema = Type.Object({
  id:   Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  name: Type.String({
    title: "Назва", minLength: 1, maxLength: 200,
    "x-list": { sortable: true },
    "x-lookup": true,
    "x-search": true,
  }),
  url:   Type.Optional(Type.String({ title: "Адреса API", maxLength: 500 })),
  login: Type.Optional(Type.String({ title: "Логін", maxLength: 200 })),
  token: Type.Optional(Type.Union([Type.String(), Type.Null()], { title: "Токен", "x-secret": true })),
  tokenSet:       Type.Optional(Type.Boolean({ "x-transient": true })),
  tokenChangedAt: Type.Optional(Type.Union([Type.String(), Type.Null()], { "x-transient": true })),
  isDeleted: Type.Optional(Type.Boolean({ title: "Позначено на видалення", default: false })),
});
export type ExternalServiceItem = Static<typeof ExternalServiceItemSchema>;

// ── 2. Row — рядок списку ─────────────────────────────────────────────────────

export const ExternalServiceRowSchema = Type.Object({
  id:        Type.String({ "x-db-type": "bigint" }),
  name:      Type.String(),
  url:       Type.Optional(Type.Union([Type.String(), Type.Null()])),
  isDeleted: Type.Optional(Type.Boolean()),
});
export type ExternalServiceRow = Static<typeof ExternalServiceRowSchema>;

// ── 3. LookupRow — рядок пікера ───────────────────────────────────────────────

export const ExternalServiceLookupRowSchema = Type.Object({
  id:   Type.String({ "x-db-type": "bigint" }),
  name: Type.String(),
});
export type ExternalServiceLookupRow = Static<typeof ExternalServiceLookupRowSchema>;

// ── 4. Payload schemas ────────────────────────────────────────────────────────

export const ExternalServiceListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Literal("name")),
  sortDir:  Type.Optional(SortDirSchema),
});
export type ExternalServiceListPayload = Static<typeof ExternalServiceListPayloadSchema>;

export const ExternalServiceGetPayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type ExternalServiceGetPayload = Static<typeof ExternalServiceGetPayloadSchema>;

export const ExternalServiceSavePayloadSchema = Type.Object({
  item: ExternalServiceItemSchema,
});
export type ExternalServiceSavePayload = Static<typeof ExternalServiceSavePayloadSchema>;

export const ExternalServiceDeletePayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type ExternalServiceDeletePayload = Static<typeof ExternalServiceDeletePayloadSchema>;

export const ExternalServiceLookupPayloadSchema = Type.Object({
  search: Type.Optional(Type.String()),
  limit:  Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});
export type ExternalServiceLookupPayload = Static<typeof ExternalServiceLookupPayloadSchema>;

// ── 5. Root schema — дзеркало `data` форми редагування ($root) ────────────────

export const ExternalServiceEditRootSchema = Type.Object({
  item:    ExternalServiceItemSchema,
  options: Type.Object({}),
});
export type ExternalServiceEditRoot = Static<typeof ExternalServiceEditRootSchema>;
