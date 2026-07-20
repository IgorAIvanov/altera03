import { LitElement, html, css, svg } from "lit";
import { customElement, state } from "lit/decorators.js";

@customElement("app-header")
export class AppHeader extends LitElement {
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

    .app-name {
      font-weight: 500;
      letter-spacing: 0.02em;
      opacity: 0.95;
    }

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

  // TODO: получать из шины / сервера
  private appName = "Altera ERP";
  private userName = "Адміністратор";
  private userRole = "Системний адміністратор";

  private iconUser() {
    return svg`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
    </svg>`;
  }

  private iconChevron() {
    return svg`<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 10l5 5 5-5z"/>
    </svg>`;
  }

  private iconSettings() {
    return svg`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
    </svg>`;
  }

  private iconLogout() {
    return svg`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
    </svg>`;
  }

  private iconPassword() {
    return svg`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
    </svg>`;
  }

  private initials(): string {
    return this.userName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  }

  private handleLogout() {
    this.open = false;
    // TODO: bus.emit logout
    console.log("logout");
  }

  override render() {
    return html`
      <div class="app-name">${this.appName}</div>

      <div class="user-btn" @click=${() => this.open = !this.open}>
        <div class="avatar">${this.initials()}</div>
        <span class="user-name">${this.userName}</span>
        <span class="chevron ${this.open ? "open" : ""}">${this.iconChevron()}</span>
      </div>

      ${this.open ? html`
        <div class="overlay" @click=${() => this.open = false}></div>
        <div class="dropdown">
          <div class="dropdown-header">
            <strong>${this.userName}</strong>
            ${this.userRole}
          </div>
          <div class="dropdown-item" @click=${() => this.open = false}>
            ${this.iconSettings()} Налаштування профілю
          </div>
          <div class="dropdown-item" @click=${() => this.open = false}>
            ${this.iconPassword()} Змінити пароль
          </div>
          <div class="dropdown-divider"></div>
          <div class="dropdown-item danger" @click=${this.handleLogout}>
            ${this.iconLogout()} Вийти
          </div>
        </div>
      ` : ""}
    `;
  }
}
