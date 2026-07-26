import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";
import { currentUser, logout } from "@client/auth/session.ts";

export const tagName = "app-header";

const Base = SignalWatcher(GlobalStyledLitElement);

/** Шапка застосунку: назва зліва, користувач і вихід справа. */
@customElement(tagName)
export class AppHeader extends Base {
  override render(): TemplateResult {
    const user = currentUser();

    return html`
      <div class="flex items-center justify-between px-4 py-2 bg-primary text-primary-content">
        <span class="font-medium">{{name}}</span>
        <span class="flex items-center gap-3">
          <span class="opacity-80">${user?.fullName ?? user?.login ?? ""}</span>
          <button class="btn btn-sm" @click=${this.#logout}>Вийти</button>
        </span>
      </div>
    `;
  }

  async #logout() {
    await logout();
    location.reload();
  }
}
