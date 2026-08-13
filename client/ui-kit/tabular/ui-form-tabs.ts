/**
 * Смуга вкладок форми — розкладка кількох табличних частин одного документа.
 *
 * ЧОМУ ВКЛАДКИ. Документ із однією табличною частиною — виняток: у предметній
 * області їх зазвичай три-шість, кожна на пів екрана, і поставлені стовпчиком
 * вони ховають шапку та одна одну. Людина працює з ОДНІЄЮ частиною за раз —
 * заповнює товари, потім послуги, — а решту їй треба бачити переліком.
 *
 * ```ts
 * <ui-form-tabs .tabs=${[
 *   { key: "goods",    titleKey: "supplierInvoice.goods",    section: this.goods },
 *   { key: "services", titleKey: "supplierInvoice.services", section: this.services },
 *   { key: "extra",    titleKey: "common.extra",             content: () => this.renderExtra() },
 * ]}></ui-form-tabs>
 * ```
 *
 * Вкладка з секцією малюється компонентом цілком (панель дій, таблиця,
 * кількість рядків, позначка помилки); `content` — лазівка для вкладки, у якій
 * не таблиця, а звичайні поля. Малюється тільки АКТИВНА панель: рядки живуть у
 * `$root` форми, тож сховане нічого не губить.
 *
 * ЧОМУ КОМПОНЕНТ, А НЕ ФУНКЦІЯ РОЗМІТКИ. Поля форми лежать у
 * `fieldset[disabled]` (так `BaseUI` вимикає режим перегляду), і його каскад
 * гасить УСІ нативні контроли всередині, зокрема кнопки: смуга з `<button>`
 * у світлому дереві форми переставала гортатися рівно на проведеному документі,
 * де дивитися сусідні частини й треба. Каскад `disabled` не перетинає межу
 * тіньового кореня — тому ВСЕРЕДИНІ компонента вкладка знову може бути
 * звичайною кнопкою з її клавіатурою й доступністю, а ловушки просто немає.
 * Вимкненими лишаються тулбар і таблиця в панелі — вони й мусять.
 *
 * Помилка в СХОВАНІЙ таблиці — найтонше місце вкладок: `BaseUI` перевіряє всі
 * секції з `sections()`, включно з невидимими, тож банер сказав би «Рядок 2,
 * «Сума»…», а рядка на екрані немає. Компонент вмикає потрібну вкладку сам —
 * правила вибору в `form-tabs-state.ts`, форма для цього нічого не пише.
 *
 * Вигляд — класи `.form-tab*` у темі (`client/styles/theme.css`), а не
 * `static styles`: кольори приходять токенами теми, і та сама смуга має
 * виглядати однаково скрізь.
 */
import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ReactiveControllerHost } from "lit";
import { GlobalStyledLitElement } from "../base/gsle.ts";
import { t } from "../../locale.ts";
import { activeTabKey } from "./form-tabs-state.ts";
// Панель активної вкладки складається з них — компонент мусить їх зареєструвати
// сам, інакше форма, яка малює вкладки, отримала б порожні теги.
import "./ui-tabular-table.ts";
import "./ui-tabular-toolbar.ts";

/**
 * Те, що вкладці треба від табличної частини. Тип **структурний** з тієї ж
 * причини, що `FormSection` у `BaseUI`: `TabularSection<Line>` не звести до
 * одного параметра типу (`setRows` контраваріантний), а сам примітив вкладці
 * потрібен рівно трьома полями. `TabularSection` задовольняє його як є.
 */
export interface FormTabSection {
  /** Кількість рядків — число поруч із назвою вкладки. */
  readonly rows: readonly unknown[];
  /** Скільки комірок не пройшли перевірку — позначка «тут помилка». */
  readonly errorCount: number;
  /** Ціль фокуса, яку ставить `BaseUI` при невдалій перевірці (див. нижче). */
  pendingFocus: { row: number; col: number } | null;
  bind(host: ReactiveControllerHost): void;
  unbind(host: ReactiveControllerHost): void;
}

export interface FormTab {
  /** Ключ вкладки — ним же компонент запам'ятовує активну. */
  key: string;
  /** Заголовок — ключ локалізації (проходить через `t()`). */
  titleKey: string;
  /** Таблична частина: панель дій, таблицю й лічильник компонент малює сам. */
  section?: FormTabSection;
  /** Або власний вміст панелі — вкладка зі звичайними полями. */
  content?: () => TemplateResult;
  /** Лічильник, коли він не виводиться із секції (вкладка з `content`). */
  count?: number;
}

export const tagName = "ui-form-tabs";

@customElement(tagName)
export class UiFormTabs extends GlobalStyledLitElement {
  @property({ attribute: false }) tabs: FormTab[] = [];

  @state() private _active = "";

  /** Ключ відкритої вкладки — формі, якщо їй треба це знати. */
  get activeKey(): string {
    return this._active;
  }

  /** Відкрити вкладку ззовні (форма веде користувача сама). */
  select(key: string) {
    if (this.tabs.some((tab) => tab.key === key)) this._active = key;
  }

  #bound = new Set<FormTabSection>();

  protected override willUpdate() {
    this.#rebind();
    // Правила вибору (прохання фокуса → поточна → перша) лежать окремо й без
    // DOM — вони перевіряються пробами, бо видно їх лише в рідкісний момент.
    this._active = activeTabKey(
      this.tabs.map((tab) => ({ key: tab.key, focusRequested: !!tab.section?.pendingFocus })),
      this._active,
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    for (const section of this.#bound) section.unbind(this);
    this.#bound.clear();
  }

  /** Підписка на секції: їхні зміни (рядки, помилки) міняють саму смугу. */
  #rebind() {
    const next = new Set(
      this.tabs.map((tab) => tab.section).filter((s): s is FormTabSection => !!s),
    );
    for (const section of this.#bound) if (!next.has(section)) section.unbind(this);
    for (const section of next) if (!this.#bound.has(section)) section.bind(this);
    this.#bound = next;
  }

  /**
   * Стрілки — те, чого чекають від `role="tablist"`. Enter і пробіл кнопка
   * обробляє сама, тож їх тут і немає. Фокус іде за вибором: інакше стрілка
   * перемикає вкладку, а клавіатура лишається на попередній.
   */
  #onKeyDown(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + this.tabs.length) % this.tabs.length;
    this._active = this.tabs[next].key;
    this.updateComplete.then(() => {
      this.renderRoot.querySelectorAll<HTMLButtonElement>(".form-tab")[next]?.focus();
    });
  }

  override render(): TemplateResult {
    const active = this.tabs.find((tab) => tab.key === this._active);
    return html`
      <div role="tablist" class="form-tabs">
        ${this.tabs.map((tab, index) => this.#renderTab(tab, index))}
      </div>
      <div role="tabpanel" class="form-tab-panel">
        ${active?.section
          ? html`
            <ui-tabular-toolbar .section=${active.section}></ui-tabular-toolbar>
            <ui-tabular-table .section=${active.section}></ui-tabular-table>
          `
          : active?.content?.() ?? nothing}
      </div>
    `;
  }

  #renderTab(tab: FormTab, index: number): TemplateResult {
    const current = tab.key === this._active;
    const errors = tab.section?.errorCount ?? 0;
    const count = tab.count ?? tab.section?.rows.length;
    return html`
      <button
        type="button"
        role="tab"
        class="form-tab"
        aria-selected=${current ? "true" : "false"}
        title=${errors ? t("tabular.tabErrors") : ""}
        tabindex=${current ? 0 : -1}
        @click=${() => { this._active = tab.key; }}
        @keydown=${(e: KeyboardEvent) => this.#onKeyDown(e, index)}
      >
        <span>${t(tab.titleKey)}</span>
        ${count === undefined ? nothing : html`<span class="form-tab-count">${count}</span>`}
        ${errors ? html`<span class="form-tab-error" aria-hidden="true">●</span>` : nothing}
      </button>
    `;
  }
}
