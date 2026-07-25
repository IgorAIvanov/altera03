import { html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import {
  UserEditRootSchema,
  type UserEditRoot,
} from "./user.schema.ts";

export const tagName = "user-edit";

@customElement(tagName)
export class UserEdit extends BaseUI<UserEditRoot> {
  protected model = "user";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  /**
   * Пароль — транзієнт: у `$root` він не потрапляє свідомо. Інакше поїхав би в
   * `save`, якого `app.user_save` не приймає, і осів би в реактивному стані
   * форми відкритим текстом.
   */
  @state() private password = "";

  constructor() {
    super(UserEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  private toggleGroup(id: string, checked: boolean) {
    const current = new Set(this.$root.item.groupIds);
    checked ? current.add(id) : current.delete(id);
    this.$root.item = { ...this.$root.item, groupIds: [...current] };
  }

  /**
   * Пароль ставиться окремою TS-командою — хеш рахує сервер (PBKDF2-SHA256).
   * До першого збереження користувача ще немає, тож і встановлювати нема кому.
   */
  private async setPassword() {
    const id = this.$root.item.id;
    if (!id || !this.password) return;

    const env = await this.run("setPassword", { id, password: this.password }, "save");
    if (env.ok) this.password = "";
  }

  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8">
        <span class="loading loading-spinner"></span>
      </div>
    `;

    const item = this.$root.item;
    const groups = this.$root.options.groups ?? [];

    return html`
      <div class="p-4 max-w-2xl flex flex-col gap-2">
        ${this.renderNotice()}

        <div class="grid grid-cols-2 gap-2">
          ${this.renderField(
            this.t("user.login"),
            html`<input class="input input-bordered w-full" .value=${item.login ?? ""}
              @input=${this.bindTo(item, "login")} />`,
            { field: "login" },
          )}

          ${this.renderField(
            this.t("user.fullName"),
            html`<input class="input input-bordered w-full" .value=${item.fullName ?? ""}
              @input=${this.bindTo(item, "fullName")} />`,
            { field: "fullName" },
          )}
        </div>

        ${this.renderField(
          this.t("common.active"),
          html`<input type="checkbox" class="checkbox checkbox-sm" .checked=${item.isActive !== false}
            @change=${(e: Event) => {
              this.$root.item = { ...item, isActive: (e.target as HTMLInputElement).checked };
            }} />`,
        )}

        <div class="mt-2">
          <div class="font-semibold mb-1">${this.t("user.groups")}</div>
          ${groups.length === 0
            ? html`<div class="text-base-content/50">${this.t("common.noData")}</div>`
            : html`
              <div class="flex flex-wrap gap-3">
                ${groups.map((g) => html`
                  <label class="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" class="checkbox checkbox-sm"
                      .checked=${item.groupIds.includes(g.id)}
                      @change=${(e: Event) => this.toggleGroup(g.id, (e.target as HTMLInputElement).checked)} />
                    <span>${g.name}</span>
                  </label>
                `)}
              </div>
            `}
        </div>

        <!-- Пароль. Новий користувач створюється з порожнім хешем і увійти не
             може, доки пароль не встановлять, — тому підказка, а не тиша. -->
        <div class="mt-4">
          <div class="font-semibold mb-1">${this.t("user.password")}</div>
          ${item.id
            ? html`
              <div class="flex items-end gap-2">
                <input class="input input-bordered w-64" type="password" autocomplete="new-password"
                  .value=${this.password}
                  placeholder=${this.t("user.passwordPlaceholder")}
                  @input=${(e: Event) => this.password = (e.target as HTMLInputElement).value} />
                <button class="btn btn-outline" ?disabled=${this.busy || !this.password}
                  @click=${this.setPassword}>
                  ${this.running === "save" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
                  ${this.t("user.setPassword")}
                </button>
              </div>
            `
            : html`<div class="text-base-content/50">${this.t("user.passwordAfterSave")}</div>`}
        </div>

        ${this.renderFormActions()}
      </div>
    `;
  }
}
