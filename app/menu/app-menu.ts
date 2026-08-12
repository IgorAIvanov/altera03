import { LitElement, html, css, svg, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { bus } from "@client/bus/bus.ts";
import { resolveText, t } from "@client/locale.ts";
import { menuIcon } from "./icons.ts";
import type { MenuItem, MenuRow } from "./menu.types.ts";

interface Flyout {
  item: MenuItem;
  y: number;
}

/**
 * Код кореневої теки, вміст якої меню малює ЗАКРІПЛЕНИМ УНИЗУ — під списком, що
 * прокручується. Сама тека на екран не йде: вона тут не розділ, а спосіб
 * сказати «ці пункти внизу».
 *
 * Домовленість за кодом, а не колонка в `app.menu_item`: склад меню — справа
 * застосунку, і закріплення внизу теж. Колонка означала б міграцію ядра й нове
 * поле в редакторі меню заради того, що адміністратор і так може виразити
 * структурою, яку він вже редагує.
 *
 * Зворотний бік — домовленість тримається на коді теки, і в редакторі меню її
 * нічим не видно. Тому тека є в сіді (`app/admin/menu/db/data.sql`): порожня
 * вона нічого не малює, але видна тому, хто складає меню.
 *
 * `id` кореня дорівнює його `code` — `menu_current` віддає шлях від кореня.
 */
const BOTTOM_CODE = "bottom";

@customElement("app-menu")
export class AppMenu extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: linear-gradient(180deg, #eaf0f4 0%, #d5dee6 100%);
      color: var(--color-base-content, #243746);
      font-family: "Roboto", sans-serif;
      flex-shrink: 0;
      transition: width 0.2s ease;
      overflow: hidden;
      user-select: none;
    }

    :host([collapsed]) { width: 36px; }
    :host(:not([collapsed])) { width: 220px; }

    /* Кнопка сворачивания */
    .toggle {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 4px 6px;
      border-bottom: 1px solid #adb9c3;
      flex-shrink: 0;
    }
    :host([collapsed]) .toggle { justify-content: center; }

    .toggle-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 2px;
      cursor: pointer;
      color: #617482;
    }
    .toggle-btn:hover { background: rgba(47,95,143,0.10); color: #1c3345; }

    /* Список пунктов.

       min-height: 0 — не косметика, а условие прокрутки: flex-элемент по
       умолчанию не бывает ниже своего содержимого (min-height: auto), поэтому
       список рос за пределы меню, overflow-y не срабатывал вовсе, а хвост
       пунктов молча срезал overflow: hidden на самом :host. */
    .menu { flex: 1; min-height: 0; }

    /* Нижняя часть — содержимое теки BOTTOM_CODE. Не прокручивается вместе со
       списком: она и нужна затем, чтобы эти пункты были на виду при любой
       длине меню. Своя прокрутка и потолок высоты — на случай, когда внизу
       раскрыли группу: иначе нижний блок выдавил бы верхний список. */
    .menu-bottom {
      flex-shrink: 0;
      max-height: 50%;
      border-top: 1px solid #adb9c3;
    }

    .menu, .menu-bottom {
      overflow-y: auto;
      overflow-x: hidden;
      /* Тонкая полоса: webkit-правилами ниже и стандартным свойством — иначе
         в Firefox полоса штатной ширины отъедает место у названий пунктов. */
      scrollbar-width: thin;
      scrollbar-color: #b8c3cc transparent;
    }
    .menu::-webkit-scrollbar,
    .menu-bottom::-webkit-scrollbar { width: 4px; }
    .menu::-webkit-scrollbar-thumb,
    .menu-bottom::-webkit-scrollbar-thumb { background: #b8c3cc; }

    .menu-message {
      padding: 8px;
      opacity: 0.7;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    :host([collapsed]) .menu-message { display: none; }

    /* Пункт меню */
    .item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 8px;
      cursor: pointer;
      white-space: nowrap;
      border-left: 2px solid transparent;
      position: relative;
    }
    .item:hover { background: rgba(47,95,143,0.10); color: #1c3345; }
    .item.active { background: #d4e2f0; color: #1c3345; border-left-color: var(--color-primary, #2f5f8f); }

    /* Иконка */
    .icon {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      opacity: 0.85;
    }
    .item:hover .icon, .item.active .icon { opacity: 1; }

    /* Текст */
    .label { flex: 1; overflow: hidden; text-overflow: ellipsis; }

    /* Стрелка группы */
    .arrow {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      opacity: 0.5;
      transition: transform 0.15s;
    }
    .arrow.open { transform: rotate(90deg); }

    /* Дочерние пункты */
    .children { overflow: hidden; }
    .children .item {
      padding-left: 30px;
      font-size: inherit;
      color: var(--color-base-content, #243746);
    }
    .children .item:hover { color: #1c3345; }

    /* Свёрнутый режим */
    :host([collapsed]) .label,
    :host([collapsed]) .arrow { display: none; }

    :host([collapsed]) .item { padding: 6px; justify-content: center; }
    :host([collapsed]) .children { display: none; }

    /* Tooltip (только для листьев в свёрнутом режиме) */
    .tooltip {
      position: fixed;
      left: 40px;
      background: #1f2937;
      color: #f9fafb;
      padding: 3px 8px;
      border-radius: 2px;
      font-size: inherit;
      white-space: nowrap;
      pointer-events: none;
      z-index: 1001;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }

    /* Оверлей для закрытия flyout */
    .flyout-overlay {
      position: fixed;
      inset: 0;
      z-index: 1001;
    }

    /* Flyout подменю */
    .flyout {
      position: fixed;
      left: 36px;
      background: #f2f6f9;
      border: 1px solid #b8c3cc;
      border-radius: 0 2px 2px 0;
      box-shadow: 4px 4px 12px rgba(47,66,88,0.18);
      z-index: 1002;
      min-width: 180px;
      overflow: hidden;
    }

    .flyout-title {
      padding: 5px 12px;
      font-size: inherit;
      font-weight: 500;
      color: #617482;
      border-bottom: 1px solid #cfd7de;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .flyout-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px;
      font-size: inherit;
      color: var(--color-base-content, #243746);
      cursor: pointer;
      white-space: nowrap;
    }
    .flyout-item:hover { background: rgba(47,95,143,0.10); color: #1c3345; }
    .flyout-item .icon { width: 20px; height: 20px; opacity: 0.8; }
    .flyout-item:hover .icon { opacity: 1; }
  `;

  @state() private items: MenuItem[] = [];
  @state() private error = "";
  @state() private collapsed = false;
  @state() private expanded = new Set<string>();
  @state() private activeId: string | null = null;
  @state() private tooltip: { label: string; y: number } | null = null;
  @state() private flyout: Flyout | null = null;

  override connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  /**
   * Меню приходить із БД уже відфільтрованим правами (`app.menu_current`):
   * склад задає адміністратор, а що з нього видно — user_group_permission.
   */
  private async load() {
    this.error = "";
    try {
      const envelope = await bus.request("data.load", {
        model: "menu",
        command: "current",
        payload: {},
      }) as { data?: { rows?: unknown[] } } | undefined;

      this.items = this.buildTree((envelope?.data?.rows ?? []) as MenuRow[]);
    } catch (e) {
      // Порожнє меню без пояснення виглядає як поломка застосунку, а не як
      // збій запиту, — тому відмова показується, а не ковтається.
      console.error("[app-menu] не вдалося завантажити меню:", e);
      this.items = [];
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  /**
   * Плоский список → дерево. Порядок рядків уже правильний (його задає SQL),
   * тож достатньо зберегти порядок вставки.
   */
  private buildTree(rows: MenuRow[]): MenuItem[] {
    const byId = new Map<string, MenuItem>();
    const roots: MenuItem[] = [];

    for (const row of rows) {
      byId.set(row.id, {
        id: row.id,
        // У базі лежить МАРКЕР перекладу — `@[bank.titleMany]`, а не готовий
        // текст: інакше меню лишалося б мовою сіду, хоч би скільки мов
        // застосунок знав. Те саме домовлення, що для повідомлень сервера:
        // сервер тексту не перекладає (мови користувача він не знає), він його
        // називає. Назва без маркера — те, що вписав адміністратор руками, — іде
        // на екран недоторканою.
        label: resolveText(row.name),
        icon: menuIcon(row.icon),
        route: row.route ?? undefined,
      });
    }

    for (const row of rows) {
      const node = byId.get(row.id)!;
      // Батько має бути в тому ж наборі — його зберігає menu_current. Якщо все
      // ж немає, пункт піднімається в корінь, а не зникає без сліду.
      const parent = row.parentId ? byId.get(row.parentId) : undefined;
      if (parent) (parent.children ??= []).push(node);
      else roots.push(node);
    }

    return roots;
  }

  private icon(path: string, size = 18) {
    return svg`
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">
        <path d="${path}"/>
      </svg>
    `;
  }

  private iconChevron() {
    return svg`
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
      </svg>
    `;
  }

  private iconCollapse(collapsed: boolean) {
    return collapsed
      ? svg`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>`
      : svg`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>`;
  }

  private toggle() {
    this.collapsed = !this.collapsed;
    if (this.collapsed) {
      this.reflectCollapsed();
    } else {
      this.removeAttribute("collapsed");
    }
  }

  private reflectCollapsed() {
    if (this.collapsed) this.setAttribute("collapsed", "");
    else this.removeAttribute("collapsed");
  }

  private toggleGroup(id: string) {
    if (this.expanded.has(id)) {
      this.expanded.delete(id);
    } else {
      this.expanded.add(id);
    }
    this.expanded = new Set(this.expanded);
  }

  private openRoute(item: MenuItem) {
    if (!item.route) return;
    this.activeId = item.id;
    bus.emit({ type: "tab.open", route: item.route, id: null });
  }

  private showTooltip(e: MouseEvent, label: string) {
    if (!this.collapsed) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.tooltip = { label, y: rect.top + rect.height / 2 - 10 };
  }

  private hideTooltip() {
    this.tooltip = null;
  }

  private closePopups = () => {
    this.tooltip = null;
    this.flyout = null;
  };

  private handleItemClick(e: MouseEvent, item: MenuItem) {
    const hasChildren = item.children && item.children.length > 0;

    if (this.collapsed) {
      if (hasChildren) {
        // в свёрнутом режиме — открыть flyout
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        this.flyout = this.flyout?.item.id === item.id
          ? null
          : { item, y: rect.top };
        this.tooltip = null;
      } else {
        this.openRoute(item);
      }
    } else {
      hasChildren ? this.toggleGroup(item.id) : this.openRoute(item);
    }
  }

  private openFlyoutRoute(item: MenuItem) {
    this.flyout = null;
    this.openRoute(item);
  }

  private renderItem(item: MenuItem, level = 0): TemplateResult {
    const hasChildren = item.children && item.children.length > 0;
    const isOpen = this.expanded.has(item.id);

    return html`
      <div
        class="item ${this.activeId === item.id ? "active" : ""}"
        style="${level > 0 ? "padding-left: 28px;" : ""}"
        @click=${(e: MouseEvent) => this.handleItemClick(e, item)}
        @mouseenter=${(e: MouseEvent) => !hasChildren ? this.showTooltip(e, item.label) : this.hideTooltip()}
        @mouseleave=${this.hideTooltip}
      >
        <span class="icon">${this.icon(item.icon)}</span>
        <span class="label">${item.label}</span>
        ${hasChildren ? html`<span class="arrow ${isOpen ? "open" : ""}">${this.iconChevron()}</span>` : ""}
      </div>

      ${hasChildren && isOpen ? html`
        <div class="children">
          ${item.children!.map(child => this.renderItem(child, level + 1))}
        </div>
      ` : ""}
    `;
  }

  override render() {
    // Тека нижней части и её содержимое: сама тека на экран не идёт, поэтому
    // из верхнего списка убираем её целиком, а не только её детей.
    //
    // Условие про детей — не перестраховка: пункт с этим кодом может оказаться
    // ЛИСТОМ (у корня проставили маршрут). Без проверки он исчезал бы с экрана
    // совсем — из верхнего списка убран, а показать под чертой нечего.
    const bottom = this.items.find(item => item.id === BOTTOM_CODE && item.children?.length);
    const top = bottom ? this.items.filter(item => item !== bottom) : this.items;
    const bottomItems = bottom?.children ?? [];

    return html`
      <div class="toggle">
        <div class="toggle-btn" @click=${this.toggle} title=${this.collapsed ? t("nav.expand") : t("nav.collapse")}>
          ${this.iconCollapse(this.collapsed)}
        </div>
      </div>

      <!-- Прокрутка закрывает всплывающие: и подсказка, и flyout стоят на
           position: fixed с координатой, снятой в момент наведения, — уехавший
           список оставил бы их указывать в пустоту. -->
      <div class="menu" @scroll=${this.closePopups}>
        ${this.error
          ? html`<div class="menu-message" title="${this.error}">Меню недоступне</div>`
          : top.map(item => this.renderItem(item))}
      </div>

      ${bottomItems.length ? html`
        <div class="menu-bottom" @scroll=${this.closePopups}>
          ${bottomItems.map(item => this.renderItem(item))}
        </div>
      ` : ""}

      ${this.tooltip ? html`
        <div class="tooltip" style="top: ${this.tooltip.y}px">${this.tooltip.label}</div>
      ` : ""}

      ${this.flyout ? html`
        <div class="flyout-overlay" @click=${() => this.flyout = null}></div>
        <div class="flyout" style="top: ${this.flyout.y}px">
          <div class="flyout-title">${this.flyout.item.label}</div>
          ${this.flyout.item.children!.map(child => html`
            <div class="flyout-item" @click=${() => this.openFlyoutRoute(child)}>
              <span class="icon">${this.icon(child.icon)}</span>
              ${child.label}
            </div>
          `)}
        </div>
      ` : ""}
    `;
  }
}
