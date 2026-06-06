import { LitElement, html, css, svg } from "lit";
import { customElement, state } from "lit/decorators.js";
import { bus } from "@client/bus/bus.ts";
import { menuMock } from "./menu-mock.ts";
import type { MenuItem } from "./menu.types.ts";

interface Flyout {
  item: MenuItem;
  y: number;
}

@customElement("app-menu")
export class AppMenu extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: #2a3a54;
      color: #c8d6e8;
      font-family: "Roboto", sans-serif;
      font-size: 12px;
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
      border-bottom: 1px solid #3d5070;
      flex-shrink: 0;
    }
    :host([collapsed]) .toggle { justify-content: center; }

    .toggle-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 2px;
      cursor: pointer;
      color: #8aabcc;
    }
    .toggle-btn:hover { background: #3d5070; color: #fff; }

    /* Список пунктов */
    .menu { flex: 1; overflow-y: auto; overflow-x: hidden; }
    .menu::-webkit-scrollbar { width: 4px; }
    .menu::-webkit-scrollbar-thumb { background: #3d5070; }

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
    .item:hover { background: #3d5070; color: #fff; }
    .item.active { background: #1a5fa8; color: #fff; border-left-color: #5ba3f5; }

    /* Иконка */
    .icon {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      opacity: 0.85;
    }
    .item:hover .icon, .item.active .icon { opacity: 1; }

    /* Текст */
    .label { flex: 1; overflow: hidden; text-overflow: ellipsis; }

    /* Стрелка группы */
    .arrow {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      opacity: 0.5;
      transition: transform 0.15s;
    }
    .arrow.open { transform: rotate(90deg); }

    /* Дочерние пункты */
    .children { overflow: hidden; }
    .children .item {
      padding-left: 30px;
      font-size: 11.5px;
      color: #a8c0d8;
    }
    .children .item:hover { color: #fff; }

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
      font-size: 12px;
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
      background: #2a3a54;
      border: 1px solid #3d5070;
      border-radius: 0 2px 2px 0;
      box-shadow: 4px 4px 12px rgba(0,0,0,0.3);
      z-index: 1002;
      min-width: 180px;
      overflow: hidden;
    }

    .flyout-title {
      padding: 5px 12px;
      font-size: 11px;
      font-weight: 500;
      color: #8aabcc;
      border-bottom: 1px solid #3d5070;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .flyout-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px;
      font-size: 12px;
      color: #c8d6e8;
      cursor: pointer;
      white-space: nowrap;
    }
    .flyout-item:hover { background: #3d5070; color: #fff; }
    .flyout-item .icon { width: 16px; height: 16px; opacity: 0.8; }
    .flyout-item:hover .icon { opacity: 1; }
  `;

  @state() private collapsed = false;
  @state() private expanded = new Set<string>();
  @state() private activeId: string | null = null;
  @state() private tooltip: { label: string; y: number } | null = null;
  @state() private flyout: Flyout | null = null;

  private icon(path: string, size = 16) {
    return svg`
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">
        <path d="${path}"/>
      </svg>
    `;
  }

  private iconChevron() {
    return svg`
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
      </svg>
    `;
  }

  private iconCollapse(collapsed: boolean) {
    return collapsed
      ? svg`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>`
      : svg`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>`;
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

  private renderItem(item: MenuItem, level = 0) {
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

  render() {
    return html`
      <div class="toggle">
        <div class="toggle-btn" @click=${this.toggle} title="${this.collapsed ? "Розгорнути" : "Згорнути"}">
          ${this.iconCollapse(this.collapsed)}
        </div>
      </div>

      <div class="menu">
        ${menuMock.map(item => this.renderItem(item))}
      </div>

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
