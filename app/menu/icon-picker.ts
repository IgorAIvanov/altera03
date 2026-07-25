import { LitElement, html, css } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { t } from "@client/locale.ts";
import { menuIcons } from "./icons.ts";

/**
 * Вибір іконки меню сіткою, а не `select`-ом зі списком ключів.
 *
 * Причина не косметична: у `<option>` не можна покласти розмітку, тому список
 * показує самі лише ключі («account», «catalog»), і щоб зрозуміти, що саме
 * намальовано, доводиться вибирати навмання й дивитися на результат. На
 * десятку іконок це терпимо, на сотні — ні.
 *
 * Стилі власні, а не з Tailwind-збірки: компонент малює оверлей і сітку, тобто
 * майже нічого спільного з формою не має, а свій shadow root робить їх
 * незалежними від того, які утиліти потрапили в бандл.
 */
@customElement("icon-picker")
export class IconPicker extends LitElement {
  static override styles = css`
    :host { display: block; }

    .trigger {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      width: 100%;
      padding: 0.25rem 0.5rem;
      min-height: 1.75rem;
      background: transparent;
      border: 0;
      font: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .trigger:hover { background: rgba(47, 95, 143, 0.08); }
    .trigger .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .trigger .empty { opacity: 0.45; }

    .overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .dialog {
      background: var(--color-base-100, #fff);
      color: var(--color-base-content, #243746);
      border-radius: 0.5rem;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      width: 520px;
      max-width: 95vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 1rem;
      background: var(--color-primary, #2f5f8f);
      color: var(--color-primary-content, #fff);
      font-weight: 600;
      font-size: 0.875rem;
    }
    .close {
      background: transparent;
      border: 0;
      color: inherit;
      cursor: pointer;
      line-height: 1;
      font-size: 1.125rem;
    }
    .dialog-body { padding: 0.75rem 1rem; overflow-y: auto; }
    .dialog-footer {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border-top: 1px solid var(--color-base-300, #b8c3cc);
    }

    .search {
      width: 100%;
      padding: 0.375rem 0.5rem;
      margin-bottom: 0.75rem;
      border: 1px solid var(--color-base-300, #b8c3cc);
      border-radius: 0.25rem;
      font: inherit;
      color: inherit;
      background: var(--color-base-100, #fff);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
      gap: 0.375rem;
    }
    .cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      padding: 0.5rem 0.25rem;
      border: 1px solid transparent;
      border-radius: 0.25rem;
      background: transparent;
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    .cell:hover { background: rgba(47, 95, 143, 0.10); }
    .cell[aria-pressed="true"] {
      border-color: var(--color-primary, #2f5f8f);
      background: rgba(47, 95, 143, 0.14);
    }
    .cell .key {
      font-size: 0.6875rem;
      opacity: 0.7;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .btn {
      padding: 0.25rem 0.75rem;
      border: 1px solid var(--color-base-300, #b8c3cc);
      border-radius: 0.25rem;
      background: var(--color-base-100, #fff);
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    .btn:hover { background: rgba(47, 95, 143, 0.08); }

    .empty-result { opacity: 0.5; padding: 1rem 0; text-align: center; }
  `;

  /** Ключ поточної іконки; `null` — не задана. */
  @property({ type: String }) value: string | null = null;

  @state() private open = false;
  @state() private search = "";

  @query(".search") private searchInput?: HTMLInputElement;

  /**
   * Фокус ставиться тут, а не атрибутом `autofocus`: діалог з'являється вже
   * після завантаження документа, а на такі елементи браузер атрибут не
   * застосовує — поле лишалося б без фокуса, і пошук треба було б клікати.
   */
  private wasOpen = false;

  override updated() {
    // Тільки на момент відкриття: інакше кожне натискання в пошуку
    // перезабирало б фокус із сітки, куди щойно перейшли з клавіатури.
    if (this.open && !this.wasOpen) this.searchInput?.focus();
    this.wasOpen = this.open;
  }

  private get keys(): string[] {
    const needle = this.search.trim().toLowerCase();
    const all = Object.keys(menuIcons).sort();
    return needle ? all.filter((key) => key.toLowerCase().includes(needle)) : all;
  }

  private icon(key: string, size: number) {
    return html`
      <svg width=${size} height=${size} viewBox="0 0 24 24" fill="currentColor">
        <path d=${menuIcons[key]}></path>
      </svg>
    `;
  }

  private show() {
    this.search = "";
    this.open = true;
  }

  private hide() {
    this.open = false;
  }

  private pick(key: string | null) {
    this.open = false;
    this.dispatchEvent(new CustomEvent("icon-selected", {
      detail: { key },
      bubbles: true,
      composed: true,
    }));
  }

  /** Esc закриває діалог: обробник на самому оверлеї, бо фокус лишається в ньому. */
  private onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      this.hide();
    }
  }

  override render() {
    return html`
      <button class="trigger" type="button" @click=${this.show} title=${this.value ?? ""}>
        ${this.value && menuIcons[this.value]
          ? html`${this.icon(this.value, 16)}<span class="name">${this.value}</span>`
          : html`<span class="name empty">—</span>`}
      </button>

      ${this.open ? this.renderDialog() : ""}
    `;
  }

  private renderDialog() {
    const keys = this.keys;

    return html`
      <div class="overlay" @click=${this.hide} @keydown=${this.onKeyDown}>
        <div class="dialog" @click=${(e: Event) => e.stopPropagation()}>
          <div class="dialog-header">
            <span>${t("common.pick")}</span>
            <button class="close" type="button" @click=${this.hide} title=${t("common.close")}>×</button>
          </div>

          <div class="dialog-body">
            <input
              class="search"
              type="text"
              .value=${this.search}
              placeholder="${t("common.search")}..."
              @input=${(e: Event) => this.search = (e.target as HTMLInputElement).value}
            />

            ${keys.length === 0
              ? html`<div class="empty-result">${t("common.notFound")}</div>`
              : html`
                <div class="grid">
                  ${keys.map((key) => html`
                    <button
                      class="cell"
                      type="button"
                      aria-pressed=${key === this.value ? "true" : "false"}
                      title=${key}
                      @click=${() => this.pick(key)}
                    >
                      ${this.icon(key, 24)}
                      <span class="key">${key}</span>
                    </button>
                  `)}
                </div>
              `}
          </div>

          <div class="dialog-footer">
            <button class="btn" type="button" @click=${() => this.pick(null)}>${t("menu.iconNone")}</button>
            <button class="btn" type="button" @click=${this.hide}>${t("common.cancel")}</button>
          </div>
        </div>
      </div>
    `;
  }
}
