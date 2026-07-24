import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";
import type { PrintTemplateBlock } from "../../../server/modules/print/print-template.ts";

// ── 1. Item — реквізити шаблону + сам блочний документ ────────────────────────

/**
 * `schema` — блочний документ шаблону (`schemaVersion: 2`). Для TypeBox це
 * непрозорий об'єкт: його форму описує і нормалізує
 * `server/modules/print/print-template.ts`, а не JSON Schema. Тут потрібен лише
 * валідний початковий стан для `Value.Create` — порожній список блоків.
 */
export const PrintTemplateDocumentSchema = Type.Object({
  schemaVersion: Type.Literal(2, { default: 2 }),
  blocks: Type.Array(Type.Unknown(), { default: [] }),
});

export const PrintTemplateItemSchema = Type.Object({
  id: Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  code: Type.String({
    title: "Код", minLength: 1, maxLength: 80, default: "",
    "x-list": { width: "sm", sortable: true },
    "x-search": true,
  }),
  name: Type.String({
    title: "Назва", minLength: 1, maxLength: 250, default: "",
    "x-list": { sortable: true },
    "x-lookup": true,
    "x-search": true,
  }),
  /** Модель, для якої друкується форма, напр. `"invoice"`. */
  targetModel: Type.String({
    title: "Модель", maxLength: 80, default: "",
    "x-list": { width: "sm", sortable: true },
  }),
  /** Команда моделі, що повертає дані друку в `data.item`. */
  dataCommand: Type.String({ title: "Команда даних", maxLength: 80, default: "get" }),
  paperSize: Type.Literal("A4", { title: "Формат", default: "A4" }),
  orientation: Type.Union([Type.Literal("portrait"), Type.Literal("landscape")], {
    title: "Орієнтація", default: "portrait",
  }),
  isDefault: Type.Boolean({ title: "За замовчуванням", default: false }),
  isActive: Type.Boolean({ title: "Активний", default: true }),
  schema: PrintTemplateDocumentSchema,
});
export type PrintTemplateItem = Omit<Static<typeof PrintTemplateItemSchema>, "schema"> & {
  schema: { schemaVersion: 2; blocks: PrintTemplateBlock[] };
};

// ── 2. Row — рядок списку ─────────────────────────────────────────────────────

export const PrintTemplateRowSchema = Type.Object({
  id:          Type.String({ "x-db-type": "bigint" }),
  code:        Type.String(),
  name:        Type.String(),
  targetModel: Type.String(),
  dataCommand: Type.String(),
  paperSize:   Type.String(),
  orientation: Type.String(),
  isDefault:   Type.Boolean(),
  isActive:    Type.Boolean(),
});
export type PrintTemplateRow = Static<typeof PrintTemplateRowSchema>;

// ── 3. LookupRow — рядок пікера ───────────────────────────────────────────────

export const PrintTemplateLookupRowSchema = Type.Object({
  id:   Type.String({ "x-db-type": "bigint" }),
  name: Type.String(),
  code: Type.String(),
});
export type PrintTemplateLookupRow = Static<typeof PrintTemplateLookupRowSchema>;

// ── 4. Payload schemas ────────────────────────────────────────────────────────

export const PrintTemplateListPayloadSchema = Type.Object({
  search:      Type.Optional(Type.String()),
  targetModel: Type.Optional(Type.String()),
  page:        Type.Optional(Type.Number({ minimum: 1 })),
  pageSize:    Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:      Type.Optional(Type.Union([
                 Type.Literal("code"),
                 Type.Literal("name"),
                 Type.Literal("targetModel"),
                 Type.Literal("isDefault"),
                 Type.Literal("isActive"),
               ])),
  sortDir:     Type.Optional(SortDirSchema),
});
export type PrintTemplateListPayload = Static<typeof PrintTemplateListPayloadSchema>;

export const PrintTemplateGetPayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type PrintTemplateGetPayload = Static<typeof PrintTemplateGetPayloadSchema>;

export const PrintTemplateSavePayloadSchema = Type.Object({
  item: PrintTemplateItemSchema,
});

export const PrintTemplateDeletePayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});

export const PrintTemplateLookupPayloadSchema = Type.Object({
  search:      Type.Optional(Type.String()),
  targetModel: Type.Optional(Type.String()),
  limit:       Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});

/** Payload `print_template_resolve` — вхід підбору шаблону для друку. */
export const PrintTemplateResolvePayloadSchema = Type.Object({
  targetModel:  Type.String(),
  templateCode: Type.Optional(Type.String()),
});
export type PrintTemplateResolvePayload = Static<typeof PrintTemplateResolvePayloadSchema>;

// ── 5. Root schema — дзеркало `data` форми редагування ($root) ────────────────

/** Довідник значень для випадайок форми (список уже використаних моделей). */
export const PrintTemplateOptionsSchema = Type.Object({
  targetModels: Type.Array(
    Type.Object({ value: Type.String(), label: Type.String() }),
    { default: [] },
  ),
});

export const PrintTemplateEditRootSchema = Type.Object({
  item:    PrintTemplateItemSchema,
  options: PrintTemplateOptionsSchema,
});
export type PrintTemplateEditRoot = {
  item: PrintTemplateItem;
  options: Static<typeof PrintTemplateOptionsSchema>;
};
