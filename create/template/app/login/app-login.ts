import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";
import { createFirstUser, fetchBootstrapState, login, type BootstrapState } from "@client/auth/session.ts";

export const tagName = "app-login";

/**
 * Екран входу належить застосунку — фреймворк дає тільки виклики
 * (`@client/auth/session.ts`). Перший запуск не окрема сторінка, а стан цього ж
 * екрана: на порожній базі форма заводить першого адміністратора.
 */
@customElement(tagName)
export class AppLogin extends GlobalStyledLitElement {
  @state() private state: BootstrapState | null = null;
  @state() private login = "";
  @state() private password = "";
  @state() private error = "";
  @state() private busy = false;

  override async connectedCallback() {
    super.connectedCallback();
    try {
      this.state = await fetchBootstrapState();
      this.login = this.state.predefinedLogin ?? "";
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  private get needsSetup(): boolean {
    return !!this.state?.needsSetup && !this.state.predefinedUserAvailable;
  }

  override render(): TemplateResult {
    return html`
      <div class="min-h-screen flex items-center justify-center">
        <form class="w-80 flex flex-col gap-3 p-6 rounded border" @submit=${this.#submit}>
          <h1 class="text-lg font-medium">
            ${this.needsSetup ? "Перший запуск: створіть адміністратора" : "{{name}}"}
          </h1>

          <input class="input" placeholder="Логін" .value=${this.login}
                 @input=${(e: Event) => this.login = (e.target as HTMLInputElement).value} />
          <input class="input" type="password" placeholder="Пароль" .value=${this.password}
                 @input=${(e: Event) => this.password = (e.target as HTMLInputElement).value} />

          ${this.error ? html`<div class="text-error text-sm">${this.error}</div>` : ""}

          <button class="btn btn-primary" ?disabled=${this.busy}>
            ${this.needsSetup ? "Створити й увійти" : "Увійти"}
          </button>
        </form>
      </div>
    `;
  }

  async #submit(event: Event) {
    event.preventDefault();
    this.busy = true;
    this.error = "";

    try {
      if (this.needsSetup) {
        await createFirstUser({ login: this.login.trim(), password: this.password, fullName: this.login.trim() });
      } else {
        await login({ login: this.login.trim(), password: this.password });
      }
      location.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
  }
}
