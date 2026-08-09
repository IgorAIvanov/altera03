import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import { modelTitle } from "@shared/model-title.ts";
import {
  AUDIT_LEVELS,
  AuditSettingEditRootSchema,
  type AuditSettingEditRoot,
} from "./audit_setting.schema.ts";

export const tagName = "audit-setting-edit";

@customElement(tagName)
export class AuditSettingEdit extends BaseUI<AuditSettingEditRoot> {
  protected model = "audit_setting";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(AuditSettingEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  protected override formWidth = "max-w-xl";

  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8">
        <span class="loading loading-spinner"></span>
      </div>
    `;

    const item = this.$root.item;

    return this.renderForm(html`
      <div class="flex flex-col gap-2">
        ${this.renderField(
          this.t("auditSetting.model"),
          html`<input class="input input-bordered w-full" disabled
            .value=${item.id ? modelTitle(item.id) : ""} />`,
        )}

        ${this.renderField(
          this.t("auditSetting.modelKey"),
          html`<input class="input input-bordered w-full" disabled .value=${item.id ?? ""} />`,
          { class: "w-64" },
        )}

        ${this.renderField(
          this.t("auditSetting.level"),
          html`
            <select class="select select-bordered w-full"
              .value=${item.level ?? "none"}
              @change=${this.bindTo(item, "level")}>
              ${AUDIT_LEVELS.map((level) => html`
                <option value=${level}>${this.t(`auditSetting.level_${level}`)}</option>
              `)}
            </select>`,
          { field: "level", class: "w-64" },
        )}
        <div class="text-muted text-xs">${this.t("auditSetting.levelHint")}</div>

        <div class="text-muted mt-3 text-sm">
          ${this.t("auditSetting.eventCount")}: <span class="tabular-nums">${item.eventCount ?? "0"}</span>
        </div>
      </div>
    `);
  }
}
