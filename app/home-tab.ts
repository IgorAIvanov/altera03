import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { bus } from "@client/bus/bus.ts";
import { tw } from "@client/shared/styles.ts";
import "@client/ui-kit/components/ui-picker.ts";

@customElement("home-tab")
export class HomeTab extends LitElement {
  static styles = [css`:host { display: block; height: 100%; }`, tw];

  @state() private pickerResult = "";

  private open(route: string, id?: string) {
    bus.emit({ type: "tab.open", route, id: id ?? null });
  }

  render() {
    return html`
      <div class="flex flex-col items-center justify-center h-full gap-6">
        <h3 class="text-lg font-semibold text-base-content">Тестові форми</h3>

        <div class="flex flex-wrap gap-3 justify-center">
          <button class="btn" @click=${() => this.open("catalog/bank/list")}>Банки (список)</button>
          <button class="btn" @click=${() => this.open("catalog/bank/edit")}>Банк (новий)</button>
          <button class="btn" @click=${() => this.open("catalog/bank/edit", "1")}>Банк edit id=1</button>
        </div>

        <div class="card bg-base-200 border border-base-300 p-4 w-80">
          <h4 class="text-sm font-semibold mb-3 text-base-content/70">Тест ui-picker (bank)</h4>
          <ui-picker
            url="catalog/bank"
            fetch="lookup"
            label="Банк"
            placeholder="Введіть назву або МФО..."
            ?show-clear=${true}
            label-position="left"
            @item-selected=${(e: CustomEvent) => {
              this.pickerResult = `id=${e.detail.id}, label=${e.detail.label}`;
            }}
            @item-cleared=${() => { this.pickerResult = ""; }}
          ></ui-picker>
          ${this.pickerResult ? html`
            <div class="mt-2 text-xs text-success">${this.pickerResult}</div>
          ` : ""}
        </div>
      </div>
    `;
  }
}
