import { html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";
import { bus } from "@client/bus/bus.ts";

export const tagName = "app-menu";

interface MenuItem {
  code: string;
  name: string;
  routePath: string | null;
  children?: MenuItem[];
}

/**
 * Меню користувача. Склад приходить з БД командою `menu/current` — вона зливає
 * меню всіх груп користувача й лишає тільки пункти, на модель яких є право
 * `view`. Тому фільтрувати тут нічого не треба.
 */
@customElement(tagName)
export class AppMenu extends GlobalStyledLitElement {
  @state() private items: MenuItem[] = [];

  override async connectedCallback() {
    super.connectedCallback();
    const envelope = await bus.request("data.load", { model: "menu", command: "current", payload: {} });
    this.items = (envelope?.data?.rows ?? []) as MenuItem[];
  }

  override render(): TemplateResult {
    return html`<nav class="p-2 w-56 overflow-auto">${this.items.map((item) => this.#renderItem(item))}</nav>`;
  }

  #renderItem(item: MenuItem): TemplateResult {
    if (!item.routePath) {
      return html`
        <div class="mt-3 mb-1 text-xs uppercase opacity-60">${item.name}</div>
        ${(item.children ?? []).map((child) => this.#renderItem(child))}
      `;
    }

    return html`
      <a class="block px-2 py-1 rounded cursor-pointer hover:bg-base-200"
         @click=${() => bus.emit({ type: "tab.open", route: item.routePath! })}>
        ${item.name}
      </a>
      ${item.children?.length ? item.children.map((child) => this.#renderItem(child)) : nothing}
    `;
  }
}
