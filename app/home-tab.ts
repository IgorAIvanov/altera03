import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { bus } from "@client/bus/bus.ts";
import { tw } from "@client/shared/styles.ts";

@customElement("home-tab")
export class HomeTab extends LitElement {
  static styles = [tw];

  private open(route: string, id?: string) {
    bus.emit({ type: "tab.open", route, id: id ?? null });
  }

  render() {
    return html`
      <div class="flex flex-col items-center justify-center h-full gap-4">
        <h3 class="text-lg font-semibold text-base-content">Тестові форми</h3>
        <div class="flex flex-wrap gap-3 justify-center">
          <button class="btn" @click=${() => this.open("catalog/bank/list")}>Банки (список)</button>
          <button class="btn" @click=${() => this.open("catalog/bank/edit")}>Банк (новий)</button>
          <button class="btn" @click=${() => this.open("catalog/bank/edit", "1")}>Банк edit id=1</button>
        </div>
      </div>
    `;
  }
}
