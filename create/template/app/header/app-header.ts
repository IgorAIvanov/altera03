import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";
import { currentUser, logout } from "@client/auth/session.ts";
import { t } from "@client/locale.ts";
// Кнопка зауваження — компонент фреймворку; шапка лише дає їй місце.
import "@client/ui-kit/components/ui-remark.ts";
import "./change-password-dialog.ts";
import type { ChangePasswordDialog } from "./change-password-dialog.ts";

export const tagName = "app-header";

const Base = SignalWatcher(GlobalStyledLitElement);

/** Шапка застосунку: назва зліва, користувач, зміна пароля і вихід справа. */
@customElement(tagName)
export class AppHeader extends Base {
  override render(): TemplateResult {
    const user = currentUser();

    return html`
      <div class="flex items-center justify-between px-4 py-2 bg-primary text-primary-content">
        <span class="font-medium">{{name}}</span>
        <span class="flex items-center gap-3">
          <ui-remark></ui-remark>
          <span class="opacity-80">${user?.fullName ?? user?.login ?? ""}</span>
          <button class="btn btn-sm" @click=${this.#changePassword}>${t("header.changePassword")}</button>
          <button class="btn btn-sm" @click=${this.#logout}>${t("header.logout")}</button>
        </span>
      </div>
      <change-password-dialog></change-password-dialog>
    `;
  }

  /**
   * Без цього входу пароль змінюється рівно один раз: форма в `app/login/`
   * вмикається прапорцем `mustChangePassword()` і гасне разом із ним, а більше
   * до `changeOwnPassword()` у застосунку не веде нічого.
   */
  #changePassword() {
    this.renderRoot.querySelector<ChangePasswordDialog>("change-password-dialog")?.open();
  }

  async #logout() {
    await logout();
    location.reload();
  }
}
