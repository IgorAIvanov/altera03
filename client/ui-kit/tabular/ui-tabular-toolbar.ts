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

const icon = {
  add: html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  copy: html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  del: html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`,
  up: html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>`,
  down: html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`,
};

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

    return html`
      <div class="flex items-center gap-1">
        <button class="btn btn-sm" @click=${() => section.addLine()}>
          ${icon.add} ${t("tabular.add")}
        </button>
        <button class="btn btn-sm" ?disabled=${!hasCurrent} title=${t("tabular.copy")}
          @click=${() => section.copyLine()}>
          ${icon.copy}
        </button>
        <button class="btn btn-sm text-error" ?disabled=${!hasCurrent} title=${t("tabular.delete")}
          @click=${() => section.removeLine()}>
          ${icon.del}
        </button>
        <button class="btn btn-sm" ?disabled=${!hasCurrent || current === 0} title=${t("tabular.up")}
          @click=${() => section.move(-1)}>
          ${icon.up}
        </button>
        <button class="btn btn-sm" ?disabled=${!hasCurrent || current === section.rows.length - 1}
          title=${t("tabular.down")} @click=${() => section.move(1)}>
          ${icon.down}
        </button>
      </div>
    `;
  }
}
