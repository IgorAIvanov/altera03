import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import { icons } from "@client/ui-kit/icons.ts";
import { modelKeysMatching, modelTitle } from "@shared/model-title.ts";
import { AGENT_NOTE_ROOT, type AgentNoteRow } from "./agent_note.schema.ts";

export const tagName = "agent-note-list";

@customElement(tagName)
export class AgentNoteList extends ModelListBase<AgentNoteRow> {
  protected model = "agent_note";
  protected editRoute = "admin/agent_note/edit";
  protected override defaultSortBy = "modelKey";

  protected columns: ListColumn<AgentNoteRow>[] = [
    {
      key: "kind",
      title: "agentNote.kind",
      width: "7rem",
      sortable: true,
      render: (row) =>
        html`<span class="badge ${row.kind === "topic" ? "badge-info" : "badge-ghost"}">
          ${this.t(`agentNote.kind.${row.kind}`)}
        </span>`,
      exportText: (row) => this.t(`agentNote.kind.${row.kind}`),
    },
    {
      key: "modelKey",
      title: "agentNote.scopeOrTitle",
      width: "14rem",
      sortable: true,
      muted: true,
      // Ключ моделі людині ні про що не каже, а `*` читається як зірочка з
      // невідомим змістом. Назва вже є в локалях самої моделі — той самий
      // `modelTitle`, яким користується список налаштувань журналу.
      render: (row) => this.#scope(row),
      exportText: (row) => this.#scope(row),
    },
    {
      key: "content",
      title: "agentNote.content",
      overflow: "ellipsis",
      sortable: true,
      // У теми в переліку показуємо «коли потрібна», а не тіло: саме цей рядок
      // лежить у контексті агента й вирішує, чи відкриють тему взагалі.
      render: (row) => (row.kind === "topic" ? row.summary : row.content),
      exportText: (row) => (row.kind === "topic" ? row.summary : row.content),
    },
    {
      key: "status",
      title: "agentNote.status",
      width: "9rem",
      sortable: true,
      // Стан тут не косметика: непідтверджене в контекст агента не їде взагалі,
      // і побачити це має бути можна не відкриваючи запис.
      render: (row) =>
        html`<span class="badge ${row.status === "confirmed" ? "badge-success" : "badge-ghost"}">
          ${this.t(`agentNote.status.${row.status}`)}
        </span>`,
      exportText: (row) => this.t(`agentNote.status.${row.status}`),
    },
    {
      key: "source",
      title: "agentNote.source",
      width: "7rem",
      muted: true,
      render: (row) => this.t(`agentNote.source.${row.source}`),
      exportText: (row) => this.t(`agentNote.source.${row.source}`),
    },
    {
      key: "_actions",
      title: "",
      width: "3rem",
      align: "center",
      render: (row) => html`
        <button
          class="btn btn-ghost btn-xs px-1"
          title=${this.t("common.open")}
          @click=${stopRow(() => this.openEdit(row.id))}
        >
          ${icons.open}
        </button>
      `,
    },
  ];

  /** У записки — область, у теми — її назва: області в теми немає. */
  #scope(row: AgentNoteRow): string {
    if (row.kind === "topic") return row.title;
    return row.modelKey === AGENT_NOTE_ROOT ? this.t("agentNote.scopeAll") : modelTitle(row.modelKey);
  }

  /**
   * Пошук по НАЗВІ моделі, а не лише по ключу.
   *
   * У колонці стоїть «Видаткова накладна», а в базі — `invoice`, і без цього
   * пошук за видимим текстом не знаходив би нічого: виглядає це як зламаний
   * пошук, а не як домовленість про переклад. Порахувати збіг може лише
   * клієнт — назва живе в його локалях.
   */
  protected override extraPayload(): Record<string, unknown> {
    const keys = modelKeysMatching(this.search ?? "");
    return keys.length ? { modelKeys: keys } : {};
  }

  protected override rowLabel(row: AgentNoteRow): string {
    return row.kind === "topic" ? row.title : row.content;
  }
}
