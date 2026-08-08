// Спільні TypeBox-контракти фреймворку (список, сортування, шапка документа).
// Живуть у пакеті `client`, а не в застосунку: їх використовує `ModelListBase`,
// а застосунок імпортує їх звідси через `@client/shared/schema.ts` — напрям
// app → client дозволений, тоді як client → app (як було, поки файл лежав у
// app/shared) — порушення межі, яке `check:deps` тепер ловить.
import {
  type Static,
  type TBoolean,
  type TLiteral,
  type TNull,
  type TNumber,
  type TObject,
  type TOptional,
  type TString,
  type TUnion,
  Type,
} from "@sinclair/typebox";

// Типи схем виписані явно, хоч TypeBox і виводить їх сам. Причина зовнішня:
// JSR не приймає виведені типи в публічному API — пакет пішов би «повільними
// типами», без .d.ts і з важчою перевіркою в споживача. Розсинхрон із
// значенням неможливий: анотація не збігається з Type.Object() — помилка
// компіляції, а не тихий дрейф.

/** Напрям сортування — тип поля sortDir у QuerySchema. */
type TSortDir = TUnion<[TLiteral<"asc">, TLiteral<"desc">]>;

export const SortDirSchema: TSortDir = Type.Union([Type.Literal("asc"), Type.Literal("desc")]);
export type SortDir = Static<typeof SortDirSchema>;

/**
 * Службове поле `$query` контейнера `$root` — стан фільтра списку.
 * Двонаправлене: клієнт шле його як payload, БД може повернути ефективний
 * (нормалізований) варіант, який дзеркалиться назад через assign().
 * Дефолти через `default` → Value.Create засіває стан ще до першого запиту.
 */
export const QuerySchema: TObject<{
  search: TString;
  page: TNumber;
  pageSize: TNumber;
  sortBy: TString;
  sortDir: TSortDir;
}> = Type.Object({
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
export const DocumentHeaderSchema: TObject<{
  id: TUnion<[TString, TNull]>;
  organizationId: TString;
  number: TOptional<TString>;
  docDate: TString;
  total: TOptional<TNumber>;
  presentation: TOptional<TString>;
  description: TOptional<TString>;
  isPosted: TOptional<TBoolean>;
  isDeleted: TOptional<TBoolean>;
}> = Type.Object({
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
    // Період — фільтр номер один у будь-якому журналі документів, тож генератор
    // розбирає `dateFrom`/`dateTo` в кожному `_list` документа. Саме такі імена
    // віддає `<ui-period>`. Це лише МОЖЛИВІСТЬ: доки екран не намалює панель,
    // ключів у payload немає і відбір не змінюється.
    "x-filter": { op: "range", key: "date" },
  }),
  total: Type.Optional(Type.Number({ title: "Сума", "x-db-type": "numeric", default: 0 })),
  // Рядок для журналу й списків посилань. Заповнює документ при записі;
  // порожній рядок замість null — колонка not null.
  presentation: Type.Optional(Type.String({ title: "Представлення", default: "", "x-search": true })),
  description: Type.Optional(Type.String({ title: "Коментар" })),
  isPosted: Type.Optional(Type.Boolean({ title: "Проведено", default: false, "x-filter": true })),
  isDeleted: Type.Optional(Type.Boolean({ title: "Позначено на видалення", default: false })),
});
export type DocumentHeader = Static<typeof DocumentHeaderSchema>;

/** Підсумки списку (лічильник + ехо пагінації від БД). */
export const TotalsSchema: TObject<{
  count: TNumber;
  page: TNumber;
  pageSize: TNumber;
}> = Type.Object({
  count:    Type.Number({ default: 0 }),
  page:     Type.Number({ default: 1 }),
  pageSize: Type.Number({ default: 20 }),
});
export type Totals = Static<typeof TotalsSchema>;
