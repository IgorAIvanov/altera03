import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";

export const tagName = "home-tab";

/** Стартова вкладка. Заміни вміст на щось корисне для свого застосунку. */
@customElement(tagName)
export class HomeTab extends GlobalStyledLitElement {
  override render(): TemplateResult {
    return html`
      <div class="p-6">
        <h1 class="text-xl font-medium mb-2">{{name}}</h1>
        <p class="opacity-70">
          Пункти меню редагуються в адмініструванні; моделі створюються в
          <code>app/&lt;family&gt;/&lt;model&gt;/</code>.
        </p>
      </div>
    `;
  }
}
