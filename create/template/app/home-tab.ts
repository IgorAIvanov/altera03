import { html, type TemplateResult } from "lit";
import { customElement, query } from "lit/decorators.js";
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";

export const tagName = "home-tab";

/** Стартова вкладка. Заміни вміст на щось корисне для свого застосунку. */
@customElement(tagName)
export class HomeTab extends GlobalStyledLitElement {
  @query("dialog") private dialogEl!: HTMLDialogElement;

  override render(): TemplateResult {
    return html`
      <div class="p-6 flex flex-col gap-4 items-start">
        <div>
          <h1 class="text-xl font-medium mb-2">{{name}}</h1>
          <p class="opacity-70">
            Пункти меню редагуються в адмініструванні; моделі створюються в
            <code>app/&lt;family&gt;/&lt;model&gt;/</code>.
          </p>
        </div>

        <!-- Заглушка під майбутню установку готового прикладного рішення —
             моделі, SQL і зібрані чанки в'ю одним пакетом. Поки кнопка лише
             показує, що така дія передбачена. -->
        <button class="btn btn-primary" @click=${() => this.dialogEl.showModal()}>
          Завантажити прикладне рішення
        </button>

        <!-- m-auto тут не косметика: preflight Tailwind обнуляє margin усім
             елементам, а нативне центрування модального dialog тримається саме
             на margin: auto з UA-стилів. Без цього вікно прилипає до лівого
             верхнього кута. (Зворотних лапок у коментарі всередині html-шаблона
             бути не може — вони обривають сам шаблонний рядок.) -->
        <dialog class="m-auto p-6 rounded border max-w-sm">
          <h2 class="text-lg font-medium mb-2">Завантаження прикладного рішення</h2>
          <p class="opacity-80 mb-4">
            Функція в стадії реалізації. Тут відкриється вибір пакета рішення —
            моделі, SQL і форми одним архівом.
          </p>
          <form method="dialog" class="flex justify-end">
            <button class="btn">Зрозуміло</button>
          </form>
        </dialog>
      </div>
    `;
  }
}
