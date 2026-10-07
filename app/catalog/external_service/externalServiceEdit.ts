import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import "@client/ui-kit/components/ui-secret.ts";
import { ExternalServiceEditRootSchema, type ExternalServiceEditRoot } from "./external_service.schema.ts";

export const tagName = "external-service-edit";

@customElement(tagName)
export class ExternalServiceEdit extends BaseUI<ExternalServiceEditRoot> {
  protected model = "external_service";
  protected override primaryKey = "item";
  protected override formWidth = "max-w-md";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(ExternalServiceEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  /** Перевірка йде на сервері: відкрите значення токена клієнт не бачить. */
  private async check() {
    await this.run("check", { id: this.$root.item.id });
  }

  protected override renderActions() {
    if (!this.$root.item.id) return html``;
    return html`
      <button class="btn btn-sm btn-outline" ?disabled=${this.busy} @click=${this.check}>
        ${this.running === "check" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
        ${this.t("externalService.check")}
      </button>
    `;
  }

  override render() {
    if (this.running === "get") {
      return html`<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>`;
    }

    const item = this.$root.item;
    return this.renderForm(html`
      <div class="flex flex-col gap-2">
        ${this.renderField(
          this.t("common.name"),
          html`<input class="input input-bordered w-full" .value=${item.name ?? ""}
            @input=${this.bindTo(item, "name")} />`,
          { field: "name" },
        )}
        ${this.renderField(
          this.t("externalService.url"),
          html`<input class="input input-bordered w-full" .value=${item.url ?? ""}
            @input=${this.bindTo(item, "url")} />`,
          { field: "url" },
        )}
        ${this.renderField(
          this.t("externalService.login"),
          html`<input class="input input-bordered w-full" autocomplete="off" .value=${item.login ?? ""}
            @input=${this.bindTo(item, "login")} />`,
          { field: "login" },
        )}
        ${this.renderField(
          this.t("externalService.token"),
          html`<ui-secret
            .value=${item.token}
            ?is-set=${item.tokenSet === true}
            changed-at=${item.tokenChangedAt ?? ""}
            ?disabled=${this.readonlyMode}
            @value-changed=${(e: CustomEvent<{ value: string | null | undefined }>) => {
              // Незбережену зміну база помічає сама — знімком на рендері.
              item.token = e.detail.value;
              this.requestUpdate();
            }}
          ></ui-secret>`,
          { field: "token" },
        )}
      </div>
    `);
  }
}
