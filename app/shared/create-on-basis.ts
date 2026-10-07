import { css, html, type CSSResultGroup } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";
import { t } from "@client/locale.ts";
import { basisTargets, type BasisTarget, openOnBasis } from "@client/tabs/open-on-basis.ts";

/**
 * Кнопка «Створити на підставі ▾» для командної панелі форми документа.
 *
 * Склад меню — метадані: які моделі називають цю в своєму `basedOn`, знає
 * сервер (`basisTargets`), тож форма-джерело не тримає списку цілей і не
 * міняється, коли з'являється нова ціль. Нічого вводити — кнопки немає.
 *
 * Живе в застосунку, а не у фреймворку, навмисно: ДЕ кнопка стоїть — у шапці
 * списку, у рядку, у формі — і як виглядає, вирішує застосунок. Фреймворк дає
 * лише склад і дорогу до чернетки (`openOnBasis`).
 *
 * Права тут не фільтруються: пункт без права відмовить сам, коли форма цілі
 * спробує заповнити чернетку.
 */
@customElement("app-create-on-basis")
export class AppCreateOnBasis extends GlobalStyledLitElement {
  static override styles: CSSResultGroup = [
    ...(GlobalStyledLitElement.styles as CSSResultGroup[]),
    css`:host { display: inline-block; }`,
  ];

  /** Модель документа-підстави, напр. `invoice`. */
  @property({ type: String }) model = "";

  /** Id документа-підстави; порожньо — документ ще не збережений, кнопка гасне. */
  @property({ type: String, attribute: "document-id" }) documentId = "";

  @state() private targets: BasisTarget[] = [];

  override connectedCallback() {
    super.connectedCallback();
    if (this.model) void basisTargets(this.model).then((targets) => this.targets = targets);
  }

  #open(target: BasisTarget, details: HTMLDetailsElement | null) {
    if (details) details.open = false;
    void openOnBasis(target, { model: this.model, id: this.documentId });
  }

  override render() {
    if (!this.targets.length) return "";
    const label = t("document.createOnBasis");

    // Незбережений документ підставою бути не може: у нього немає id.
    if (!this.documentId) {
      return html`<button class="btn btn-sm btn-outline" disabled>${label}</button>`;
    }

    return html`
      <details class="dropdown dropdown-end">
        <summary class="btn btn-sm btn-outline">${label} ▾</summary>
        <ul class="menu dropdown-content z-20 w-60 rounded-box bg-base-100 p-2 shadow">
          ${this.targets.map((target) => html`
            <li><a @click=${(e: Event) =>
              this.#open(target, (e.currentTarget as HTMLElement).closest("details"))}>
              ${target.titleKey ? t(target.titleKey) : target.model}
            </a></li>
          `)}
        </ul>
      </details>
    `;
  }
}
