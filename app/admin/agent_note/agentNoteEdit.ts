import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI, type FieldRules } from "@client/ui-kit/base/base-ui.ts";
import { generatedModelRegistry } from "../../_generated/model-registry.generated.ts";
import { modelTitle } from "@shared/model-title.ts";
import {
  AGENT_NOTE_KINDS,
  AGENT_NOTE_ROOT,
  AGENT_NOTE_STATUSES,
  AgentNoteEditRootSchema,
  type AgentNoteEditRoot,
} from "./agent_note.schema.ts";

export const tagName = "agent-note-edit";

/**
 * Записка пам'ятки або тема.
 *
 * Різниця між ними не в довжині тексту, а в тому, як вони доїжджають до
 * агента: записка лежить у його контексті ЗАВЖДИ (тому одна думка на запис), а
 * від теми завжди їде лише покажчик, тіло читається командою. Звідси й форма:
 * у теми три поля покажчика, у записки — область.
 *
 * Область вибирається зі СПИСКУ моделей, а не набирається руками: записка про
 * модель, якої немає, не доїде нікому — доставка ключується іменем моделі, — і
 * при цьому виглядатиме як збережена.
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

  get #isTopic(): boolean {
    return this.$root.item.kind === "topic";
  }

  /**
   * Три поля покажчика обов'язкові РАЗОМ і лише в теми: тема без «коли
   * потрібна» не доїде до агента ніколи — у переліку стоятиме порожній рядок,
   * і відкривати її ніхто не піде.
   */
  protected override fieldRules(): FieldRules {
    const topic = this.#isTopic;
    return { slug: topic, title: topic, summary: topic, content: true };
  }

  override render() {
    if (this.running === "get") {
      return html`
        <div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
      `;
    }

    const item = this.$root.item;
    const topic = this.#isTopic;

    return this.renderForm(html`
      <div class="flex flex-col gap-2">
        <p class="text-sm opacity-70">
          ${this.t(topic ? "agentNote.hintTopic" : "agentNote.hint")}
        </p>

        ${this.renderField(
      this.t("agentNote.kind"),
      html`
          <select
            class="select select-bordered w-full"
            .value=${item.kind ?? "note"}
            @change=${this.bindTo(item, "kind")}
          >
            ${AGENT_NOTE_KINDS.map((value) =>
        html`<option value=${value}>${this.t(`agentNote.kind.${value}`)}</option>`
      )}
          </select>
        `,
      { field: "kind", class: "w-48" },
    )}
        ${topic ? this.#renderTopicFields() : this.#renderScope()}
        ${this.renderField(
      this.t(topic ? "agentNote.body" : "agentNote.content"),
      html`
          <textarea
            class="textarea textarea-bordered w-full"
            rows=${topic ? 12 : 4}
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

  #renderScope() {
    const item = this.$root.item;
    return this.renderField(
      this.t("agentNote.scope"),
      html`
        <select
          class="select select-bordered w-full"
          .value=${item.modelKey ?? AGENT_NOTE_ROOT}
          @change=${this.bindTo(item, "modelKey")}
        >
          <option value=${AGENT_NOTE_ROOT}>${this.t("agentNote.scopeAll")}</option>
          ${this.#models.map((entry) => html`<option value=${entry.key}>${entry.title}</option>`)}
        </select>
      `,
      { field: "modelKey", class: "w-72" },
    );
  }

  #renderTopicFields() {
    const item = this.$root.item;
    return html`
      ${this.renderField(
      this.t("agentNote.slug"),
      html`<input
          class="input input-bordered w-full"
          placeholder="close-month"
          .value=${item.slug ?? ""}
          @input=${this.bindTo(item, "slug")}
        />`,
      { field: "slug", class: "w-72" },
    )}
      ${this.renderField(
      this.t("agentNote.title"),
      html`<input
          class="input input-bordered w-full"
          .value=${item.title ?? ""}
          @input=${this.bindTo(item, "title")}
        />`,
      { field: "title" },
    )}
      ${this.renderField(
      this.t("agentNote.summary"),
      html`<textarea
          class="textarea textarea-bordered w-full"
          rows="2"
          .value=${item.summary ?? ""}
          @input=${this.bindTo(item, "summary")}
        ></textarea>`,
      { field: "summary" },
    )}
    `;
  }
}
