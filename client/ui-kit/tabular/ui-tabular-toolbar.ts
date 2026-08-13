/**
 * Таблична частина — ПАНЕЛЬ ДІЙ (окремий компонент, логіка — tabular-section.ts).
 *
 * Незалежний від таблиці: можна поставити де завгодно, замінити своїм або не
 * ставити взагалі — усі дії доступні на секції (`section.addLine()` тощо),
 * кастомний тулбар — це кілька кнопок із цими викликами.
 */
import { html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { GlobalStyledLitElement } from "../base/gsle.ts";
import { t } from "../../locale.ts";
import type { TabularSection } from "./tabular-section.ts";
import { icons } from "../icons.ts";

// `section.readonly` — це функція форми (`() => this.readonlyMode`), а та читає
// сигнали: право на запис і `$root.item.isPosted`. Без SignalWatcher панель про
// зміну не дізнається — власна властивість `section` лишається ТИМ САМИМ
// об'єктом, і після «Розпровести» кнопки лишалися вимкненими, доки користувач
// не перемкне вкладку (тоді в тулбар приїздить інша секція, і lit малює його
// заново). Тобто стан у формі був уже правильний — неправильним було лише те,
// що видно. `ui-tabular-table` тримається на цьому ж із самого початку.
const Base: typeof GlobalStyledLitElement = SignalWatcher(GlobalStyledLitElement);

export const tagName = "ui-tabular-toolbar";

@customElement(tagName)
export class UiTabularToolbar extends Base {
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

    // У режимі перегляду панель ЛИШАЄТЬСЯ, тільки вимкнена. Зникнення читалося б
    // як поламка: вимкнена кнопка каже «дія тут є, зараз не можна», відсутня —
    // «дії тут немає ніколи», а для щойно проведеного документа правильне саме
    // перше (розпровів — і панель повернулася). Плюс проведення не
    // перезавантажує форму, тож смуга з'являлася й зникала під курсором,
    // зсуваючи таблицю на висоту рядка кнопок.
    //
    // Кому потрібне саме зникнення — той просто не ставить компонент: тулбар
    // незалежний від таблиці, і власного прапорця для цього не треба.
    const ro = section.readonly;
    const current = section.currentIndex;
    const hasCurrent = !ro && current >= 0 && current < section.rows.length;

    // Панель уся `btn-ghost`: це смуга дій над таблицею, а не форма з кнопками.
    // Рамки тут малювали сітку поверх сітки, а іконки все одно несуть значення
    // самі — підпис лишився тільки в «Додати», бо це єдина дія, яку шукають
    // очима, а не після вибору рядка.
    return html`
      <div class="flex items-center gap-1">
        <button class="btn btn-sm btn-ghost" ?disabled=${ro} @click=${() => section.addLine()}>
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
