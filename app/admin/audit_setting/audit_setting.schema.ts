import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

// Первинний ключ налаштування — КЛЮЧ МОДЕЛІ (app.audit_setting.model), тож `id`
// тут рядок («bank», «invoice»), а не bigint. Для машинерії list/edit це нічого
// не міняє: id на клієнті завжди рядок.

/** Рівні журналу — ті самі значення, що в ck_audit_setting_level. */
export const AUDIT_LEVELS = ["none", "changes", "all"] as const;
export type AuditLevel = (typeof AUDIT_LEVELS)[number];

// ── 1. Item — форма редагування та payload для save ───────────────────────────

export const AuditSettingItemSchema = Type.Object({
  id:    Type.Union([Type.String(), Type.Null()], { default: null }),
  level: Type.String({ title: "Рівень журналу", default: "none" }),
  /** Скільки подій цієї моделі вже в журналі. Читається, не пишеться. */
  eventCount: Type.Optional(Type.String({ "x-db-type": "bigint" })),
});
export type AuditSettingItem = Static<typeof AuditSettingItemSchema>;

// ── 2. Row — рядок списку ─────────────────────────────────────────────────────

export const AuditSettingRowSchema = Type.Object({
  id:    Type.String(),
  level: Type.String(),
});
export type AuditSettingRow = Static<typeof AuditSettingRowSchema>;

// ── 3. Payload schemas ────────────────────────────────────────────────────────

export const AuditSettingListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  /**
   * Ключі моделей, чия НАЗВА збіглася з пошуком, — їх рахує клієнт і додає до
   * пошуку по ключу (`extraPayload()`). У базі назви немає: вона живе в
   * локалях клієнта, як і решта тексту для людини.
   */
  modelKeys: Type.Optional(Type.Array(Type.String())),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([Type.Literal("id"), Type.Literal("level")])),
  sortDir:  Type.Optional(SortDirSchema),
});
export type AuditSettingListPayload = Static<typeof AuditSettingListPayloadSchema>;

export const AuditSettingGetPayloadSchema = Type.Object({
  id: Type.String(),
});
export type AuditSettingGetPayload = Static<typeof AuditSettingGetPayloadSchema>;

export const AuditSettingSavePayloadSchema = Type.Object({
  item: AuditSettingItemSchema,
});
export type AuditSettingSavePayload = Static<typeof AuditSettingSavePayloadSchema>;

// ── 4. Root schema — дзеркало `data` форми редагування ($root) ────────────────

export const AuditSettingEditRootSchema = Type.Object({
  item:    AuditSettingItemSchema,
  options: Type.Object({}),
});
export type AuditSettingEditRoot = Static<typeof AuditSettingEditRootSchema>;
