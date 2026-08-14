import { html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";
import { changeOwnPassword } from "@client/auth/session.ts";
import { t } from "@client/locale.ts";
import "@client/ui-kit/components/ui-dialog.ts";

export const tagName = "change-password-dialog";

/**
 * Добровільна зміна власного пароля — з меню користувача в шапці.
 *
 * Окремий компонент, а не розмітка в `app-header`: шапка вже велика, а тут
 * власний стан із трьох полів і помилкою. Обов'язкова зміна тимчасового пароля
 * живе не тут, а в `app/login/app-login.ts` — там вона стан екрана входу, бо
 * до неї застосунок узагалі не піднімається.
 *
 * Поточний пароль питає сервер (`POST /api/auth/change-password`), а не ця
 * форма: перевірка на клієнті нічого не варта. Тут він лише збирається.
 */
@customElement(tagName)
export class ChangePasswordDialog extends GlobalStyledLitElement {
  /**
   * Стан вікна тримає ВЛАСНИК, а `<ui-dialog>` його лише показує: закриття
   * приходить сюди подією. Якби вікно гасило прапорець само, після Esc власник
   * вважав би його відкритим і не зміг би показати вдруге.
   */
  @state() private opened = false;

  @state() private current = "";
  @state() private next = "";
  @state() private repeat = "";
  @state() private error = "";
  @state() private done = false;
  @state() private busy = false;

  open(): void {
    this.current = "";
    this.next = "";
    this.repeat = "";
    this.error = "";
    this.done = false;
    this.opened = true;
  }

  #close = () => {
    this.opened = false;
    this.done = false;
  };

  override render(): TemplateResult {
    return html`
      <ui-dialog
        .open=${this.opened}
        heading=${this.done ? t("header.passwordChanged") : t("header.passwordTitle")}
        style="--ui-dialog-width: 22rem"
        @ui-dialog-close=${this.#close}
      >
        ${this.done ? this.renderDone() : this.renderForm()}
        <div slot="actions">${this.renderActions()}</div>
      </ui-dialog>
    `;
  }

  private renderForm(): TemplateResult {
    return html`
      <!-- Форма лишається, хоча кнопки з неї переїхали в полицю дій: на ній
           тримається ввід з клавіатури — Enter у полі зберігає пароль. -->
      <form class="flex flex-col gap-3" @submit=${this.submit}>
        <input class="input" type="password" placeholder=${t("header.passwordCurrent")} .value=${this.current}
               @input=${(e: Event) => this.current = (e.target as HTMLInputElement).value} />
        <input class="input" type="password" placeholder=${t("header.passwordNew")} .value=${this.next}
               @input=${(e: Event) => this.next = (e.target as HTMLInputElement).value} />
        <input class="input" type="password" placeholder=${t("header.passwordRepeat")} .value=${this.repeat}
               @input=${(e: Event) => this.repeat = (e.target as HTMLInputElement).value} />

        ${this.error ? html`<div class="text-error text-sm">${this.error}</div>` : nothing}
      </form>
    `;
  }

  private renderDone(): TemplateResult {
    return html`<p class="text-sm opacity-70">${t("header.passwordChangedHint")}</p>`;
  }

  private renderActions(): TemplateResult {
    if (this.done) {
      return html`
        <button class="btn btn-sm btn-primary" @click=${this.#close}>${t("common.close")}</button>
      `;
    }
    return html`
      <button type="button" class="btn btn-sm" @click=${this.#close}>${t("common.cancel")}</button>
      <!-- type="button", а не submit: кнопка стоїть поза формою, тож натискання
           веде сюди напряму, а Enter усередині форми — через її @submit. Двічі
           не спрацює: submit-кнопки у формі більше немає. -->
      <button type="button" class="btn btn-sm btn-primary" ?disabled=${this.busy}
        @click=${this.submit}>${t("common.save")}</button>
    `;
  }

  private submit = async (event: Event) => {
    event.preventDefault();

    // Єдина перевірка, яку має сенс робити тут: сервер другого поля не бачить.
    // Довжину й правильність поточного пароля перевіряє він.
    if (this.next !== this.repeat) {
      this.error = t("header.passwordMismatch");
      return;
    }

    this.busy = true;
    this.error = "";

    try {
      await changeOwnPassword(this.current, this.next);
      this.done = true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  };
}
