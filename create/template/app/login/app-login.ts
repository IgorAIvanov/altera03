import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";
import {
  changeOwnPassword,
  createFirstUser,
  fetchBootstrapState,
  login,
  mustChangePassword,
  type BootstrapState,
} from "@client/auth/session.ts";

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
  /** Вхід відбувся, але пароль тимчасовий — показуємо зміну замість оболонки. */
  @state() private changing = mustChangePassword();
  @state() private newPassword = "";

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
    if (this.changing) return this.#renderPasswordChange();

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

  /**
   * Обов'язкова зміна пароля. Виникає, коли користувача створив bootstrap із
   * BOOTSTRAP_PASSWORD: той пароль лежить відкритим текстом у .env і відомий
   * усім, хто бачив файл. Пропустити екран не можна — сервер під цим
   * прапорцем не виконує жодної команди моделі.
   */
  #renderPasswordChange(): TemplateResult {
    return html`
      <div class="min-h-screen flex items-center justify-center">
        <form class="w-80 flex flex-col gap-3 p-6 rounded border" @submit=${this.#changePassword}>
          <h1 class="text-lg font-medium">Змініть тимчасовий пароль</h1>
          <p class="text-sm opacity-70">
            Пароль задано в налаштуваннях сервера, тому працювати з ним не можна.
          </p>

          <!-- Підпис, а не лише placeholder: той зникає, щойно почали писати, і
               саме на цьому екрані два поля password візуально не відрізнити. -->
          <label class="flex flex-col gap-1 text-sm">
            <span>Поточний пароль</span>
            <input class="input" type="password" .value=${this.password}
                   @input=${(e: Event) => this.password = (e.target as HTMLInputElement).value} />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span>Новий пароль</span>
            <input class="input" type="password" .value=${this.newPassword}
                   @input=${(e: Event) => this.newPassword = (e.target as HTMLInputElement).value} />
          </label>

          ${this.error ? html`<div class="text-error text-sm">${this.error}</div>` : ""}

          <button class="btn btn-primary" ?disabled=${this.busy}>Зберегти й продовжити</button>
        </form>
      </div>
    `;
  }

  async #changePassword(event: Event) {
    event.preventDefault();
    this.busy = true;
    this.error = "";

    try {
      await changeOwnPassword(this.password, this.newPassword);
      location.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
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
      // Вхід міг привести до тимчасового пароля — тоді не перезавантажуємо
      // сторінку, а перемикаємо цей самий екран у стан зміни.
      if (mustChangePassword()) {
        this.changing = true;
        this.password = "";
        return;
      }

      location.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
  }
}
