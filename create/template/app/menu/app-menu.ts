import { html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";
import { bus } from "@client/bus/bus.ts";
import { resolveText } from "@client/locale.ts";

export const tagName = "app-menu";

/**
 * Рядок відповіді `menu/current`. Список ПЛОСКИЙ: ієрархію задають `id` і
 * `parentId` (це шляхи-ланцюжки кодів, а не числа), дерево будує клієнт.
 * `route` — маршрут в'ю (`family/model/view`); null означає теку.
 */
interface MenuRow {
  id: string;
  parentId: string | null;
  name: string;
  icon: string | null;
  route: string | null;
}

interface MenuNode extends MenuRow {
  children: MenuNode[];
}

/**
 * Меню користувача. Склад приходить з БД командою `menu/current` — вона зливає
 * меню всіх груп користувача й лишає тільки пункти, на модель яких є право
 * `view`. Тому фільтрувати тут нічого не треба.
 */
@customElement(tagName)
export class AppMenu extends GlobalStyledLitElement {
  @state() private nodes: MenuNode[] = [];

  override async connectedCallback() {
    super.connectedCallback();
    // Конверт звужуємо явно: bus.request типізований узагальнено, а форму
    // відповіді знає тільки той, хто кличе конкретну команду.
    const envelope = await bus.request("data.load", {
      model: "menu",
      command: "current",
      payload: {},
    }) as { data?: { rows?: MenuRow[] } } | undefined;

    this.nodes = buildTree(envelope?.data?.rows ?? []);
  }

  override render(): TemplateResult {
    return html`<nav class="p-2 w-56 overflow-auto">${this.nodes.map((node) => this.#renderNode(node))}</nav>`;
  }

  // У `node.name` лежить МАРКЕР перекладу — `@[counterparty.titleMany]`, а не
  // готовий текст: так меню перекладається разом з усім іншим. Те саме
  // домовлення, що для повідомлень сервера: сервер тексту не перекладає (мови
  // користувача він не знає), він його називає. Назва без маркера — та, що
  // вписав адміністратор руками, — показується як є.
  #renderNode(node: MenuNode): TemplateResult {
    // Тека — заголовок розділу, а не посилання.
    if (!node.route) {
      return html`
        <div class="mt-3 mb-1 text-xs uppercase opacity-60">${resolveText(node.name)}</div>
        ${node.children.map((child) => this.#renderNode(child))}
      `;
    }

    return html`
      <a class="block px-2 py-1 rounded cursor-pointer hover:bg-base-200"
         @click=${() => bus.emit({ type: "tab.open", route: node.route!, id: null })}>
        ${resolveText(node.name)}
      </a>
      ${node.children.length ? node.children.map((child) => this.#renderNode(child)) : nothing}
    `;
  }
}

/** Плоскі рядки → дерево. Порядок рядків зберігається: сервер уже відсортував. */
function buildTree(rows: MenuRow[]): MenuNode[] {
  const byId = new Map<string, MenuNode>();
  for (const row of rows) byId.set(row.id, { ...row, children: [] });

  const roots: MenuNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    // Пункт, чийого батька не видно (немає права на його модель), піднімається
    // вгору, а не зникає разом із текою: інакше користувач втратив би доступну
    // йому дію.
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}
