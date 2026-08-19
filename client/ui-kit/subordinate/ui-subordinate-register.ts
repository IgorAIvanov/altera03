/**
 * Підпорядкований регістр — ПАНЕЛЬ (логіка в `subordinate-register.ts`).
 *
 * Малює те, що в кожному застосунку виходило однаковим: заголовок із кнопкою
 * «Додати», перелік, порожній стан, вбудований редактор рядка й підказку «спершу
 * збережіть картку». Замінити своїм можна будь-коли — усі дії публічні на
 * контролері, — але переписувати доводилося саме це, і щоразу з тими самими
 * чотирма пастками (див. коментар контролера).
 *
 * ЧОМУ ВЛАСНИЙ SignalWatcher. `register.readonly` і `register.ownerId` — це
 * функції форми, а вони читають сигнали (`$root` і право на запис). Без
 * підписки панель про зміну не дізнається: власна властивість `register`
 * лишається ТИМ САМИМ об'єктом, тож після першого збереження картки панель
 * так і стояла б вимкненою. Той самий випадок, що з тулбаром табличної частини.
 */
import { css, type CSSResultGroup, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { GlobalStyledLitElement } from "../base/gsle.ts";
import { tw } from "../../shared/styles.ts";
import { t } from "../../locale.ts";
import { formatDate } from "../../shared/datetime.ts";
import { icons } from "../icons.ts";
import type {
  SubordinateColumn,
  SubordinateField,
  SubordinateRegister,
} from "./subordinate-register.ts";
import "../components/ui-picker.ts";
import "../components/ui-decimal.ts";
import "../components/ui-date.ts";
import "../components/ui-select.ts";

const Base: typeof GlobalStyledLitElement = SignalWatcher(GlobalStyledLitElement);

export const tagName = "ui-subordinate-register";

type AnyRow = Record<string, unknown>;

@customElement(tagName)
export class UiSubordinateRegister extends Base {
  @property({ attribute: false }) register?: SubordinateRegister<AnyRow>;

  static override styles: CSSResultGroup = [tw, css`
    /* Рядок під курсором і заблокований рядок. Заливку задаємо тут, а не
       класами в розмітці: тема безшарова й перебила б utilities. */
    tbody tr:hover td { background-color: #f4f8fc; }
    tbody tr.locked td { color: #6b7785; }
  `];

  #bound?: SubordinateRegister<AnyRow>;

  protected override willUpdate() {
    if (this.register !== this.#bound) {
      this.#bound?.unbind(this);
      this.register?.bind(this);
      this.#bound = this.register;
    }
    // Картка могла щойно зберегтися й дістати id — перелік мусить ожити сам.
    this.register?.syncOwner();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#bound?.unbind(this);
    this.#bound = undefined;
  }

  // ── Комірка переліку ───────────────────────────────────────────────────────

  #cell(column: SubordinateColumn<AnyRow>, row: AnyRow): TemplateResult | string {
    if (column.render) return column.render(row);
    const value = row[column.key];
    if (value === null || value === undefined) return "";
    if (column.format) return formatDate(String(value), column.format) || String(value);
    if (typeof value === "boolean") return value ? "✓" : "";
    // Вкладений об'єкт-ссылка приходить як `{ id, name }` — показуємо підпис.
    if (typeof value === "object") {
      const ref = value as AnyRow;
      return String(ref.name ?? ref.presentation ?? ref.code ?? "");
    }
    return String(value);
  }

  #columnStyle(column: SubordinateColumn<AnyRow>): string {
    return column.width ? `width:${column.width}` : "";
  }

  #alignClass(column: SubordinateColumn<AnyRow>): string {
    return column.align === "right" ? "text-right tabular-nums" : column.align === "center" ? "text-center" : "";
  }

  // ── Поле редактора ─────────────────────────────────────────────────────────

  /**
   * Поле редактора. Підпис віддається САМОМУ контролу (`label`), а не
   * обгортці: контроли ui-kit уміють і підпис, і його позицію, і зірочку
   * обов'язковості, і червону рамку — своя обгортка навколо них означала б два
   * різні вигляди того самого поля на сусідніх екранах.
   */
  #field(field: SubordinateField<AnyRow>): TemplateResult {
    const register = this.register!;
    const draft = register.draft as AnyRow;
    const value = draft[field.key];
    const invalid = register.missingFields().includes(field.key) ? t("common.fieldRequired") : "";
    const width = field.width ?? "";
    const label = t(field.title);

    if (field.kind === "custom") return field.render?.(draft) ?? html``;

    if (field.kind === "picker") {
      const refKey = field.refKey ?? (field.key.endsWith("Id") ? field.key.slice(0, -2) : field.key);
      return html`
        <ui-picker
          url=${field.url ?? ""} label=${label} width=${width} size="sm"
          ?required=${field.required === true} invalid=${invalid}
          .value=${(draft[refKey] ?? null) as never}
          @value-changed=${(e: CustomEvent<{ value: { id: string } | null }>) => {
        register.patch(field.key, e.detail.value?.id ?? "");
        register.patch(refKey, e.detail.value ?? null);
      }}></ui-picker>`;
    }

    if (field.kind === "decimal") {
      return html`
        <ui-decimal
          label=${label} width=${width} size="sm"
          .precision=${field.precision ?? 2}
          ?required=${field.required === true} invalid=${invalid}
          .value=${String(value ?? "")}
          @value-changed=${(e: CustomEvent<{ value: string }>) => register.patch(field.key, e.detail.value)}
        ></ui-decimal>`;
    }

    if (field.kind === "date") {
      return html`
        <ui-date
          label=${label} size="sm"
          ?required=${field.required === true} invalid=${invalid}
          .value=${String(value ?? "")}
          @value-changed=${(e: CustomEvent<{ value: string }>) => register.patch(field.key, e.detail.value)}
        ></ui-date>`;
    }

    if (field.kind === "select") {
      return html`
        <ui-select
          label=${label} size="sm"
          ?required=${field.required === true} invalid=${invalid}
          .value=${String(value ?? "")}
          .options=${(field.options?.() ?? []) as never}
          @value-changed=${(e: CustomEvent<{ value: string }>) => register.patch(field.key, e.detail.value)}
        ></ui-select>`;
    }

    if (field.kind === "checkbox") {
      return html`
        <label class="flex items-center gap-2 pb-1">
          <input type="checkbox" class="checkbox checkbox-sm" .checked=${value === true}
            @change=${(e: Event) => register.patch(field.key, (e.target as HTMLInputElement).checked)} />
          <span class="text-sm">${label}</span>
        </label>`;
    }

    return html`
      <label class="flex flex-col gap-1">
        <span class="text-xs">${label}${field.required ? html`<span class="text-error"> *</span>` : nothing}</span>
        <input class="input input-sm ${invalid ? "input-error" : ""}"
          style=${width ? `width:${width}` : ""}
          .value=${String(value ?? "")}
          @input=${(e: Event) => register.patch(field.key, (e.target as HTMLInputElement).value)} />
      </label>`;
  }

  #renderEditor(): TemplateResult {
    const register = this.register!;
    return html`
      <div class="flex flex-wrap items-end gap-2 rounded border border-base-300 p-2">
        ${register.config.fields.map((field) => this.#field(field))}
        <span class="flex gap-1 pb-1">
          <button class="btn btn-sm btn-primary" @click=${() => void register.submit()}>
            ${t("common.save")}
          </button>
          <button class="btn btn-sm" @click=${() => register.cancel()}>${t("common.cancel")}</button>
        </span>
      </div>`;
  }

  // ── Панель ─────────────────────────────────────────────────────────────────

  override render(): TemplateResult {
    const register = this.register;
    if (!register) return html``;

    const columns = register.config.columns;
    const editable = register.ready && !register.readonly;

    return html`
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold">
            ${register.config.titleKey ? t(register.config.titleKey) : ""}
          </span>
          <button class="btn btn-xs" ?disabled=${!editable || Boolean(register.draft)}
            @click=${() => register.startAdd()}>+ ${t("common.create")}</button>
        </div>

        ${register.ready ? nothing : html`
          <span class="text-xs text-muted">${t("core.subordinate.saveOwnerFirst")}</span>`}

        ${register.error ? html`<span class="text-xs text-error">${register.error}</span>` : nothing}

        ${register.draft ? this.#renderEditor() : nothing}

        ${!register.ready ? nothing : register.rows.length === 0 && !register.loading
        ? html`<span class="text-xs text-muted">${t("common.noData")}</span>`
        : html`
          <table class="table table-sm w-full">
            <thead>
              <tr>
                ${columns.map((column) =>
          html`<th style=${this.#columnStyle(column)} class=${this.#alignClass(column)}>${t(column.title)}</th>`
        )}
                <th style="width:4.5rem"></th>
              </tr>
            </thead>
            <tbody>
              ${register.rows.map((row) => {
          const locked = register.locked(row);
          return html`
                <tr class=${locked ? "locked" : ""} title=${register.lockedReason(row)}>
                  ${columns.map((column) =>
            html`<td class=${this.#alignClass(column)}>${this.#cell(column, row)}</td>`
          )}
                  <td class="text-right whitespace-nowrap">
                    <button class="btn btn-ghost btn-xs" ?disabled=${!editable || locked}
                      title=${locked ? register.lockedReason(row) : t("common.open")}
                      @click=${() => register.startEdit(row)}>${icons.open}</button>
                    <button class="btn btn-ghost btn-xs" ?disabled=${!editable || locked}
                      title=${locked ? register.lockedReason(row) : t("common.delete")}
                      @click=${() => void register.remove(row)}>${icons.delete}</button>
                  </td>
                </tr>`;
        })}
            </tbody>
          </table>`}
      </div>`;
  }
}
