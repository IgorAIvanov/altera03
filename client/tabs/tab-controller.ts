import { LitElement, html, css, svg } from "lit";
import { customElement, state } from "lit/decorators.js";
import { bus } from "../bus/bus.ts";
import { t } from "../locale.ts";
import "@app/home-tab.ts";
import "@app/menu/app-menu.ts";
import "@app/header/app-header.ts";
import "@client/ui-kit/picker-host.ts";

const MAX_TABS = 10;
const HOME_TAB_ID = "home";

const iconHome = svg`
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
  </svg>
`;

interface Tab {
  id: string;
  route: string;
  modelId: string | null;
  titleKey?: string;
  element: HTMLElement;
  lastUsedAt: number;
  permanent?: boolean;
}

async function resolveChunk(route: string): Promise<{ chunkUrl: string; titleKey?: string } | null> {
  const [module, model, view] = route.split("/");
  try {
    const res = await fetch(`/api/view/${module}/${model}/${view}`);
    const data = await res.json();
    if (!data.ok) {
      console.error(`[tabs] сервер відповів ok:false для ${route}:`, data);
      return null;
    }
    return { chunkUrl: data.chunkUrl, titleKey: data.titleKey };
  } catch (e) {
    console.error(`[tabs] помилка fetch для ${route}:`, e);
    return null;
  }
}

async function createTabElement(chunkUrl: string, modelId: string | null): Promise<HTMLElement | null> {
  try {
    const mod = await import(/* @vite-ignore */ chunkUrl);
    const tagName: string | undefined = mod.tagName ?? mod.default?.tagName;
    if (!tagName) {
      console.error(`[tabs] модуль ${chunkUrl} не експортує tagName`);
      return null;
    }
    const el = document.createElement(tagName);
    if (modelId) (el as any).modelId = modelId;
    return el;
  } catch (e) {
    console.error(`[tabs] помилка завантаження чанку ${chunkUrl}`, e);
    return null;
  }
}

@customElement("tab-controller")
export class TabController extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: "Roboto", sans-serif;
      font-size: 12px;
    }
    .tab-bar {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      padding: 4px 4px 0;
      background: #2B5598;
      overflow-x: auto;
      flex-shrink: 0;
    }
    .tab {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      border-radius: 2px 2px 0 0;
      background: #3a6ea8;
      color: #d0e0f5;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
      user-select: none;
      border: 1px solid #1e3f7a;
      border-bottom: none;
    }
    .tab.active {
      background: #ECF0F5;
      color: #1f2937;
      font-weight: 500;
    }
    .tab.home { padding: 3px 8px; }
    .tab-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      border-radius: 2px;
      font-size: 11px;
      opacity: 0.6;
      margin-left: 2px;
    }
    .tab-close:hover { background: #b0bec5; opacity: 1; color: #111; }
    .workspace { display: flex; flex: 1; overflow: hidden; }
    .panels { flex: 1; position: relative; overflow: hidden; background: #ECF0F5; }
    .panel {
      position: absolute;
      inset: 0;
      overflow: auto;
      display: none;
    }
    .panel.active { display: block; }
    .loading-bar {
      height: 3px;
      background: #2B5598;
      flex-shrink: 0;
      overflow: hidden;
    }
    .loading-bar-inner {
      height: 100%;
      background: #60a5fa;
      width: 40%;
      animation: loading-slide 1s ease-in-out infinite;
    }
    @keyframes loading-slide {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(350%); }
    }
  `;

  @state() private tabs: Tab[] = [];
  @state() private activeTabId: string = HOME_TAB_ID;
  @state() private _loadingCount = 0;

  private unsubs: Array<() => void> = [];

  connectedCallback() {
    super.connectedCallback();
    this.tabs = [{
      id: HOME_TAB_ID,
      route: "",
      modelId: null,
      element: document.createElement("home-tab"),
      lastUsedAt: Date.now(),
      permanent: true,
    }];
    this.unsubs.push(
      bus.on("tab.open", (msg) => this.handleOpen(msg.route, msg.id ?? null, msg.params)),
      bus.on("tab.close", (msg) => this.handleClose(msg.tabId)),
      // Лічильник зміщуємо в микротаск: loading.start/end часто прилітають синхронно
      // під час коміту апдейта (коли монтується вью й одразу вантажить дані), а пряме
      // присвоєння реактивної властивості в цей момент дає Lit-warning "change-in-update".
      bus.on("loading.start", () => { queueMicrotask(() => { this._loadingCount++; }); }),
      bus.on("loading.end",   () => { queueMicrotask(() => { this._loadingCount = Math.max(0, this._loadingCount - 1); }); }),
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubs.forEach(fn => fn());
    this.unsubs = [];
  }

  private activateTab(tabId: string) {
    this.tabs = this.tabs.map(t =>
      t.id === tabId ? { ...t, lastUsedAt: Date.now() } : t
    );
    this.activeTabId = tabId;
  }

  private evictLru() {
    const lru = [...this.tabs]
      .filter(t => !t.permanent && t.id !== this.activeTabId)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (lru) this.handleClose(lru.id);
  }

  private async handleOpen(route: string, modelId: string | null, _params?: Record<string, unknown>) {
    const existing = this.tabs.find(t => t.route === route && t.modelId === modelId);
    if (existing) { this.activateTab(existing.id); return; }

    const resolved = await resolveChunk(route);
    if (!resolved) {
      console.error(`[tabs] view не знайдено: ${route}`);
      alert(`View не знайдено: ${route}`);
      return;
    }

    const element = await createTabElement(resolved.chunkUrl, modelId);
    if (!element) {
      alert(`Не вдалося завантажити чанк для: ${route}`);
      return;
    }

    if (this.tabs.filter(t => !t.permanent).length >= MAX_TABS) this.evictLru();

    const tab: Tab = {
      id: crypto.randomUUID(),
      route,
      modelId,
      titleKey: resolved.titleKey,
      element,
      lastUsedAt: Date.now(),
    };
    this.tabs = [...this.tabs, tab];
    this.activeTabId = tab.id;
  }

  private handleClose(tabId: string) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || tab.permanent) return;
    const idx = this.tabs.indexOf(tab);
    this.tabs = this.tabs.filter(t => t.id !== tabId);
    if (this.activeTabId === tabId) {
      const next = this.tabs[idx] ?? this.tabs[idx - 1] ?? this.tabs[0];
      this.activeTabId = next?.id ?? HOME_TAB_ID;
    }
    bus.emit({ type: "tab.closed", tabId, route: tab.route, id: tab.modelId });
  }

  private tabTitle(tab: Tab): string {
    const base = tab.titleKey ? t(tab.titleKey) : tab.route;
    return tab.modelId ? `${base} #${tab.modelId}` : base;
  }

  render() {
    return html`
      <app-header></app-header>
      <div class="tab-bar">
        ${this.tabs.map(tab => tab.permanent
          ? html`<div class="tab home ${tab.id === this.activeTabId ? "active" : ""}"
              @click=${() => this.activateTab(tab.id)} title="Home">${iconHome}</div>`
          : html`<div class="tab ${tab.id === this.activeTabId ? "active" : ""}"
              @click=${() => this.activateTab(tab.id)}>
              <span>${this.tabTitle(tab)}</span>
              <span class="tab-close"
                @click=${(e: Event) => { e.stopPropagation(); this.handleClose(tab.id); }}>×</span>
            </div>`
        )}
      </div>
      <div class="loading-bar">
        ${this._loadingCount > 0 ? html`<div class="loading-bar-inner"></div>` : ""}
      </div>
      <picker-host></picker-host>
      <div class="workspace">
        <app-menu></app-menu>
        <div class="panels">
          ${this.tabs.map(tab => html`
            <div class="panel ${tab.id === this.activeTabId ? "active" : ""}">
              ${tab.element}
            </div>
          `)}
        </div>
      </div>
    `;
  }
}
