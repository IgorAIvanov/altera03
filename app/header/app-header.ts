import { LitElement, html, css, svg } from "lit";
import { customElement, state } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { bus } from "@client/bus/bus.ts";
import { currentUser, logout } from "@client/auth/session.ts";
// Побічним ефектом, а не значенням: `ChangePasswordDialog` тут потрібен лише
// як тип, і звичайний іменований імпорт esbuild вирізає разом із модулем —
// тоді @customElement не виконується й тег лишається невизначеним.
import "./change-password-dialog.ts";
import type { ChangePasswordDialog } from "./change-password-dialog.ts";
import "./access-token-dialog.ts";
import type { AccessTokenDialog } from "./access-token-dialog.ts";
import { availableLocales, getLocale, localeName, t } from "@client/locale.ts";
import { currentOrg, knownOrgs, loadOrgs, orgsError, setCurrentOrg } from "@shared/current-organization.ts";

@customElement("app-header")
export class AppHeader extends SignalWatcher(LitElement) {
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 32px;
      padding: 0 10px;
      background: #234a6f;
      color: #e8f0fb;
      font-family: "Roboto", sans-serif;
      font-size: var(--default-font-size, 0.875rem);
      flex-shrink: 0;
    }

    /* Діалог зміни пароля в розкладці шапки участі не бере. :host тут —
       flex із space-between на двох блоках (ліворуч меню, праворуч організація
       й користувач); третій дочірній елемент розтягував би розподіл і зсував
       правий блок до центру. display: contents прибирає коробку самого
       елемента, а вміст його shadow root (сам dialog) лишається — і
       відкривається в top layer, як і має.
       (Зворотних лапок у коментарі всередині css-шаблона бути не може —
       вони обривають сам шаблонний рядок.) */
    change-password-dialog,
    access-token-dialog {
      display: contents;
    }

    .right {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .app-name {
      font-weight: 500;
      letter-spacing: 0.02em;
      opacity: 0.95;
      flex-shrink: 0;
    }

    /* Поточна організація */
    .org-wrap { position: relative; }

    .org-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      padding: 3px 6px;
      border-radius: 2px;
      max-width: 280px;
      background: rgba(255, 255, 255, 0.08);
    }
    .org-btn:hover { background: rgba(255, 255, 255, 0.18); }

    .org-icon { opacity: 0.7; flex-shrink: 0; }

    .org-name {
      font-size: inherit;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .org-name.placeholder { opacity: 0.6; font-style: italic; }

    /* Мова інтерфейсу. Кнопка, а не div з @click: дія має існувати й для
       клавіатури. Через це ж — скидання оформлення: у shadow root цього
       компонента немає ані теми, ані Tailwind (він наслідує LitElement, а не
       GlobalStyledLitElement), тож <button> прийшов би зі стилями браузера. */
    .lang-wrap { position: relative; }

    .lang-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 6px;
      border: 0;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.08);
      color: inherit;
      font: inherit;
      line-height: 1;
      cursor: pointer;
    }
    .lang-btn:hover { background: rgba(255, 255, 255, 0.18); }

    .lang-code {
      font-weight: 500;
      letter-spacing: 0.04em;
    }

    /* Випадне меню верхньої панелі — спільне для організацій і для мови */
    .hdr-menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      background: var(--color-primary, #2f5f8f);
      color: #e8f0fb;
      border: 1px solid #244b71;
      border-radius: 2px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 1000;
      min-width: 220px;
      max-height: 60vh;
      overflow-y: auto;
      padding: 2px 0;
    }

    .hdr-menu-empty {
      padding: 8px 12px;
      font-size: 12px;
      opacity: 0.7;
      white-space: nowrap;
    }
    /* Відмова — не те саме, що порожній довідник, і виглядати однаково вони не мають. */
    .hdr-menu-empty.error {
      color: #ffd0d0;
      opacity: 1;
      white-space: normal;
      max-width: 260px;
    }

    .hdr-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 12px 6px 10px;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      white-space: nowrap;
    }
    .hdr-menu-item:hover { background: var(--color-secondary, #4a7ab5); }
    .hdr-menu-item.active {
      font-weight: 500;
      background: rgba(255, 255, 255, 0.12);
    }

    .hdr-check {
      width: 14px;
      flex-shrink: 0;
      color: #9be6b4;
      opacity: 0;
    }
    .hdr-menu-item.active .hdr-check { opacity: 1; }

    /* Кнопка пользователя */
    .user-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      padding: 3px 6px;
      border-radius: 2px;
      position: relative;
    }
    .user-btn:hover { background: rgba(255,255,255,0.1); }

    .avatar {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #4a7ab5;
      color: #fff;
      flex-shrink: 0;
    }

    .user-name {
      font-size: inherit;
      opacity: 0.9;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chevron {
      opacity: 0.6;
      transition: transform 0.15s;
    }
    .chevron.open { transform: rotate(180deg); }

    /* Выпадающее меню */
    .dropdown {
      position: fixed;
      top: 32px;
      right: 8px;
      background: #fff;
      color: #1f2937;
      border: 1px solid #b0bec5;
      border-radius: 2px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 1000;
      min-width: 180px;
      overflow: hidden;
    }

    .dropdown-header {
      padding: 8px 12px;
      background: #f4f7fb;
      border-bottom: 1px solid #dde3ea;
      font-size: 11px;
      color: #6b7280;
    }
    .dropdown-header strong {
      display: block;
      font-size: inherit;
      color: #1f2937;
      margin-bottom: 1px;
    }

    .dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      font-size: inherit;
      cursor: pointer;
    }
    .dropdown-item:hover { background: var(--color-base-200, #dfe5ea); }
    .dropdown-item.danger { color: #dc2626; }
    .dropdown-item.danger:hover { background: #fef2f2; }

    .dropdown-divider {
      height: 1px;
      background: #e5e7eb;
      margin: 2px 0;
    }

    /* Оверлей для закрытия */
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 999;
    }
  `;

  @state() private open = false;
  @state() private orgOpen = false;
  @state() private langOpen = false;
  @state() private locales: string[] = [];
  // Перелік організацій і причина його порожнечі більше не власний стан шапки:
  // він живе в `@shared/current-organization.ts`, бо його питає ще й фреймворк
  // (відбір за організацією в журналі документів). Сигнали — тож перемальовує
  // сам, без @state.

  private appName = "Altera ERP";
  /** Вихід уже почався: другий клік нічого не додасть, крім другого запиту. */
  @state() private loggingOut = false;

  /**
   * Хто увійшов — із сесії, а не з константи. Читання сигналу, тож
   * `SignalWatcher` перемалює шапку, щойно користувач зміниться.
   */
  private get userName(): string {
    const user = currentUser();
    if (!user) return "";
    return user.fullName.trim() || user.login;
  }

  /**
   * Підпис під іменем — логін.
   *
   * Ролі тут немає навмисно: сесія її не несе. Права в цій системі — це трійки
   * «група → модель → дія» (`app.access_effective`), і звести їх до одного слова
   * без втрати сенсу не можна. Показувати назви груп теж можна, але це окремий
   * запит і окреме рішення; логін принаймні не бреше.
   */
  private get userSubtitle(): string {
    return currentUser()?.login ?? "";
  }

  private iconUser() {
    return svg`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
    </svg>`;
  }

  private iconChevron() {
    return svg`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 10l5 5 5-5z"/>
    </svg>`;
  }

  private iconSettings() {
    return svg`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
    </svg>`;
  }

  private iconLogout() {
    return svg`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
    </svg>`;
  }

  private iconKey() {
    return svg`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
    </svg>`;
  }

  private iconPassword() {
    return svg`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
    </svg>`;
  }

  private iconBuilding() {
    return svg`<svg class="org-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/>
    </svg>`;
  }

  private iconCheck() {
    return svg`<svg class="hdr-check" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
    </svg>`;
  }

  private initials(): string {
    const words = this.userName.split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    return words.map(w => w[0]).join("").slice(0, 2).toUpperCase();
  }

  /**
   * Відкрити/закрити список організацій.
   *
   * Перечитувати перелік тут більше не треба: його завантажує composition root
   * одразу після входу, і міняється він приблизно ніколи. Повторне читання
   * лишається на випадок відмови — порожній перелік з причиною варто спробувати
   * ще раз.
   */
  private toggleOrgMenu() {
    this.orgOpen = !this.orgOpen;
    if (this.orgOpen && knownOrgs().length === 0) void loadOrgs();
  }

  private selectOrg(o: { id: string; name: string }) {
    setCurrentOrg(o);
    this.orgOpen = false;
  }

  /** Відкрити/закрити перемикач мови; перелік читається на першому відкритті. */
  private async toggleLangMenu() {
    this.langOpen = !this.langOpen;
    if (this.langOpen && this.locales.length === 0) {
      this.locales = await availableLocales();
    }
  }

  /**
   * Зміна мови — з перезавантаженням сторінки, а не на місці.
   *
   * `t()` читає мапу перекладів, а не сигнал: уже намальовані екрани її не
   * слухають і після `setLocale` лишилися б старою мовою до наступної
   * перемальовки. Зробити `t()` реактивним означало б вимагати реактивного
   * контексту скрізь, де він викликається, — включно з масивами колонок, які
   * будуються один раз. Перезавантаження ж коштує рівно нічого: відкриті
   * вкладки відновлюються зі сховища, а сесія живе в cookie. Той самий довід,
   * що й у `handleLogout`.
   */
  private selectLocale(code: string) {
    this.langOpen = false;
    if (code === getLocale()) return;

    localStorage.setItem("locale", code);
    globalThis.location.reload();
  }

  private async handleLogout() {
    if (this.loggingOut) return;
    this.loggingOut = true;
    this.open = false;

    try {
      await logout();
    } finally {
      // Перезавантаження, а не локальне скидання стану: так гарантовано зникає
      // все, що встигло намалюватися для попереднього користувача — відкриті
      // вкладки з його даними в тому числі. Той самий підхід, що й у
      // `setSessionLostHandler` (client/auth/session.ts).
      //
      // У `finally`, бо `logout()` і сам не кидає марно: сесію він скидає
      // локально навіть тоді, коли запит до сервера не пройшов, і лишати
      // користувача в напівстані через мережевий збій не можна.
      globalThis.location.reload();
    }
  }

  override render() {
    const org = currentOrg();

    return html`
      <div class="app-name">${this.appName}</div>

      <div class="right">
        <div class="org-wrap">
          <div class="org-btn" title=${t("header.currentOrganization")} @click=${this.toggleOrgMenu}>
            ${this.iconBuilding()}
            ${org
              ? html`<span class="org-name">${org.name}</span>`
              : html`<span class="org-name placeholder">${t("header.chooseOrganization")}</span>`}
            <span class="chevron ${this.orgOpen ? "open" : ""}">${this.iconChevron()}</span>
          </div>

          ${this.orgOpen ? html`
            <div class="overlay" @click=${() => this.orgOpen = false}></div>
            <div class="hdr-menu">
              ${knownOrgs().length === 0
                ? html`<div class="hdr-menu-empty ${orgsError() ? "error" : ""}">
                    ${orgsError() || t("common.noData")}
                  </div>`
                : knownOrgs().map(o => html`
                  <button type="button" class="hdr-menu-item ${o.id === org?.id ? "active" : ""}"
                    @click=${() => this.selectOrg(o)}>
                    ${this.iconCheck()}
                    <span class="org-name">${o.name}</span>
                  </button>
                `)}
            </div>
          ` : ""}
        </div>

        <div class="lang-wrap">
          <button type="button" class="lang-btn"
            title=${t("header.language")} aria-label=${t("header.language")}
            @click=${this.toggleLangMenu}>
            <span class="lang-code">${getLocale().toUpperCase()}</span>
            <span class="chevron ${this.langOpen ? "open" : ""}">${this.iconChevron()}</span>
          </button>

          ${this.langOpen ? html`
            <div class="overlay" @click=${() => this.langOpen = false}></div>
            <div class="hdr-menu">
              ${this.locales.map(code => html`
                <button type="button" class="hdr-menu-item ${code === getLocale() ? "active" : ""}"
                  @click=${() => this.selectLocale(code)}>
                  ${this.iconCheck()}
                  <span>${localeName(code)}</span>
                </button>
              `)}
            </div>
          ` : ""}
        </div>

        <div class="user-btn" @click=${() => this.open = !this.open}>
          <div class="avatar">${this.initials()}</div>
          <span class="user-name">${this.userName}</span>
          <span class="chevron ${this.open ? "open" : ""}">${this.iconChevron()}</span>
        </div>
      </div>

      ${this.open ? html`
        <div class="overlay" @click=${() => this.open = false}></div>
        <div class="dropdown">
          <div class="dropdown-header">
            <strong>${this.userName}</strong>
            ${this.userSubtitle}
          </div>
          <div class="dropdown-item" @click=${() => this.open = false}>
            ${this.iconSettings()} ${t("header.profileSettings")}
          </div>
          <div class="dropdown-item" @click=${this.openAccessTokens}>
            ${this.iconKey()} ${t("header.tokens")}
          </div>
          <div class="dropdown-item" @click=${this.openPasswordChange}>
            ${this.iconPassword()} ${t("header.changePassword")}
          </div>
          <div class="dropdown-divider"></div>
          <div class="dropdown-item danger" @click=${this.handleLogout}>
            ${this.iconLogout()} ${this.loggingOut ? t("header.loggingOut") : t("header.logout")}
          </div>
        </div>
      ` : ""}

      <change-password-dialog></change-password-dialog>
      <access-token-dialog></access-token-dialog>
    `;
  }

  /**
   * Діалог живе поза випадним меню й переживає його закриття — інакше форма
   * зникала б разом із меню на першому ж кліку повз неї.
   */
  private openAccessTokens = () => {
    this.open = false;
    this.renderRoot.querySelector<AccessTokenDialog>("access-token-dialog")?.open();
  };

  private openPasswordChange = () => {
    this.open = false;
    this.renderRoot.querySelector<ChangePasswordDialog>("change-password-dialog")?.open();
  };
}
