import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import { icons } from "@client/ui-kit/icons.ts";
import { AGENT_NOTE_ROOT, type AgentNoteRow } from "./agent_note.schema.ts";

export const tagName = "agent-note-list";

@customElement(tagName)
export class AgentNoteList extends ModelListBase<AgentNoteRow> {
  protected model = "agent_note";
  protected editRoute = "admin/agent_note/edit";
  protected override defaultSortBy = "modelKey";

  protected columns: ListColumn<AgentNoteRow>[] = [
    {
      key: "modelKey",
      title: "agentNote.scope",
      width: "12rem",
      sortable: true,
      muted: true,
      // `*` — технічне значення, і в переліку воно читається як зірочка з
      // невідомим змістом. Область називаємо словами.
      render: (row) =>
        row.modelKey === AGENT_NOTE_ROOT ? this.t("agentNote.scopeAll") : row.modelKey,
      exportText: (row) =>
        row.modelKey === AGENT_NOTE_ROOT ? this.t("agentNote.scopeAll") : row.modelKey,
    },
    { key: "content", title: "agentNote.content", overflow: "ellipsis", sortable: true },
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

  protected override rowLabel(row: AgentNoteRow): string {
    return row.content;
  }
}
