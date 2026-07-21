import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import {
  ChartOfAccountEditRootSchema,
  type ChartOfAccountEditRoot,
  type ChartOfAccountItem,
} from "./chart_of_account.schema.ts";

export const tagName = "chart-of-account-edit";

@customElement(tagName)
export class ChartOfAccountEdit extends BaseUI<ChartOfAccountEditRoot> {
  protected model = "chart_of_account";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(ChartOfAccountEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  /** Прапорець-чекбокс: пишемо булеве значення, а не рядок з .value. */
  private flag(item: ChartOfAccountItem, field: keyof ChartOfAccountItem) {
    return (e: Event) => {
      (item[field] as unknown as boolean) = (e.target as HTMLInputElement).checked;
    };
  }

  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8">
        <span class="loading loading-spinner"></span>
      </div>
    `;

    const item = this.$root.item;

    return html`
      <div class="p-4 max-w-2xl flex flex-col gap-2">
        ${this.renderNotice()}

        <div class="flex gap-2">
          ${this.renderField(
            this.t("chartOfAccount.code"),
            html`<input class="input input-bordered w-full" .value=${item.code ?? ""}
              @input=${this.bindTo(item, "code")} />`,
            { class: "w-28", field: "code" },
          )}
          ${this.renderField(
            this.t("common.name"),
            html`<input class="input input-bordered w-full" .value=${item.name ?? ""}
              @input=${this.bindTo(item, "name")} />`,
            { class: "flex-1", field: "name" },
          )}
        </div>

        <div class="flex gap-2">
          ${this.renderField(
            this.t("chartOfAccount.accountType"),
            html`
              <select class="select select-bordered w-full" .value=${item.accountType ?? "active"}
                @change=${this.bindTo(item, "accountType")}>
                <option value="active">${this.t("chartOfAccount.type.active")}</option>
                <option value="passive">${this.t("chartOfAccount.type.passive")}</option>
                <option value="active_passive">${this.t("chartOfAccount.type.activePassive")}</option>
              </select>`,
            { class: "flex-1", field: "accountType" },
          )}
          ${this.renderField(
            this.t("chartOfAccount.parentCode"),
            html`<input class="input input-bordered w-full" .value=${item.parentCode ?? ""}
              @input=${this.bindTo(item, "parentCode")} />`,
            { class: "w-32", field: "parentCode" },
          )}
        </div>

        <div class="flex flex-col gap-1 mt-1">
          <label class="label cursor-pointer justify-start gap-2">
            <input type="checkbox" class="checkbox checkbox-sm" .checked=${item.isGroup === true}
              @change=${this.flag(item, "isGroup")} />
            <span class="text-sm">${this.t("chartOfAccount.isGroup")}</span>
          </label>
          <label class="label cursor-pointer justify-start gap-2">
            <input type="checkbox" class="checkbox checkbox-sm" .checked=${item.isOffBalance === true}
              @change=${this.flag(item, "isOffBalance")} />
            <span class="text-sm">${this.t("chartOfAccount.isOffBalance")}</span>
          </label>
          <label class="label cursor-pointer justify-start gap-2">
            <input type="checkbox" class="checkbox checkbox-sm" .checked=${item.isCurrency === true}
              @change=${this.flag(item, "isCurrency")} />
            <span class="text-sm">${this.t("chartOfAccount.isCurrency")}</span>
          </label>
          <label class="label cursor-pointer justify-start gap-2">
            <input type="checkbox" class="checkbox checkbox-sm" .checked=${item.isQuantitative === true}
              @change=${this.flag(item, "isQuantitative")} />
            <span class="text-sm">${this.t("chartOfAccount.isQuantitative")}</span>
          </label>
          <label class="label cursor-pointer justify-start gap-2">
            <input type="checkbox" class="checkbox checkbox-sm" .checked=${item.isActive !== false}
              @change=${this.flag(item, "isActive")} />
            <span class="text-sm">${this.t("chartOfAccount.isActive")}</span>
          </label>
        </div>

        ${this.renderFormActions()}
      </div>
    `;
  }
}
