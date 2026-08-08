import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI, type FieldRules } from "@client/ui-kit/base/base-ui.ts";
import {
  OrganizationEditRootSchema,
  type OrganizationEditRoot,
} from "./organization.schema.ts";
import "@client/ui-kit/components/ui-image.ts";

/** Подія ui-image: нове вкладення або очищення поля. */
type ImageEvent = CustomEvent<{ id: string | null; token: string | null }>;

export const tagName = "organization-edit";

@customElement(tagName)
export class OrganizationEdit extends BaseUI<OrganizationEditRoot> {
  protected model = "organization";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(OrganizationEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  /**
   * Ідентифікаційний код обов'язковий завжди, а от його довжина залежить від
   * виду особи: ЄДРПОУ юрособи — 8 цифр, РНОКПП підприємця — 10. У схемі поле
   * `Optional`, бо для БД воно й лишається необов'язковим (стара база), тож це
   * саме той випадок, заради якого правила живуть у формі, а не в схемі.
   */
  protected override fieldRules(): FieldRules {
    const entrepreneur = this.$root.item.legalPersonKind === "individual_entrepreneur";
    const length = entrepreneur ? 10 : 8;
    return {
      edrpou: {
        required: true,
        check: (value) =>
          new RegExp(`^\\d{${length}}$`).test(String(value).trim())
            ? null
            : this.t(entrepreneur ? "organization.rnokppFormat" : "organization.edrpouFormat"),
      },
    };
  }

  protected override formWidth = "max-w-2xl";


  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8">
        <span class="loading loading-spinner"></span>
      </div>
    `;

    const item = this.$root.item;

    return this.renderForm(html`
      <div class="flex flex-col gap-2">
          <div class="flex gap-2">
            ${this.renderField(
              this.t("common.code"),
              html`<input class="input input-bordered w-full" .value=${item.code ?? ""}
                @input=${this.bindTo(item, "code")} />`,
              { class: "w-32", field: "code" },
            )}
            ${this.renderField(
              this.t("common.name"),
              html`<input class="input input-bordered w-full" .value=${item.name ?? ""}
                @input=${this.bindTo(item, "name")} />`,
              { class: "flex-1", field: "name" },
            )}
          </div>

          ${this.renderField(
            this.t("organization.fullName"),
            html`<input class="input input-bordered w-full" .value=${item.fullName ?? ""}
              @input=${this.bindTo(item, "fullName")} />`,
            { field: "fullName" },
          )}

          <div class="flex gap-2">
            ${this.renderField(
              this.t("organization.edrpou"),
              html`<input class="input input-bordered w-full" .value=${item.edrpou ?? ""}
                @input=${this.bindTo(item, "edrpou")} />`,
              { class: "w-40", field: "edrpou" },
            )}
            ${this.renderField(
              this.t("organization.prefix"),
              html`<input class="input input-bordered w-full" maxlength="3" .value=${item.prefix ?? ""}
                @input=${this.bindTo(item, "prefix")} />`,
              { class: "w-24", field: "prefix" },
            )}
            ${this.renderField(
              this.t("organization.legalPersonKind"),
              html`
                <select class="select select-bordered w-full"
                  .value=${item.legalPersonKind ?? "legal_entity"}
                  @change=${this.bindTo(item, "legalPersonKind")}>
                  <option value="legal_entity">${this.t("organization.legalPersonKind.legalEntity")}</option>
                  <option value="individual_entrepreneur">${this.t("organization.legalPersonKind.entrepreneur")}</option>
                </select>`,
              { class: "flex-1", field: "legalPersonKind" },
            )}
          </div>

          <ui-image
            ?disabled=${this.readonlyMode}
            .label=${this.t("organization.logo")}
            .valueId=${item.logoId ?? ""}
            .valueToken=${item.logoToken ?? ""}
            owner-model="organization"
            .ownerId=${item.id ?? ""}
            @value-changed=${(e: ImageEvent) => {
              item.logoId = e.detail.id;
              item.logoToken = e.detail.token;
            }}
          ></ui-image>

              </div>
    `);
  }
}
