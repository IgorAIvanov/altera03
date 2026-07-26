import { html, nothing, type TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";
import { changeOwnPassword } from "@client/auth/session.ts";

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
  @query("dialog") private dialogEl!: HTMLDialogElement;

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
    this.dialogEl.showModal();
  }

  override render(): TemplateResult {
    return html`
      <!-- m-auto обов'язковий: preflight Tailwind обнуляє margin усім
           елементам, а нативне центрування модального dialog тримається саме
           на margin: auto з UA-стилів. -->
      <dialog class="m-auto p-6 rounded border w-80" @close=${() => this.done = false}>
        ${this.done ? this.renderDone() : this.renderForm()}
      </dialog>
    `;
  }

  private renderForm(): TemplateResult {
    return html`
      <form class="flex flex-col gap-3" @submit=${this.submit}>
        <h2 class="text-lg font-medium">Зміна пароля</h2>

        <input class="input" type="password" placeholder="Поточний пароль" .value=${this.current}
               @input=${(e: Event) => this.current = (e.target as HTMLInputElement).value} />
        <input class="input" type="password" placeholder="Новий пароль" .value=${this.next}
               @input=${(e: Event) => this.next = (e.target as HTMLInputElement).value} />
        <input class="input" type="password" placeholder="Новий пароль ще раз" .value=${this.repeat}
               @input=${(e: Event) => this.repeat = (e.target as HTMLInputElement).value} />

        ${this.error ? html`<div class="text-error text-sm">${this.error}</div>` : nothing}

        <div class="flex justify-end gap-2">
          <button type="button" class="btn" @click=${() => this.dialogEl.close()}>Скасувати</button>
          <button class="btn btn-primary" ?disabled=${this.busy}>Зберегти</button>
        </div>
      </form>
    `;
  }

  private renderDone(): TemplateResult {
    return html`
      <div class="flex flex-col gap-3">
        <h2 class="text-lg font-medium">Пароль змінено</h2>
        <p class="text-sm opacity-70">Наступний вхід — уже з новим паролем.</p>
        <div class="flex justify-end">
          <button class="btn btn-primary" @click=${() => this.dialogEl.close()}>Закрити</button>
        </div>
      </div>
    `;
  }

  private submit = async (event: Event) => {
    event.preventDefault();

    // Єдина перевірка, яку має сенс робити тут: сервер другого поля не бачить.
    // Довжину й правильність поточного пароля перевіряє він.
    if (this.next !== this.repeat) {
      this.error = "Новий пароль і його повтор не збігаються";
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
