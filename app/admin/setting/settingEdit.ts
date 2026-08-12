import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import {
  SETTING_FIELDS,
  type SettingField,
  SettingEditRootSchema,
  type SettingEditRoot,
} from "./setting.schema.ts";

export const tagName = "app-setting-edit";

/**
 * Налаштування установки — одна форма на всю установку, без списку: запис тут
 * рівно один, і перелік із одного рядка був би зайвим кроком до нього.
 *
 * Поля малюються з каталогу (`SETTING_FIELDS`), а не пишуться руками: новий
 * параметр має коштувати одного оголошення й рядка в сіді, інакше сенс спільного
 * місця втрачається — з'явиться ще один екран.
 */
@customElement(tagName)
export class SettingEdit extends BaseUI<SettingEditRoot> {
  protected model = "setting";
  protected override primaryKey = "item";
  protected override formWidth = "max-w-xl";

  constructor() {
    super(SettingEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    void this.loadInto("get", {});
  }

  /**
   * Число зберігаємо ЧИСЛОМ, а не рядком із поля вводу: значення лягає в jsonb
   * як є, і `"20"` замість `20` пережило б збереження непоміченим — розійшлося б
   * аж там, де налаштування читають (`(value)::int` на рядку з лапками).
   */
  #setNumber(field: SettingField, e: Event) {
    const raw = (e.target as HTMLInputElement).value.trim();
    if (raw === "") return;
    let next = Number(raw);
    if (!Number.isFinite(next)) return;
    if (field.min !== undefined) next = Math.max(field.min, next);
    if (field.max !== undefined) next = Math.min(field.max, next);
    this.$root.item.values[field.key] = next;
  }

  #renderControl(field: SettingField): TemplateResult {
    const value = this.$root.item.values[field.key];

    if (field.kind === "bool") {
      return html`<input type="checkbox" class="checkbox"
        .checked=${value === true}
        ?disabled=${this.readonlyMode}
        @change=${(e: Event) => {
          this.$root.item.values[field.key] = (e.target as HTMLInputElement).checked;
        }} />`;
    }

    if (field.kind === "int") {
      return html`<input type="number" class="input input-bordered w-full"
        min=${field.min ?? ""} max=${field.max ?? ""}
        .value=${value === undefined || value === null ? "" : String(value)}
        ?disabled=${this.readonlyMode}
        @change=${(e: Event) => this.#setNumber(field, e)} />`;
    }

    return html`<input class="input input-bordered w-full"
      .value=${value === undefined || value === null ? "" : String(value)}
      ?disabled=${this.readonlyMode}
      @input=${(e: Event) => {
        this.$root.item.values[field.key] = (e.target as HTMLInputElement).value;
      }} />`;
  }

  override render() {
    if (this.running === "get") {
      return html`
        <div class="flex justify-center p-8">
          <span class="loading loading-spinner"></span>
        </div>
      `;
    }

    // Розділи — за першим сегментом ключа (`list.pageSize` → `list`). Окремого
    // поля в каталозі для цього немає навмисно: розділ і так уже названий у
    // ключі, а другий спосіб сказати те саме розійшовся б з першим.
    const sections = new Map<string, SettingField[]>();
    for (const field of SETTING_FIELDS) {
      const section = field.key.split(".")[0];
      const list = sections.get(section) ?? [];
      list.push(field);
      sections.set(section, list);
    }

    return this.renderForm(html`
      <div class="flex flex-col gap-4">
        ${[...sections].map(([section, fields]) => html`
          <div class="flex flex-col gap-2">
            <div class="text-sm font-medium">${this.t(`setting.section.${section}`)}</div>
            ${fields.map((field) => html`
              ${this.renderField(this.t(field.titleKey), this.#renderControl(field), {
                field: field.key,
                class: field.kind === "int" ? "w-40" : undefined,
              })}
              ${field.hintKey
                ? html`<div class="text-muted text-xs">${this.t(field.hintKey)}</div>`
                : ""}
            `)}
          </div>
        `)}
      </div>
    `);
  }
}
