/**
 * Екран входу застосунку.
 *
 * Три стани одного компонента, а не три сторінки:
 *   · база порожня і предзаданого адміністратора немає → створення першого;
 *   · база порожня, але BOOTSTRAP_LOGIN заданий → вхід із підказкою;
 *   · звичайний вхід.
 *
 * Публічної реєстрації тут немає й не буде: створення першого користувача —
 * одноразова ініціалізація системи, а не самообслуговування.
 *
 * Це заготовка: логіка робоча, вигляд — мінімальний. Перемальовуйте як
 * завгодно, контракт зводиться до події `auth.success` після успішного входу.
 */
import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
// Не BaseUI: та база — для форм моделі з `$root` і схемою, а тут ні моделі,
// ні схеми немає. Потрібні лише спільні стилі.
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";
import {
  type BootstrapState,
  createFirstUser,
  fetchBootstrapState,
  login,
} from "@client/auth/session.ts";

@customElement("app-login")
export class AppLogin extends GlobalStyledLitElement {
  @state() private bootstrapState: BootstrapState | null = null;
  @state() private busy = false;
  @state() private error = "";

  @state() private login = "";
  @state() private password = "";
  @state() private fullName = "";

  override connectedCallback() {
    super.connectedCallback();
    void this.loadBootstrapState();
  }

  private async loadBootstrapState() {
    this.busy = true;
    this.error = "";

    try {
      this.bootstrapState = await fetchBootstrapState();
      this.login = this.bootstrapState.predefinedLogin ?? "";
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }

  /** Створювати першого користувача треба лише коли підставляти нема кого. */
  private get isSetup(): boolean {
    return !!this.bootstrapState?.needsSetup && !this.bootstrapState.predefinedUserAvailable;
  }

  private async submit(event: Event) {
    event.preventDefault();
    this.busy = true;
    this.error = "";

    try {
      if (this.isSetup) {
        await createFirstUser({
          login: this.login.trim(),
          password: this.password,
          fullName: this.fullName.trim(),
        });
      } else {
        await login({ login: this.login.trim(), password: this.password });
      }

      this.dispatchEvent(new CustomEvent("auth.success", { bubbles: true, composed: true }));
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.password = "";
    } finally {
      this.busy = false;
    }
  }

  /**
   * Стану ще немає. Досі це малювало «…» назавжди — навіть коли причина була
   * відома: помилка запису в `this.error` не мала де показатися, бо render()
   * виходив раніше. Тепер це два різні екрани: очікування і збій.
   */
  private renderUnavailable() {
    return html`
      <div class="min-h-screen flex items-center justify-center bg-base-200 p-4">
        <div class="card bg-base-100 shadow-xl w-full max-w-sm">
          <div class="card-body gap-4">
            <h2 class="card-title">Вхід недоступний</h2>
            <div class="alert alert-error text-sm">${this.error}</div>
            <button
              class="btn btn-primary w-full"
              @click=${this.loadBootstrapState}
              ?disabled=${this.busy}
            >
              ${this.busy ? "…" : "Спробувати ще раз"}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  override render() {
    if (!this.bootstrapState) {
      return this.error ? this.renderUnavailable() : html`<div class="p-8 text-center">…</div>`;
    }

    const setup = this.isSetup;

    return html`
      <div class="min-h-screen flex items-center justify-center bg-base-200 p-4">
        <form class="card bg-base-100 shadow-xl w-full max-w-sm" @submit=${this.submit}>
          <div class="card-body gap-4">
            <h2 class="card-title">${setup ? "Створення адміністратора" : "Вхід"}</h2>

            ${setup
              ? html`<p class="text-sm opacity-70">
                  База порожня. Створіть користувача, який керуватиме системою.
                </p>`
              : nothing}

            ${this.bootstrapState.predefinedUserAvailable
              ? html`<p class="text-sm opacity-70">
                  Увійдіть як <b>${this.bootstrapState.predefinedLogin}</b> — паролем із налаштувань.
                </p>`
              : nothing}

            <input
              class="input input-bordered w-full"
              placeholder="Логін"
              autocomplete="username"
              .value=${this.login}
              @input=${(e: Event) => this.login = (e.target as HTMLInputElement).value}
              required
            />

            ${setup
              ? html`<input
                  class="input input-bordered w-full"
                  placeholder="Повне ім'я"
                  .value=${this.fullName}
                  @input=${(e: Event) => this.fullName = (e.target as HTMLInputElement).value}
                  required
                />`
              : nothing}

            <input
              class="input input-bordered w-full"
              type="password"
              placeholder="Пароль"
              autocomplete=${setup ? "new-password" : "current-password"}
              .value=${this.password}
              @input=${(e: Event) => this.password = (e.target as HTMLInputElement).value}
              required
            />

            ${this.error ? html`<div class="alert alert-error text-sm">${this.error}</div>` : nothing}

            <button class="btn btn-primary w-full" type="submit" ?disabled=${this.busy}>
              ${this.busy ? "…" : setup ? "Створити й увійти" : "Увійти"}
            </button>
          </div>
        </form>
      </div>
    `;
  }
}
