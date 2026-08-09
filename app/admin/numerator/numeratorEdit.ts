import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI, type FieldRules } from "@client/ui-kit/base/base-ui.ts";
import {
  NumeratorEditRootSchema,
  type NumeratorEditRoot,
  type NumeratorItem,
} from "./numerator.schema.ts";

export const tagName = "numerator-edit";

@customElement(tagName)
export class NumeratorEdit extends BaseUI<NumeratorEditRoot> {
  protected model = "numerator";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(NumeratorEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  /** Прапорець-чекбокс: пишемо булеве значення, а не рядок з .value. */
  private flag(item: NumeratorItem, field: keyof NumeratorItem) {
    return (e: Event) => {
      (item[field] as unknown as boolean) = (e.target as HTMLInputElement).checked;
    };
  }

  protected override formWidth = "max-w-xl";

  protected override fieldRules(): FieldRules {
    return { name: true, template: true };
  }

  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8">
        <span class="loading loading-spinner"></span>
      </div>
    `;

    const item = this.$root.item;
    const states = this.$root.rows;

    return this.renderForm(html`
      <div class="flex flex-col gap-2">
        ${this.renderField(
          this.t("numerator.model"),
          html`<input class="input input-bordered w-full" disabled .value=${item.id ?? ""} />`,
          { class: "w-48" },
        )}

        ${this.renderField(
          this.t("common.name"),
          html`<input class="input input-bordered w-full" .value=${item.name ?? ""}
            @input=${this.bindTo(item, "name")} />`,
          { field: "name" },
        )}

        ${this.renderField(
          this.t("numerator.template"),
          html`<input class="input input-bordered w-full" .value=${item.template ?? ""}
            @input=${this.bindTo(item, "template")} />`,
          { field: "template", class: "w-64" },
        )}
        <div class="text-muted text-xs">${this.t("numerator.templateHint")}</div>

        <div class="flex gap-4">
          ${this.renderField(
            this.t("numerator.period"),
            html`
              <select class="select select-bordered w-full"
                ?disabled=${item.isDocument !== true}
                .value=${item.period ?? "none"}
                @change=${this.bindTo(item, "period")}>
                <option value="none">${this.t("numerator.period_none")}</option>
                <option value="year">${this.t("numerator.period_year")}</option>
                <option value="month">${this.t("numerator.period_month")}</option>
              </select>`,
            { field: "period", class: "flex-1" },
          )}
          ${this.renderField(
            this.t("numerator.strategy"),
            html`
              <select class="select select-bordered w-full"
                .value=${item.strategy ?? "counter"}
                @change=${this.bindTo(item, "strategy")}>
                <option value="counter">${this.t("numerator.strategy_counter")}</option>
                <option value="sequence">${this.t("numerator.strategy_sequence")}</option>
              </select>`,
            { field: "strategy", class: "flex-1" },
          )}
        </div>
        ${item.isDocument === true
          ? ""
          : html`<div class="text-muted text-xs">${this.t("numerator.periodCatalogHint")}</div>`}

        <label class="label cursor-pointer justify-start gap-2">
          <input type="checkbox" class="checkbox checkbox-sm" .checked=${item.isEditable !== false}
            @change=${this.flag(item, "isEditable")} />
          <span class="text-sm">${this.t("numerator.isEditable")}</span>
        </label>

        <h3 class="mt-3 text-sm font-semibold">${this.t("numerator.states")}</h3>
        ${states.length === 0
          ? html`<div class="text-muted text-sm">${this.t("numerator.statesEmpty")}</div>`
          : html`
            <table class="table w-fit">
              <thead>
                <tr>
                  <th>${this.t("numerator.scope")}</th>
                  <th class="text-right">${this.t("numerator.lastValue")}</th>
                </tr>
              </thead>
              <tbody>
                ${states.map((s) => html`
                  <tr>
                    <td>${s.scopeKey === "" ? this.t("numerator.scopeGlobal") : s.scopeKey}</td>
                    <td class="text-right tabular-nums">${s.lastValue}</td>
                  </tr>
                `)}
              </tbody>
            </table>`}
      </div>
    `);
  }
}
