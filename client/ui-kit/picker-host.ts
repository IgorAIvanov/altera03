import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { bus } from "../bus/bus.ts";
import { t } from "../locale.ts";
import type { PickerOpenMessage } from "../bus/bus.types.ts";

interface ActivePicker {
  callbackId: string;
  element: HTMLElement;
  width?: string;
  height?: string;
}

async function resolveChunk(route: string): Promise<string | null> {
  try {
    const [module, model, view] = route.split("/");
    const res = await fetch(`/api/view/${module}/${model}/${view}`);
    const data = await res.json();
    return data.ok ? data.chunkUrl : null;
  } catch {
    return null;
  }
}

@customElement("picker-host")
export class PickerHost extends LitElement {
  static override styles = css`
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .dialog {
      background: var(--color-base-100, #fff);
      border-radius: 0.5rem;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      width: 560px;
      max-width: 95vw;
      height: 480px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 1rem;
      background: var(--color-primary, #2B5598);
      color: var(--color-primary-content, #fff);
      font-weight: 600;
      font-size: 0.875rem;
    }
    .dialog-body {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .close-btn {
      cursor: pointer;
      opacity: 0.8;
      font-size: 1.2rem;
      line-height: 1;
      padding: 0 4px;
    }
    .close-btn:hover { opacity: 1; }
  `;

  @state() private _picker: ActivePicker | null = null;

  private _unsub?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    this._unsub = bus.on("picker.open", (msg) => this._open(msg));
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
  }

  private async _open(msg: PickerOpenMessage) {
    const chunkUrl = await resolveChunk(msg.route);
    if (!chunkUrl) {
      console.error(`[picker-host] view не знайдено: ${msg.route}`);
      bus.emit({ type: "picker.cancel", callbackId: msg.callbackId });
      return;
    }

    try {
      const mod = await import(/* @vite-ignore */ chunkUrl);
      const tagName: string | undefined = mod.tagName ?? mod.default?.tagName;
      if (!tagName) throw new Error(`модуль ${chunkUrl} не має tagName`);

      const el = document.createElement(tagName) as HTMLElement & {
        callbackId?: string;
        params?: Record<string, unknown>;
        dialogWidth?: string;
        dialogHeight?: string;
      };
      el.callbackId = msg.callbackId;
      if (msg.params) el.params = msg.params;

      this._picker = {
        callbackId: msg.callbackId,
        element: el,
        width: el.dialogWidth,
        height: el.dialogHeight,
      };

      // закриваємо після resolve/reject (select або cancel)
      const unsub1 = bus.on("picker.select", (e) => {
        if (e.callbackId === msg.callbackId) { this._close(); unsub1(); unsub2(); }
      });
      const unsub2 = bus.on("picker.cancel", (e) => {
        if (e.callbackId === msg.callbackId) { this._close(); unsub1(); unsub2(); }
      });
    } catch (e) {
      console.error("[picker-host] помилка завантаження:", e);
      bus.emit({ type: "picker.cancel", callbackId: msg.callbackId });
    }
  }

  private _close() {
    this._picker = null;
  }

  private _onOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget && this._picker) {
      bus.emit({ type: "picker.cancel", callbackId: this._picker.callbackId });
    }
  }

  override render() {
    if (!this._picker) return html``;
    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="dialog" style=${`${this._picker.width ? `width:${this._picker.width};` : ""}${this._picker.height ? `height:${this._picker.height};` : ""}`}>
          <div class="dialog-header">
            <span>${t("common.pick")}</span>
            <span class="close-btn" @click=${() => this._picker && bus.emit({ type: "picker.cancel", callbackId: this._picker.callbackId })}>×</span>
          </div>
          <div class="dialog-body">
            ${this._picker.element}
          </div>
        </div>
      </div>
    `;
  }
}
