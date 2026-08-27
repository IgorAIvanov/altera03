import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelTreeListBase } from "@client/ui-kit/base/model-tree-list-base.ts";
import type { ListColumn, ListRoot } from "@client/ui-kit/base/model-list-base.ts";
import type { Envelope } from "@client/ui-kit/base/base-ui.ts";
import { serveDemoRows, type DemoRow } from "./home-tree-data.ts";

/**
 * Демонстрація `ModelTreeListBase` на домашній вкладці — дерево елементів
 * (самоссылка parentId) на прикладі структури підприємства: батьком дільниці
 * стоїть цех, такий самий підрозділ, а не папка.
 *
 * Живе БЕЗ сервера: `run()` обслуговує команду `list` локальними даними з тим
 * самим конвертом, що віддала б база. Завдяки цьому весь шлях основи —
 * розгортка, пошук (плоский вигляд із пагінацією), сортування братів і сестер,
 * клавіатура (стрілки, Left/Right), вивантаження в Excel — працює по-справжньому.
 *
 * Файл тимчасовий: приклад для розглядання, не зразок для копіювання. Робочій
 * моделі `run()` перекривати не треба — вона ходить у свій `list` як усі.
 */
@customElement("home-tree-demo")
export class HomeTreeDemo extends ModelTreeListBase<DemoRow> {
  protected model = "home_tree_demo";
  protected editRoute = null;

  protected columns: ListColumn<DemoRow>[] = [
    { key: "name", title: "common.name", sortable: true },
    { key: "code", title: "common.code", width: "6rem", muted: true, sortable: true },
  ];

  /** Кнопки демонструють програмне керування вузлами — у робочому списку їх не буде. */
  protected override renderToolbarExtra(): TemplateResult {
    return html`
      <button class="btn btn-sm" @click=${() => this.collapseAll()}>Згорнути все</button>
      <button class="btn btn-sm" @click=${() => this.expandAll()}>Розгорнути все</button>
      <button class="btn btn-sm" @click=${() => this.revealNode("222")}>До «Бригади №2»</button>
    `;
  }

  protected override run<D = Record<string, unknown>>(
    command: string,
    payload: unknown,
  ): Promise<Envelope<D>> {
    return Promise.resolve(this.#serve(command, payload) as Envelope<D>);
  }

  #serve(command: string, payload: unknown): Envelope<Partial<ListRoot<DemoRow>>> {
    if (command !== "list") {
      return { ok: false, messages: [{ type: "error", text: `демо вміє лише list, не ${command}` }] };
    }
    return { ok: true, data: serveDemoRows(payload) };
  }
}
