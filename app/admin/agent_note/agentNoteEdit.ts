import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import { generatedModelRegistry } from "../../_generated/model-registry.generated.ts";
import { modelTitle } from "@shared/model-title.ts";
import {
  AGENT_NOTE_ROOT,
  AGENT_NOTE_STATUSES,
  AgentNoteEditRootSchema,
  type AgentNoteEditRoot,
} from "./agent_note.schema.ts";

export const tagName = "agent-note-edit";

/**
 * Записка пам'ятки.
 *
 * Область вибирається зі СПИСКУ моделей, а не набирається руками: записка про
 * модель, якої немає, не доїде нікому — доставка ключується іменем моделі, —
 * і при цьому виглядатиме як збережена. Перелік беремо з реєстру моделей: той
 * самий, з якого екран груп бере моделі для прав.
 */
@customElement(tagName)
export class AgentNoteEdit extends BaseUI<AgentNoteEditRoot> {
  protected model = "agent_note";
  protected override primaryKey = "item";
  protected override formWidth = "max-w-3xl";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(AgentNoteEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  /**
   * Моделі — за НАЗВОЮ, не за ключем: вибирає людина, і `chart_of_account`
   * серед двохсот рядків вона шукатиме довше, ніж «План рахунків». Ключ
   * лишається значенням: доставка ключується саме ним.
   */
  get #models(): Array<{ key: string; title: string }> {
    return Object.keys(generatedModelRegistry)
      .map((key) => ({ key, title: modelTitle(key) }))
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  override render() {
    if (this.running === "get") {
      return html`
        <div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
      `;
    }

    const item = this.$root.item;

    return this.renderForm(html`
      <div class="flex flex-col gap-2">
        <p class="text-sm opacity-70">${this.t("agentNote.hint")}</p>
        ${this.renderField(
      this.t("agentNote.scope"),
      html`
          <select
            class="select select-bordered w-full"
            .value=${item.modelKey ?? AGENT_NOTE_ROOT}
            @change=${this.bindTo(item, "modelKey")}
          >
            <option value=${AGENT_NOTE_ROOT}>${this.t("agentNote.scopeAll")}</option>
            ${this.#models.map((entry) =>
        html`<option value=${entry.key}>${entry.title}</option>`
      )}
          </select>
        `,
      { field: "modelKey", class: "w-72" },
    )}
        ${this.renderField(
      this.t("agentNote.content"),
      html`
          <textarea
            class="textarea textarea-bordered w-full"
            rows="4"
            .value=${item.content ?? ""}
            @input=${this.bindTo(item, "content")}
          ></textarea>
        `,
      { field: "content" },
    )}
        ${this.renderField(
      this.t("agentNote.status"),
      html`
          <select
            class="select select-bordered w-full"
            .value=${item.status ?? "draft"}
            @change=${this.bindTo(item, "status")}
          >
            ${AGENT_NOTE_STATUSES.map((value) =>
        html`<option value=${value}>${this.t(`agentNote.status.${value}`)}</option>`
      )}
          </select>
        `,
      { field: "status", class: "w-48" },
    )}
      </div>
    `);
  }
}
