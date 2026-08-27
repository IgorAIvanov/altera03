import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelTreeListBase } from "@client/ui-kit/base/model-tree-list-base.ts";
import type { ListColumn, ListRoot } from "@client/ui-kit/base/model-list-base.ts";
import type { Envelope } from "@client/ui-kit/base/base-ui.ts";

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

interface DemoRow {
  id: string;
  parentId: string | null;
  name: string;
  code: string;
}

const DEMO_ROWS: DemoRow[] = [
  { id: "1", parentId: null, name: "Адміністрація", code: "001" },
  { id: "2", parentId: null, name: "Цех №1 (механічний)", code: "010" },
  { id: "21", parentId: "2", name: "Дільниця токарна", code: "011" },
  { id: "22", parentId: "2", name: "Дільниця фрезерна", code: "012" },
  { id: "221", parentId: "22", name: "Бригада №1", code: "012.1" },
  { id: "222", parentId: "22", name: "Бригада №2", code: "012.2" },
  { id: "3", parentId: null, name: "Цех №2 (складальний)", code: "020" },
  { id: "31", parentId: "3", name: "Дільниця складання", code: "021" },
  { id: "32", parentId: "3", name: "Дільниця фарбування", code: "022" },
  { id: "4", parentId: null, name: "Склад готової продукції", code: "030" },
];

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
    const p = payload as {
      search?: string;
      page?: number;
      pageSize?: number;
      sortBy?: string;
      sortDir?: string;
    };

    const q = (p.search ?? "").trim().toLowerCase();
    const rows = DEMO_ROWS.filter(
      (row) => !q || row.name.toLowerCase().includes(q) || row.code.includes(q),
    );

    const sortBy = p.sortBy === "code" ? "code" : "name";
    const dir = p.sortDir === "desc" ? -1 : 1;
    rows.sort((a, b) => a[sortBy].localeCompare(b[sortBy], "uk") * dir);

    const page = Math.max(p.page ?? 1, 1);
    const pageSize = Math.max(p.pageSize ?? 20, 1);
    return {
      ok: true,
      data: {
        rows: rows.slice((page - 1) * pageSize, page * pageSize),
        totals: { count: rows.length, page, pageSize },
      },
    };
  }
}
