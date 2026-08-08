import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import { generatedModelRegistry } from "../../_generated/model-registry.generated.ts";
import "@client/ui-kit/components/ui-picker.ts";
import {
  UserGroupEditRootSchema,
  type UserGroupEditRoot,
  type UserGroupPermission,
} from "./userGroup.schema.ts";

/** Подія вибору з `<ui-picker>`: id та підпис вибраного рядка. */
type PickEvent = CustomEvent<{ id: string; label: string }>;

export const tagName = "user-group-edit";

/**
 * Моделі беруться з того самого реєстру, що й рантайм: право описується іменем
 * моделі з manifest.json, і список, набраний руками, розійшовся б із ним при
 * першій новій моделі. `*` — усі моделі, тому йде першим.
 */
const MODEL_OPTIONS = ["*", ...Object.keys(generatedModelRegistry).sort()];

@customElement(tagName)
export class UserGroupEdit extends BaseUI<UserGroupEditRoot> {
  protected model = "user_group";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(UserGroupEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  /**
   * `app.user_group_save` чекає `rows` поряд з `item`, а не всередині нього,
   * тож стандартний `saveItem()` (він шле лише `item`) мовчки губив би права.
   */
  protected override async saveItem(): Promise<boolean> {
    const env = await this.run<Partial<UserGroupEditRoot>>(
      "save",
      { item: this.$root.item, rows: this.$root.rows },
      "save",
    );
    if (!env.ok || !env.data) return false;
    this.assign(env.data);
    return true;
  }

  // ── Права ─────────────────────────────────────────────────────────────────

  private setPermission(index: number, patch: Partial<UserGroupPermission>) {
    this.$root.rows = this.$root.rows.map((r, i) => i === index ? { ...r, ...patch } : r);
  }

  private addPermission() {
    const actions = this.$root.options.actions ?? [];
    this.$root.rows = [...this.$root.rows, {
      id: null,
      model: "*",
      action: actions[0]?.id ?? "view",
      isAllowed: true,
    }];
  }

  private removePermission(index: number) {
    this.$root.rows = this.$root.rows.filter((_, i) => i !== index);
  }

  // ── Меню ──────────────────────────────────────────────────────────────────

  private toggleMenu(id: string, checked: boolean) {
    const current = new Set(this.$root.item.menuIds);
    checked ? current.add(id) : current.delete(id);
    this.$root.item = { ...this.$root.item, menuIds: [...current] };
  }

  // ── Учасники ──────────────────────────────────────────────────────────────

  /**
   * Учасники додаються пікером, а не чекбоксами всього списку: меню в системі
   * одиниці, а користувачів бувають сотні — вантажити всіх заради форми групи
   * ні до чого.
   */
  private addMember(id: string, name: string) {
    if (!id || this.$root.item.members.some((m) => m.id === id)) return;
    this.$root.item = {
      ...this.$root.item,
      members: [...this.$root.item.members, { id, name }],
    };
  }

  private removeMember(id: string) {
    this.$root.item = {
      ...this.$root.item,
      members: this.$root.item.members.filter((m) => m.id !== id),
    };
  }

  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8">
        <span class="loading loading-spinner"></span>
      </div>
    `;

    const item = this.$root.item;
    const actions = this.$root.options.actions ?? [];
    const menus = this.$root.options.menus ?? [];

    return this.renderForm(html`
      <div class="flex flex-col gap-2">
          <div class="grid grid-cols-2 gap-2">
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
          </div>

          ${this.renderField(
            this.t("common.active"),
            html`<input type="checkbox" class="checkbox checkbox-sm" .checked=${item.isActive !== false}
              @change=${(e: Event) => {
                this.$root.item = { ...item, isActive: (e.target as HTMLInputElement).checked };
              }} />`,
          )}

          <!-- Меню групи. Другий кінець того самого зв'язку, що редагується у
               формі меню: там чекбокси груп, тут — чекбокси меню. -->
          <div class="mt-4">
            <div class="font-semibold mb-1">${this.t("userGroup.menus")}</div>
            ${menus.length === 0
              ? html`<div class="text-muted">${this.t("common.noData")}</div>`
              : html`
                <div class="flex flex-wrap gap-3">
                  ${menus.map((m) => html`
                    <label class="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" class="checkbox checkbox-sm"
                        .checked=${item.menuIds.includes(m.id)}
                        @change=${(e: Event) => this.toggleMenu(m.id, (e.target as HTMLInputElement).checked)} />
                      <span>${m.name}</span>
                    </label>
                  `)}
                </div>
              `}
          </div>

          <!-- Учасники -->
          <div class="mt-4">
            <div class="font-semibold mb-1">${this.t("userGroup.members")}</div>

            <div class="w-80 mb-2">
              <ui-picker
                ?disabled=${this.readonlyMode}
                url="admin/user"
                fetch="lookup"
                placeholder=${this.t("userGroup.addMember")}
                .displayValue=${""}
                .selectedId=${""}
                @item-selected=${(e: PickEvent) => this.addMember(e.detail.id, e.detail.label)}
              ></ui-picker>
            </div>

            ${item.members.length === 0
              ? html`<div class="text-muted">${this.t("common.noData")}</div>`
              : html`
                <div class="flex flex-wrap gap-2">
                  ${item.members.map((m) => html`
                    <span class="badge badge-outline gap-1 py-3">
                      ${m.name}
                      <button class="btn btn-ghost btn-xs px-0 text-error" title=${this.t("common.delete")}
                        @click=${() => this.removeMember(m.id)}>✕</button>
                    </span>
                  `)}
                </div>
              `}
          </div>

          <div class="flex items-center justify-between mt-4 mb-2">
            <span class="font-semibold">${this.t("userGroup.permissions")}</span>
            <button class="btn btn-sm" @click=${this.addPermission}>+ ${this.t("userGroup.addPermission")}</button>
          </div>

          <table class="table table-sm w-full table-tabular">
            <thead>
              <tr>
                <th class="w-64">${this.t("userGroup.model")}</th>
                <th class="w-56">${this.t("userGroup.action")}</th>
                <th class="w-24 text-center">${this.t("userGroup.allowed")}</th>
                <th class="w-10"></th>
              </tr>
            </thead>
            <tbody>
              ${this.$root.rows.map((row, i) => html`
                <tr>
                  <td>
                    <select class="select select-sm w-full" .value=${row.model}
                      @change=${(e: Event) => this.setPermission(i, { model: (e.target as HTMLSelectElement).value })}>
                      ${MODEL_OPTIONS.map((model) => html`
                        <option value=${model} ?selected=${model === row.model}>
                          ${model === "*" ? `* — ${this.t("userGroup.allModels")}` : model}
                        </option>
                      `)}
                    </select>
                  </td>
                  <td>
                    <select class="select select-sm w-full" .value=${row.action}
                      @change=${(e: Event) => this.setPermission(i, { action: (e.target as HTMLSelectElement).value })}>
                      ${actions.map((a) => html`
                        <option value=${a.id} ?selected=${a.id === row.action}>${a.name}</option>
                      `)}
                    </select>
                  </td>
                  <td class="text-center">
                    <input type="checkbox" class="checkbox checkbox-sm" .checked=${row.isAllowed}
                      @change=${(e: Event) => this.setPermission(i, {
                        isAllowed: (e.target as HTMLInputElement).checked,
                      })} />
                  </td>
                  <td class="text-center">
                    <button class="btn btn-ghost btn-xs text-error" title=${this.t("common.delete")}
                      @click=${() => this.removePermission(i)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    </button>
                  </td>
                </tr>
              `)}
              ${this.$root.rows.length === 0
                ? html`<tr><td colspan="4" class="text-center text-muted py-4">${this.t("common.noData")}</td></tr>`
                : ""}
            </tbody>
          </table>
              </div>
    `);
  }
}
