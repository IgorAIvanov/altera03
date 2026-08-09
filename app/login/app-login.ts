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
import { t } from "@client/locale.ts";
import {
  type AuthMethodOption,
  type BootstrapState,
  createFirstUser,
  fetchAuthMethods,
  fetchBootstrapState,
  login,
  startRedirectLogin,
  takeAuthError,
  changeOwnPassword,
  mustChangePassword,
} from "@client/auth/session.ts";

@customElement("app-login")
export class AppLogin extends GlobalStyledLitElement {
  @state() private bootstrapState: BootstrapState | null = null;
  @state() private methods: AuthMethodOption[] = [];
  @state() private busy = false;
  @state() private error = "";

  @state() private login = "";
  @state() private password = "";
  @state() private fullName = "";

  override connectedCallback() {
    super.connectedCallback();
    // Причину відмови кладе в адресний рядок callback провайдера — забираємо її
    // до першого запиту, інакше вона потонула б у стані завантаження.
    this.error = takeAuthError();
    void this.loadBootstrapState();
  }

  private async loadBootstrapState() {
    this.busy = true;

    try {
      // Разом: стан першого запуску і доступні способи входу. Другий запит
      // вирішує, що взагалі малювати, тож чекати на нього окремо ні до чого.
      const [bootstrapState, methods] = await Promise.all([
        fetchBootstrapState(),
        fetchAuthMethods(),
      ]);

      this.bootstrapState = bootstrapState;
      this.methods = methods;
      this.login = bootstrapState.predefinedLogin ?? "";
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

  /**
   * Форма логіна й пароля потрібна, лише коли пароль увімкнений на сервері
   * (`AUTH_PASSWORD_ENABLED`). Інакше вхід іде тільки через провайдерів, і
   * порожні поля на екрані обіцяли б неіснуючу можливість.
   */
  private get hasPasswordLogin(): boolean {
    return this.methods.some((method) => method.kind === "direct");
  }

  private get redirectMethods(): AuthMethodOption[] {
    return this.methods.filter((method) => method.kind === "redirect");
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

      // Вхід міг привести до тимчасового пароля — тоді оболонку не піднімаємо,
      // а перемикаємо цей самий екран у стан зміни.
      if (mustChangePassword()) {
        this.changingPassword = true;
        this.password = "";
        return;
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
   * Підставити логін у перекладений рядок, лишивши його жирним.
   *
   * Рядок розрізається по `{login}`, а не склеюється з двох ключів: у частин
   * фрази немає власного сенсу, і мова, де підмет стоїть інакше, зібрала б із
   * них нісенітницю. Плейсхолдер усередині розмітки — випадок загальний, і це
   * найдешевший спосіб його закрити, поки `t()` не вміє підстановки сам.
   */
  private withLogin(text: string, login: string) {
    const [before, after = ""] = text.split("{login}");
    return html`${before}<b>${login}</b>${after}`;
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
            <h2 class="card-title">${t("login.unavailable")}</h2>
            <div class="alert alert-error text-sm">${this.error}</div>
            <button
              class="btn btn-primary w-full"
              @click=${this.loadBootstrapState}
              ?disabled=${this.busy}
            >
              ${this.busy ? "…" : t("login.retry")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Кнопки зовнішніх провайдерів.
   *
   * Не всередині `<form>`: це навігація браузера, а не надсилання форми, і
   * випадковий submit по Enter тут був би сюрпризом.
   */
  private renderRedirectMethods() {
    const methods = this.redirectMethods;
    if (!methods.length) {
      return nothing;
    }

    return html`
      ${this.hasPasswordLogin ? html`<div class="divider text-xs opacity-60">або</div>` : nothing}
      <div class="flex flex-col gap-2">
        ${methods.map((method) =>
          html`
            <button
              class="btn btn-outline w-full"
              type="button"
              ?disabled=${this.busy}
              @click=${() => startRedirectLogin(method.key)}
            >
              ${method.label}
            </button>
          `
        )}
      </div>
    `;
  }

  private renderPasswordForm(setup: boolean) {
    return html`
      <form class="flex flex-col gap-4" @submit=${this.submit}>
        ${setup
          ? html`<p class="text-sm opacity-70">${t("login.emptyDatabase")}</p>`
          : nothing}

        ${this.bootstrapState?.predefinedUserAvailable
          ? html`<p class="text-sm opacity-70">
              ${this.withLogin(t("login.predefined"), this.bootstrapState.predefinedLogin ?? "")}
            </p>`
          : nothing}

        <input
          class="input input-bordered w-full"
          placeholder=${t("login.login")}
          autocomplete="username"
          .value=${this.login}
          @input=${(e: Event) => this.login = (e.target as HTMLInputElement).value}
          required
        />

        ${setup
          ? html`<input
              class="input input-bordered w-full"
              placeholder=${t("login.fullName")}
              .value=${this.fullName}
              @input=${(e: Event) => this.fullName = (e.target as HTMLInputElement).value}
              required
            />`
          : nothing}

        <input
          class="input input-bordered w-full"
          type="password"
          placeholder=${t("login.password")}
          autocomplete=${setup ? "new-password" : "current-password"}
          .value=${this.password}
          @input=${(e: Event) => this.password = (e.target as HTMLInputElement).value}
          required
        />

        <button class="btn btn-primary w-full" type="submit" ?disabled=${this.busy}>
          ${this.busy ? "…" : setup ? t("login.setupSubmit") : t("login.submit")}
        </button>
      </form>
    `;
  }

  @state() private changingPassword = mustChangePassword();
  @state() private newPassword = "";

  /**
   * Обов'язкова зміна тимчасового пароля. Виникає для користувача, створеного
   * з BOOTSTRAP_PASSWORD: той пароль лежить відкритим текстом у .env. Поки
   * прапорець стоїть, сервер не виконує жодної команди моделі, тож пропустити
   * екран не можна — оболонка все одно була б порожньою.
   */
  private renderPasswordChange() {
    return html`
      <div class="min-h-screen flex items-center justify-center">
        <form class="w-80 flex flex-col gap-3 p-6 rounded border" @submit=${this.changePassword}>
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

          ${this.error ? html`<div class="text-error text-sm">${this.error}</div>` : nothing}

          <button class="btn btn-primary" ?disabled=${this.busy}>Зберегти й продовжити</button>
        </form>
      </div>
    `;
  }

  private changePassword = async (event: Event) => {
    event.preventDefault();
    this.busy = true;
    this.error = "";

    try {
      await changeOwnPassword(this.password, this.newPassword);
      location.reload();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  };

  override render() {
    if (this.changingPassword) return this.renderPasswordChange();

    if (!this.bootstrapState) {
      return this.error ? this.renderUnavailable() : html`<div class="p-8 text-center">…</div>`;
    }

    // Створення першого користувача паролем має сенс, лише поки пароль
    // увімкнений. Коли ні — першого адміністратора заводить сам вхід через
    // провайдера: на порожній базі зв'язка створюється разом із користувачем.
    const setup = this.isSetup && this.hasPasswordLogin;

    return html`
      <div class="min-h-screen flex items-center justify-center bg-base-200 p-4">
        <div class="card bg-base-100 shadow-xl w-full max-w-sm">
          <div class="card-body gap-4">
            <h2 class="card-title">${setup ? t("login.setupTitle") : t("login.title")}</h2>

            ${this.isSetup && !this.hasPasswordLogin
              ? html`<p class="text-sm opacity-70">${t("login.emptyDatabaseProvider")}</p>`
              : nothing}

            ${this.hasPasswordLogin ? this.renderPasswordForm(setup) : nothing}
            ${this.renderRedirectMethods()}

            ${this.error ? html`<div class="alert alert-error text-sm">${this.error}</div>` : nothing}

            ${!this.hasPasswordLogin && !this.redirectMethods.length
              ? html`<div class="alert alert-warning text-sm">
                  Сервер не пропонує жодного способу входу.
                </div>`
              : nothing}
          </div>
        </div>
      </div>
    `;
  }
}
