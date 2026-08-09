import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

// Первинний ключ нумератора — КЛЮЧ МОДЕЛІ (app.numerator.model), тож `id` тут
// рядок із ім'ям моделі («invoice», «counterparty»), а не bigint. Для машинерії
// list/edit це нічого не міняє: id на клієнті завжди рядок.

// ── 1. Item — форма редагування та payload для save ───────────────────────────

export const NumeratorItemSchema = Type.Object({
  id:       Type.Union([Type.String(), Type.Null()], { default: null }),
  name:     Type.String({ title: "Назва", minLength: 1, maxLength: 255 }),
  template: Type.String({ title: "Шаблон", minLength: 1, maxLength: 50 }),
  period:   Type.String({ title: "Період", default: "none" }),
  strategy: Type.String({ title: "Стратегія", default: "counter" }),
  isEditable: Type.Optional(Type.Boolean({ title: "Дозволити ручний номер", default: true })),
  /** Модель — документ (має організацію й дату): вмикає вибір періоду. Читається, не пишеться. */
  isDocument: Type.Optional(Type.Boolean({ default: false })),
});
export type NumeratorItem = Static<typeof NumeratorItemSchema>;

// ── 2. Row — рядок списку ─────────────────────────────────────────────────────

export const NumeratorRowSchema = Type.Object({
  id:       Type.String(),
  name:     Type.String(),
  template: Type.String(),
  period:   Type.String(),
  strategy: Type.String(),
});
export type NumeratorRow = Static<typeof NumeratorRowSchema>;

// ── 3. Стан лічильника однієї області (rows у get/save) ───────────────────────

export const NumeratorStateRowSchema = Type.Object({
  scopeKey:  Type.String(),
  /** bigint → рядок, як і всі bigint назовні. */
  lastValue: Type.String(),
});
export type NumeratorStateRow = Static<typeof NumeratorStateRowSchema>;

// ── 4. Payload schemas ────────────────────────────────────────────────────────

export const NumeratorListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([
              Type.Literal("id"),
              Type.Literal("name"),
              Type.Literal("template"),
            ])),
  sortDir:  Type.Optional(SortDirSchema),
});
export type NumeratorListPayload = Static<typeof NumeratorListPayloadSchema>;

export const NumeratorGetPayloadSchema = Type.Object({
  id: Type.String(),
});
export type NumeratorGetPayload = Static<typeof NumeratorGetPayloadSchema>;

export const NumeratorSavePayloadSchema = Type.Object({
  item: NumeratorItemSchema,
});
export type NumeratorSavePayload = Static<typeof NumeratorSavePayloadSchema>;

// ── 5. Root schema — дзеркало `data` форми редагування ($root) ────────────────

/** `$root` форми: `item` + стан лічильників по областях у `rows`. */
export const NumeratorEditRootSchema = Type.Object({
  item:    NumeratorItemSchema,
  rows:    Type.Array(NumeratorStateRowSchema),
  options: Type.Object({}),
});
export type NumeratorEditRoot = Static<typeof NumeratorEditRootSchema>;
