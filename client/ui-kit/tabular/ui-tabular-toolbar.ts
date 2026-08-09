/**
 * Таблична частина — ПАНЕЛЬ ДІЙ (окремий компонент, логіка — tabular-section.ts).
 *
 * Незалежний від таблиці: можна поставити де завгодно, замінити своїм або не
 * ставити взагалі — усі дії доступні на секції (`section.addLine()` тощо),
 * кастомний тулбар — це кілька кнопок із цими викликами.
 */
import { html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { GlobalStyledLitElement } from "../base/gsle.ts";
import { t } from "../../locale.ts";
import type { TabularSection } from "./tabular-section.ts";
import { icons } from "../icons.ts";


export const tagName = "ui-tabular-toolbar";

@customElement(tagName)
export class UiTabularToolbar extends GlobalStyledLitElement {
  @property({ attribute: false }) section?: TabularSection<Record<string, unknown>>;

  #bound?: TabularSection<Record<string, unknown>>;

  protected override willUpdate() {
    if (this.section !== this.#bound) {
      this.#bound?.unbind(this);
      this.section?.bind(this);
      this.#bound = this.section;
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#bound?.unbind(this);
    this.#bound = undefined;
  }

  override render(): TemplateResult {
    const section = this.section;
    if (!section) return html``;

    // У режимі перегляду панелі дій немає взагалі: жодна її кнопка не має сенсу,
    // а вимкнений ряд із п'яти кнопок лише займав би місце над таблицею.
    if (section.readonly) return html``;

    const current = section.currentIndex;
    const hasCurrent = current >= 0 && current < section.rows.length;

    // Панель уся `btn-ghost`: це смуга дій над таблицею, а не форма з кнопками.
    // Рамки тут малювали сітку поверх сітки, а іконки все одно несуть значення
    // самі — підпис лишився тільки в «Додати», бо це єдина дія, яку шукають
    // очима, а не після вибору рядка.
    return html`
      <div class="flex items-center gap-1">
        <button class="btn btn-sm btn-ghost" @click=${() => section.addLine()}>
          ${icons.add} ${t("tabular.add")}
        </button>
        <button class="btn btn-sm btn-ghost" ?disabled=${!hasCurrent} title=${t("tabular.copy")}
          @click=${() => section.copyLine()}>
          ${icons.copy}
        </button>
        <button class="btn btn-sm btn-ghost" ?disabled=${!hasCurrent} title=${t("tabular.delete")}
          @click=${() => section.removeLine()}>
          ${icons.clear}
        </button>
        <button class="btn btn-sm btn-ghost" ?disabled=${!hasCurrent || current === 0} title=${t("tabular.up")}
          @click=${() => section.move(-1)}>
          ${icons.moveUp}
        </button>
        <button class="btn btn-sm btn-ghost" ?disabled=${!hasCurrent || current === section.rows.length - 1}
          title=${t("tabular.down")} @click=${() => section.move(1)}>
          ${icons.moveDown}
        </button>
      </div>
    `;
  }
}
