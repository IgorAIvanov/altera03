import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { bus } from "../bus/bus.ts";
import { t } from "../locale.ts";
import type { PickerOpenMessage } from "../bus/bus.types.ts";
import { apiFetch, readEnvelope } from "../data/api.ts";

interface ActivePicker {
  callbackId: string;
  element: HTMLElement;
  width?: string;
  height?: string;
}

async function resolveChunk(route: string): Promise<string | null> {
  try {
    const [module, model, view] = route.split("/");
    const res = await apiFetch(`/api/view/${module}/${model}/${view}`);
    const envelope = await readEnvelope<{ chunkUrl: string }>(res);
    return envelope.ok ? envelope.data?.item?.chunkUrl ?? null : null;
  } catch {
    return null;
  }
}

/**
 * Модальні вікна підбору — СТЕКОМ, а не одним місцем.
 *
 * Діалог відкриває діалог частіше, ніж здається: пікер із власним відбором
 * («редакція форми» звужена видом звіту) ставить у свій тулбар звичайний
 * `<ui-picker>`, і його лупа — це другий `bus.pick`. Доки хост тримав один
 * активний пікер, другий ЗАТИРАВ перший: Lit викидав його елемент із DOM,
 * а закриття другого гасило обидва. Наслідків було три, і жоден не схожий на
 * причину — перший діалог зникав з екрана, його `callbackId` лишався в
 * `bus.pending` назавжди (тобто `bus.modalOpen` вічно true, і Esc в оболонці
 * переставав закривати вкладку), а вибір у другому діалозі йшов у відбір
 * діалогу, якого вже немає.
 */
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
    /* Вкладений діалог затемнює слабше: два шари по 0.4 дають майже чорний
       екран, на якому діалогу-батька вже не видно — а він і є контекст,
       заради якого вкладений відкривали. */
    .overlay.nested { background: rgba(0,0,0,0.2); }
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
      background: var(--color-primary, #2f5f8f);
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

  /** Відкриті діалоги знизу вгору; останній — той, з яким працює людина. */
  @state() private _stack: ActivePicker[] = [];

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
      // Раніше тут був лише `console.error`, і натиснута кнопка вибору просто
      // нічого не робила — збій, невідрізнимий від зависання.
      console.error(`[picker-host] view не знайдено: ${msg.route}`);
      bus.emit({ type: "notice", text: `Діалог вибору «${msg.route}» не зареєстровано на сервері.` });
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
        multiple?: boolean;
        dialogWidth?: string;
        dialogHeight?: string;
      };
      el.callbackId = msg.callbackId;
      if (msg.params) el.params = msg.params;
      // Множинність приходить від того, хто відкривав (`bus.pickMany`), і лише
      // передається далі: сам пікер про свій режим не вирішує.
      if (msg.multiple) el.multiple = true;

      this._stack = [...this._stack, {
        callbackId: msg.callbackId,
        element: el,
        width: el.dialogWidth,
        height: el.dialogHeight,
      }];

      // закриваємо після resolve/reject (select або cancel)
      const unsub1 = bus.on("picker.select", (e) => {
        if (e.callbackId === msg.callbackId) { this._close(msg.callbackId); unsub1(); unsub2(); }
      });
      const unsub2 = bus.on("picker.cancel", (e) => {
        if (e.callbackId === msg.callbackId) { this._close(msg.callbackId); unsub1(); unsub2(); }
      });
    } catch (e) {
      console.error("[picker-host] помилка завантаження:", e);
      bus.emit({ type: "notice", text: "Не вдалося завантажити діалог вибору." });
      bus.emit({ type: "picker.cancel", callbackId: msg.callbackId });
    }
  }

  /**
   * Прибрати ЗА КЛЮЧЕМ, а не верхній: діалог може закритися й не останнім —
   * наприклад, коли той, хто його відкривав, скасував підбір програмно.
   */
  private _close(callbackId: string) {
    this._stack = this._stack.filter((p) => p.callbackId !== callbackId);
  }

  private _onOverlayClick(e: MouseEvent, picker: ActivePicker) {
    if (e.target === e.currentTarget) {
      bus.emit({ type: "picker.cancel", callbackId: picker.callbackId });
    }
  }

  override render() {
    if (this._stack.length === 0) return html``;
    return html`
      <!-- repeat з ключем, а не .map(): у частині стека лежить ЖИВИЙ елемент
           діалогу зі своїм станом і завантаженими рядками. У неключевому списку
           закриття не-верхнього вікна зсунуло б елементи між частинами, і
           сусідній діалог дістав би disconnected+connected — тобто перечитав би
           дані й забув, що в ньому вибрано. -->
      ${repeat(this._stack, (picker) => picker.callbackId, (picker, index) => html`
        <div class="overlay ${index > 0 ? "nested" : ""}" style=${`z-index:${1000 + index};`}
          @click=${(e: MouseEvent) => this._onOverlayClick(e, picker)}>
          <div class="dialog" style=${`${picker.width ? `width:${picker.width};` : ""}${picker.height ? `height:${picker.height};` : ""}`}>
            <div class="dialog-header">
              <span>${t("common.pick")}</span>
              <span class="close-btn"
                @click=${() => bus.emit({ type: "picker.cancel", callbackId: picker.callbackId })}>×</span>
            </div>
            <div class="dialog-body">
              ${picker.element}
            </div>
          </div>
        </div>
      `)}
    `;
  }
}
