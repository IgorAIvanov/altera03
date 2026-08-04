import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import {
  CounterpartyEditRootSchema,
  type CounterpartyEditRoot,
} from "./counterparty.schema.ts";

export const tagName = "counterparty-edit";

@customElement(tagName)
export class CounterpartyEdit extends BaseUI<CounterpartyEditRoot> {
  protected model = "counterparty";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(CounterpartyEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
    `;

    const item = this.$root.item;

    return html`
      <div class="p-4 max-w-md flex flex-col gap-2">
        ${this.renderNotice()}
        ${this.renderFields(html`
          ${this.renderField(
            this.t("common.code"),
            html`<input class="input input-bordered w-full" .value=${item.code ?? ""}
              @input=${this.bindTo(item, "code")} />`,
            { field: "code" },
          )}

          ${this.renderField(
            this.t("common.name"),
            html`<input class="input input-bordered w-full" .value=${item.name ?? ""}
              @input=${this.bindTo(item, "name")} />`,
            { field: "name" },
          )}

          <label class="label cursor-pointer justify-start gap-2 mt-1">
            <input type="checkbox" class="checkbox checkbox-sm" .checked=${item.isActive !== false}
              @change=${(e: Event) => { item.isActive = (e.target as HTMLInputElement).checked; }} />
            <span class="text-sm">${this.t("common.active")}</span>
          </label>
        `)}

        ${this.renderFormActions()}
      </div>
    `;
  }
}
