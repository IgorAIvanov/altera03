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

/**
 * Спільна шапка документа — дзеркало app.document.
 *
 * Модель-документ НЕ описує ці поля у власній `<model>.schema.ts`: генератор
 * підмішує їх сам (див. scripts/generate-model-sql.ts), а `<Model>ItemSchema`
 * містить лише реквізити конкретного документа та його табличні частини.
 * На фронті шапка підключається через `Type.Composite`/`Type.Intersect` або
 * просто через `DocumentHeaderSchema` у Root-схемі форми.
 *
 * `number` порожній для нового документа — його підставить app.doc_next_number.
 */
export const DocumentHeaderSchema = Type.Object({
  id: Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  organizationId: Type.String({
    title: "Організація",
    "x-db-type": "bigint",
    "x-ref": { model: "organization", display: "name", as: "organization", sortable: true, searchable: true },
  }),
  number: Type.Optional(Type.String({
    title: "Номер", maxLength: 20,
    "x-list": { sortable: true },
    "x-search": true,
  })),
  docDate: Type.String({
    title: "Дата",
    "x-db-type": "timestamp",
    "x-list": { sortable: true },
  }),
  total: Type.Optional(Type.Number({ title: "Сума", "x-db-type": "numeric", default: 0 })),
  // Рядок для журналу й списків посилань. Заповнює документ при записі;
  // порожній рядок замість null — колонка not null.
  presentation: Type.Optional(Type.String({ title: "Представлення", default: "", "x-search": true })),
  description: Type.Optional(Type.String({ title: "Коментар" })),
  isPosted: Type.Optional(Type.Boolean({ title: "Проведено", default: false })),
  isDeleted: Type.Optional(Type.Boolean({ title: "Позначено на видалення", default: false })),
});
export type DocumentHeader = Static<typeof DocumentHeaderSchema>;

/** Підсумки списку (лічильник + ехо пагінації від БД). */
export const TotalsSchema = Type.Object({
  count:    Type.Number({ default: 0 }),
  page:     Type.Number({ default: 1 }),
  pageSize: Type.Number({ default: 20 }),
});
export type Totals = Static<typeof TotalsSchema>;
