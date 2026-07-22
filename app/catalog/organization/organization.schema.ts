import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@shared/schema.ts";

// ── 1. Item — форма редагування та payload для save ───────────────────────────

export const OrganizationItemSchema = Type.Object({
  id:   Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  code: Type.String({
    title: "Код", minLength: 1, maxLength: 9,
    "x-form": { order: 1, width: "sm" },
    "x-list": { width: "8rem", sortable: true },
    "x-search": true,
  }),
  name: Type.String({
    title: "Назва", minLength: 1, maxLength: 150,
    "x-form": { order: 2, width: "full" },
    "x-list": { sortable: true },
    "x-lookup": true,
    "x-search": true,
  }),
  fullName: Type.Optional(Type.String({
    title: "Повна назва", maxLength: 500,
    "x-form": { order: 3, width: "full" },
  })),
  edrpou: Type.Optional(Type.String({
    title: "ЄДРПОУ", maxLength: 20,
    "x-form": { order: 4, width: "sm" },
    "x-list": { width: "9rem", sortable: true },
    "x-lookup": true,
    "x-search": true,
  })),
  // Підставляється в номер документа перед префіксом типу — див. doc_next_number.
  prefix: Type.Optional(Type.String({
    title: "Префікс", maxLength: 3,
    "x-form": { order: 5, width: "sm" },
  })),
  legalPersonKind: Type.Optional(Type.Union([
    Type.Literal("legal_entity"),
    Type.Literal("individual_entrepreneur"),
  ], { title: "Вид особи", default: "legal_entity", "x-form": { order: 6, width: "md" } })),
  // Логотип — вкладення (app.attachment). У колонці лежить id; `x-blob`
  // велить генератору віддавати поруч ключ доступу під ім'ям logoToken.
  logoId: Type.Optional(Type.Union([Type.String(), Type.Null()], {
    title: "Логотип", "x-db-type": "bigint", "x-blob": true, default: null,
  })),
  // Токен доступу до логотипа. Колонки під нього немає: значення підставляє
  // рантайм на кожен запит (воно різне в різних сесіях), тому — x-transient.
  logoToken: Type.Optional(Type.Union([Type.String(), Type.Null()], {
    "x-transient": true, default: null,
  })),
  isActive: Type.Optional(Type.Boolean({ title: "Активна", default: true })),
});
export type OrganizationItem = Static<typeof OrganizationItemSchema>;

// ── 2. Row — рядок списку ─────────────────────────────────────────────────────

export const OrganizationRowSchema = Type.Object({
  id:       Type.String({ "x-db-type": "bigint" }),
  code:     Type.String(),
  name:     Type.String(),
  edrpou:   Type.Optional(Type.String()),
  isActive: Type.Optional(Type.Boolean()),
});
export type OrganizationRow = Static<typeof OrganizationRowSchema>;

// ── 3. LookupRow — рядок пікера ───────────────────────────────────────────────

export const OrganizationLookupRowSchema = Type.Object({
  id:     Type.String({ "x-db-type": "bigint" }),
  name:   Type.String(),
  edrpou: Type.Optional(Type.String()),
});
export type OrganizationLookupRow = Static<typeof OrganizationLookupRowSchema>;

// ── 4. Payload schemas ────────────────────────────────────────────────────────

export const OrganizationListPayloadSchema = Type.Object({
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
export type OrganizationListPayload = Static<typeof OrganizationListPayloadSchema>;

export const OrganizationGetPayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type OrganizationGetPayload = Static<typeof OrganizationGetPayloadSchema>;

export const OrganizationSavePayloadSchema = Type.Object({
  item: OrganizationItemSchema,
});
export type OrganizationSavePayload = Static<typeof OrganizationSavePayloadSchema>;

export const OrganizationDeletePayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type OrganizationDeletePayload = Static<typeof OrganizationDeletePayloadSchema>;

export const OrganizationLookupPayloadSchema = Type.Object({
  search: Type.Optional(Type.String()),
  limit:  Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});
export type OrganizationLookupPayload = Static<typeof OrganizationLookupPayloadSchema>;

// ── 5. Response data shapes ───────────────────────────────────────────────────

export const OrganizationListDataSchema = Type.Object({
  rows: Type.Array(OrganizationRowSchema),
  totals: Type.Object({
    count:    Type.Number(),
    page:     Type.Number(),
    pageSize: Type.Number(),
  }),
});
export type OrganizationListData = Static<typeof OrganizationListDataSchema>;

export const OrganizationGetDataSchema = Type.Object({
  item:    Type.Union([OrganizationItemSchema, Type.Null()]),
  options: Type.Object({}),
});
export type OrganizationGetData = Static<typeof OrganizationGetDataSchema>;

export const OrganizationSaveDataSchema = Type.Object({
  item: Type.Union([OrganizationItemSchema, Type.Null()]),
});
export type OrganizationSaveData = Static<typeof OrganizationSaveDataSchema>;

export const OrganizationLookupDataSchema = Type.Object({
  rows: Type.Array(OrganizationLookupRowSchema),
});
export type OrganizationLookupData = Static<typeof OrganizationLookupDataSchema>;

// ── 6. Root schema — дзеркало `data` форми редагування ($root) ────────────────

export const OrganizationEditRootSchema = Type.Object({
  item:    OrganizationItemSchema,
  options: Type.Object({}),
});
export type OrganizationEditRoot = Static<typeof OrganizationEditRootSchema>;
