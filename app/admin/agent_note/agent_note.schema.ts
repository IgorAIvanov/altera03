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

/**
 * Два види, і різниця не в довжині тексту, а в тому, ЯК вони доїжджають.
 *
 * `note` лежить у контексті агента завжди — тому одна думка на запис. `topic`
 * це процедура на сторінку-другу; завжди їде лише покажчик (`slug`, назва,
 * «коли потрібно»), а тіло агент читає командою, коли задача збіглася.
 */
export const AGENT_NOTE_KINDS = ["note", "topic"] as const;
export type AgentNoteKind = (typeof AGENT_NOTE_KINDS)[number];

// ── 1. Item — форма редагування та payload для save ───────────────────────────

export const AgentNoteItemSchema = Type.Object({
  id: Type.Union([Type.String(), Type.Null()], { default: null }),
  kind: Type.String({ title: "Вид", default: "note", maxLength: 20 }),
  modelKey: Type.String({ title: "Область", default: AGENT_NOTE_ROOT, maxLength: 100 }),
  /** Далі три — тільки в теми. У записки порожні, і це не «недозаповнено». */
  slug: Type.Optional(Type.String({ title: "Ім'я теми", default: "", maxLength: 100 })),
  title: Type.Optional(Type.String({ title: "Назва", default: "", maxLength: 200 })),
  summary: Type.Optional(Type.String({ title: "Коли потрібна", default: "" })),
  content: Type.String({ title: "Домовленість", default: "" }),
  status: Type.String({ title: "Стан", default: "draft", maxLength: 20 }),
  /** Хто склав формулювання. Читається, не пишеться: агент ставить його сам. */
  source: Type.Optional(Type.String({ title: "Джерело", default: "admin", maxLength: 20 })),
});
export type AgentNoteItem = Static<typeof AgentNoteItemSchema>;

// ── 2. Row — рядок списку ─────────────────────────────────────────────────────

export const AgentNoteRowSchema = Type.Object({
  id: Type.String(),
  kind: Type.String(),
  modelKey: Type.String(),
  title: Type.String(),
  summary: Type.String(),
  content: Type.String(),
  status: Type.String(),
  source: Type.String(),
});
export type AgentNoteRow = Static<typeof AgentNoteRowSchema>;

// ── 3. Payload schemas ────────────────────────────────────────────────────────

export const AgentNoteListPayloadSchema = Type.Object({
  search: Type.Optional(Type.String()),
  /**
   * Ключі моделей, чия НАЗВА збіглася з пошуком. Рахує їх клієнт: у базі лежить
   * ключ (`invoice`), а на екрані стоїть назва («Видаткова накладна»), і
   * переклад живе в локалях клієнта. Без цього пошук за видимим текстом не
   * знаходив би нічого.
   */
  modelKeys: Type.Optional(Type.Array(Type.String())),
  page: Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy: Type.Optional(
    Type.Union([
      Type.Literal("kind"),
      Type.Literal("modelKey"),
      Type.Literal("status"),
      Type.Literal("content"),
    ]),
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
