import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";

export const tagName = "bank-edit";

interface BankItem {
  id?: string;
  code: string;
  name: string;
  mfo: string;
}

@customElement(tagName)
export class BankEdit extends SignalWatcher(LitElement) {
  static styles = css`
    :host { display: block; padding: 1rem; max-width: 480px; }
    .field { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 1rem; }
    label { font-size: 0.875rem; color: #6b7280; }
    input { padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 1rem; }
    input:focus { outline: none; border-color: #6366f1; }
    .toolbar { display: flex; gap: 0.5rem; margin-top: 1.5rem; }
    button { padding: 0.4rem 1rem; border-radius: 6px; border: 1px solid #d1d5db; background: white; cursor: pointer; }
    button.primary { background: #6366f1; color: white; border-color: #6366f1; }
    button.primary:hover { background: #4f46e5; }
    button:not(.primary):hover { background: #f3f4f6; }
  `;

  @property({ type: String }) modelId: string | null = null;

  @state() private item: BankItem = { code: "", name: "", mfo: "" };
  @state() private loading = false;
  @state() private saving = false;

  connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  async load() {
    this.loading = true;
    try {
      const data = await bus.request("data.load", {
        model: "bank",
        command: "load",
        payload: { id: this.modelId },
      }) as { item?: BankItem };
      this.item = data?.item ?? { code: "", name: "", mfo: "" };
    } finally {
      this.loading = false;
    }
  }

  async save() {
    this.saving = true;
    try {
      await bus.request("data.save", {
        model: "bank",
        command: "update",
        payload: { item: this.item },
      });
    } finally {
      this.saving = false;
    }
  }

  private setField(field: keyof BankItem, value: string) {
    this.item = { ...this.item, [field]: value };
  }

  render() {
    if (this.loading) return html`<div>${t("common.loading")}</div>`;

    return html`
      <div class="field">
        <label>${t("common.code")}</label>
        <input .value=${this.item.code}
          @input=${(e: Event) => this.setField("code", (e.target as HTMLInputElement).value)} />
      </div>

      <div class="field">
        <label>${t("common.name")}</label>
        <input .value=${this.item.name}
          @input=${(e: Event) => this.setField("name", (e.target as HTMLInputElement).value)} />
      </div>

      <div class="field">
        <label>${t("bank.mfo")}</label>
        <input .value=${this.item.mfo}
          @input=${(e: Event) => this.setField("mfo", (e.target as HTMLInputElement).value)} />
      </div>

      <div class="toolbar">
        <button class="primary" ?disabled=${this.saving} @click=${this.save}>
          ${t("common.save")}
        </button>
      </div>
    `;
  }
}
