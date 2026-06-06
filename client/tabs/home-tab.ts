import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { bus } from "../bus/bus.ts";

@customElement("home-tab")
export class HomeTab extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 1rem;
    }
    h3 {
      margin: 0;
      color: #374151;
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      justify-content: center;
    }
    button {
      padding: 0.5rem 1.25rem;
      border-radius: 8px;
      border: 1px solid #d1d5db;
      background: white;
      font-size: 0.875rem;
      cursor: pointer;
    }
    button:hover {
      background: #f3f4f6;
    }
  `;

  private open(route: string, id?: string) {
    bus.emit({ type: "tab.open", route, id: id ?? null });
  }

  render() {
    return html`
      <h3>Тестові форми</h3>
      <div class="buttons">
        <button @click=${() => this.open("catalog/bank/list")}>Банки (список)</button>
        <button @click=${() => this.open("catalog/bank/edit")}>Банк (новий)</button>
        <button @click=${() => this.open("catalog/bank/edit", "1")}>Банк edit id=1</button>
      </div>
    `;
  }
}
