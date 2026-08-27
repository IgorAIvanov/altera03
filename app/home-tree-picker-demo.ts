import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelTreePickerBase } from "@client/ui-kit/base/model-tree-picker-base.ts";
import type { ListColumn, ListRoot } from "@client/ui-kit/base/model-list-base.ts";
import type { Envelope } from "@client/ui-kit/base/base-ui.ts";
import { serveDemoRows, type DemoRow } from "./home-tree-data.ts";

/**
 * Демонстрація `ModelTreePickerBase` на домашній вкладці — той самий діалог
 * підбору, але вставлений У КАРТКУ, без модалки: справжній пікер відкривається
 * через `bus.pick(route)` і потребує моделі з манифестом, якої в демо немає.
 * Кнопки «Вибрати»/«Скасувати» шлють ті самі события `picker.select` /
 * `picker.cancel`, що й у модалці, — картка домашньої вкладки їх слухає й
 * показує відповідь.
 *
 * Живе без сервера тим самим прийомом, що демо списку: `run()` обслуговує
 * команду `lookup` локально. Файл тимчасовий — приклад для розглядання.
 */
@customElement("home-tree-picker-demo")
export class HomeTreePickerDemo extends ModelTreePickerBase<DemoRow> {
  protected model = "home_tree_demo";

  protected columns: ListColumn<DemoRow>[] = [
    { key: "name", title: "common.name", sortable: true },
    { key: "code", title: "common.code", width: "6rem", muted: true, sortable: true },
  ];

  /**
   * Без фокуса при появі: справжній пікер відкривається діалогом і забирає
   * фокус у пошук слушно, а інлайн-демо крало б його в усієї домашньої
   * вкладки при кожному вході.
   */
  override firstUpdated() {}

  /** «Показати поточне значення поля» — головний сценарій revealNode у пікері. */
  protected override renderToolbarExtra(): TemplateResult {
    return html`
      <button class="btn btn-sm" @click=${() => this.revealNode("31")}>
        До поточного
      </button>
    `;
  }

  protected override run<D = Record<string, unknown>>(
    command: string,
    payload: unknown,
  ): Promise<Envelope<D>> {
    return Promise.resolve(this.#serve(command, payload) as Envelope<D>);
  }

  #serve(command: string, payload: unknown): Envelope<Partial<ListRoot<DemoRow>>> {
    if (command !== "lookup") {
      return { ok: false, messages: [{ type: "error", text: `демо вміє лише lookup, не ${command}` }] };
    }
    return { ok: true, data: serveDemoRows(payload) };
  }
}
