import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import {
  NomenclatureEditRootSchema,
  type NomenclatureEditRoot,
} from "./nomenclature.schema.ts";

export const tagName = "nomenclature-edit";

@customElement(tagName)
export class NomenclatureEdit extends BaseUI<NomenclatureEditRoot> {
  protected model = "nomenclature";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(NomenclatureEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  protected override formWidth = "max-w-md";


  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
    `;

    const item = this.$root.item;

    return this.renderForm(html`
      <div class="flex flex-col gap-2">
          ${this.renderField(
            this.t("common.code"),
            // Порожній код підставить нумератор при записі (manifest numbering).
            html`<input class="input input-bordered w-full" placeholder=${this.t("common.codeAuto")}
              .value=${item.code ?? ""}
              @input=${this.bindTo(item, "code")} />`,
            { field: "code" },
          )}

          ${this.renderField(
            this.t("common.name"),
            html`<input class="input input-bordered w-full" .value=${item.name ?? ""}
              @input=${this.bindTo(item, "name")} />`,
            { field: "name" },
          )}

          ${this.renderField(
            this.t("nomenclature.unit"),
            html`<input class="input input-bordered w-full" .value=${item.unit ?? ""}
              @input=${this.bindTo(item, "unit")} />`,
            { field: "unit" },
          )}

              </div>
    `);
  }
}
