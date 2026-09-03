import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

// Пам'ятка бази — домовленості ЦЬОГО підприємства, які агент не може вивести
// ні з коду, ні з даних. Таблиця живе в ядрі (@core/agent_note), бо доставка
// (`GET /api/agent/tools`) — частина фреймворку; тут лише екран.
//
// Мови в моделі немає навмисно: пам'ятку пише людина тією мовою, якою на цьому
// підприємстві говорять, і перекладати домовленості підприємства — не справа
// фреймворку.

/** Області: `*` — уся база, інакше ключ моделі. */
export const AGENT_NOTE_ROOT = "*";

export const AGENT_NOTE_STATUSES = ["draft", "confirmed"] as const;
export type AgentNoteStatus = (typeof AGENT_NOTE_STATUSES)[number];

// ── 1. Item — форма редагування та payload для save ───────────────────────────

export const AgentNoteItemSchema = Type.Object({
  id: Type.Union([Type.String(), Type.Null()], { default: null }),
  modelKey: Type.String({ title: "Область", default: AGENT_NOTE_ROOT, maxLength: 100 }),
  content: Type.String({ title: "Домовленість", default: "" }),
  status: Type.String({ title: "Стан", default: "draft", maxLength: 20 }),
  /** Хто склав формулювання. Читається, не пишеться: агент ставить його сам. */
  source: Type.Optional(Type.String({ title: "Джерело", default: "admin", maxLength: 20 })),
});
export type AgentNoteItem = Static<typeof AgentNoteItemSchema>;

// ── 2. Row — рядок списку ─────────────────────────────────────────────────────

export const AgentNoteRowSchema = Type.Object({
  id: Type.String(),
  modelKey: Type.String(),
  content: Type.String(),
  status: Type.String(),
  source: Type.String(),
});
export type AgentNoteRow = Static<typeof AgentNoteRowSchema>;

// ── 3. Payload schemas ────────────────────────────────────────────────────────

export const AgentNoteListPayloadSchema = Type.Object({
  search: Type.Optional(Type.String()),
  page: Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy: Type.Optional(
    Type.Union([Type.Literal("modelKey"), Type.Literal("status"), Type.Literal("content")]),
  ),
  sortDir: Type.Optional(SortDirSchema),
});
export type AgentNoteListPayload = Static<typeof AgentNoteListPayloadSchema>;

export const AgentNoteGetPayloadSchema = Type.Object({ id: Type.String() });
export type AgentNoteGetPayload = Static<typeof AgentNoteGetPayloadSchema>;

export const AgentNoteSavePayloadSchema = Type.Object({ item: AgentNoteItemSchema });
export type AgentNoteSavePayload = Static<typeof AgentNoteSavePayloadSchema>;

export const AgentNoteDeletePayloadSchema = Type.Object({ id: Type.String() });
export type AgentNoteDeletePayload = Static<typeof AgentNoteDeletePayloadSchema>;

// ── 4. Root schema — дзеркало `data` форми редагування ($root) ────────────────

export const AgentNoteEditRootSchema = Type.Object({
  item: AgentNoteItemSchema,
  options: Type.Object({}),
});
export type AgentNoteEditRoot = Static<typeof AgentNoteEditRootSchema>;
