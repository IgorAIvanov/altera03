import { LitElement, html, css, svg, type PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { bus } from "../bus/bus.ts";
import { t } from "../locale.ts";
import { shellTags } from "../shell/shell-registry.ts";
import "@client/ui-kit/picker-host.ts";
import { apiFetch, readEnvelope, ServerUnavailableError } from "../data/api.ts";

const MAX_TABS = 30;
const HOME_TAB_ID = "home";
const TAB_STORAGE_KEY = "altera.open-tabs";
/** Скільки тримати повідомлення про невдале відкриття, мс. */
const NOTICE_TIMEOUT_MS = 8000;

const iconHome = svg`
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
  </svg>
`;

interface Tab {
  id: string;
  route: string;
  modelId: string | null;
  titleKey?: string;
  /** null — вкладка-заглушка після перезавантаження: чанк ще вантажиться. */
  element: HTMLElement | null;
  lastUsedAt: number;
  permanent?: boolean;
}

/** Знімок вкладки для localStorage: тільки те, з чого її можна відтворити. */
interface StoredTab {
  route: string;
  modelId: string | null;
  /**
   * Коли вкладкою користувалися останній раз. Зберігається, щоб після
   * перезавантаження сторінки LRU не починав з нуля: інакше всі відновлені
   * вкладки отримали б однакову мітку, і «найдовше не використана» до перших
   * перемикань визначалася б випадково. Може бути відсутнім у знімках, збережених
   * попередніми версіями.
   */
  lastUsedAt?: number;
}

interface StoredTabs {
  tabs: StoredTab[];
  /** route+modelId активної вкладки; null — активна домашня. */
  active: StoredTab | null;
}

function loadStoredTabs(): StoredTabs {
  const empty: StoredTabs = { tabs: [], active: null };
  try {
    const raw = globalThis.localStorage?.getItem(TAB_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tabs)) return empty;
    const tabs = parsed.tabs.filter((v: unknown): v is StoredTab =>
      !!v && typeof (v as StoredTab).route === "string"
    ).map((v: StoredTab) => ({
      route: v.route,
      modelId: v.modelId ?? null,
      lastUsedAt: typeof v.lastUsedAt === "number" ? v.lastUsedAt : undefined,
    }));
    const rawActive = parsed.active;
    const active = rawActive && typeof rawActive.route === "string"
      ? { route: rawActive.route, modelId: rawActive.modelId ?? null }
      : null;
    return { tabs, active };
  } catch {
    return empty;
  }
}

function storeTabs(state: StoredTabs) {
  try {
    globalThis.localStorage?.setItem(TAB_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // приватний режим / переповнене сховище — не критично для роботи
  }
}

/**
 * Результат спроби відкрити вкладку.
 *
 * Раніше всі невдачі зводилися до `null`, і користувач бачив одне «не вдалося
 * відкрити view» на три різні події: форми немає в реєстрі, модуль форми
 * зламаний, сервер не відповів. Дії в цих випадках теж різні, тож причину треба
 * донести, а не з'ясовувати щоразу з консолі.
 */
type OpenResult<T> = { ok: true; value: T } | { ok: false; reason: string };

interface ResolvedChunk {
  chunkUrl: string;
  titleKey?: string;
}

/** Те, що `/api/view/...` кладе в `data.item` стандартного конверта. */
interface ViewItem {
  chunkUrl: string;
  titleKey: string | null;
}

async function resolveChunk(route: string): Promise<OpenResult<ResolvedChunk>> {
  const [module, model, view] = route.split("/");
  const res = await apiFetch(`/api/view/${module}/${model}/${view}`);
  // `readEnvelope`, а не `res.json()`: відповідь не від нашого сервера (сторінка
  // помилки проксі) має піднімати екран «сервера немає», а не вдавати, що
  // форми не існує. Виняток звідси летить далі навмисно.
  const envelope = await readEnvelope<ViewItem>(res);
  const item = envelope.data?.item;

  if (!envelope.ok || !item?.chunkUrl) {
    console.error(`[tabs] сервер не віддав view ${route}: HTTP ${res.status}`, envelope);
    return {
      ok: false,
      // Маршрут дійшов до сервера, але в'ю там немає: або його не оголошено в
      // manifest.json моделі, або не перегенеровано реєстр. 404 — саме цей
      // випадок, решта статусів означає, що зламалося щось інше.
      reason: res.status === 404
        ? `Форму «${route}» не зареєстровано на сервері.`
        : `Сервер не зміг віддати форму «${route}» (помилка ${res.status}).`,
    };
  }

  return { ok: true, value: { chunkUrl: item.chunkUrl, titleKey: item.titleKey ?? undefined } };
}

async function createTabElement(
  chunkUrl: string,
  modelId: string | null,
  tabId: string,
  params?: Record<string, unknown>,
): Promise<OpenResult<HTMLElement>> {
  let mod: { tagName?: string; default?: { tagName?: string } };

  try {
    mod = await import(/* @vite-ignore */ chunkUrl);
  } catch (e) {
    console.error(`[tabs] помилка завантаження чанку ${chunkUrl}`, e);
    return { ok: false, reason: "Не вдалося завантажити модуль форми." };
  }

  const tagName: string | undefined = mod.tagName ?? mod.default?.tagName;
  if (!tagName) {
    console.error(`[tabs] модуль ${chunkUrl} не експортує tagName`);
    return { ok: false, reason: "Модуль форми не експортує tagName." };
  }

  const el = document.createElement(tagName);
  if (modelId) (el as any).modelId = modelId;
  // Форма має вміти закрити саму себе — інакше кнопка «Закрити» не має
  // за що вхопитися: елемент нічого не знає про вкладку, в якій живе.
  (el as any).tabId = tabId;
  // Параметри відкриття (напр. рахунок і період для картки рахунку).
  // Передаємо ДО вставки в DOM, щоб connectedCallback побачив уже готовий стан.
  if (params) (el as any).applyParams?.(params);
  return { ok: true, value: el };
}

@customElement("tab-controller")
export class TabController extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: "Roboto", sans-serif;
      font-size: var(--default-font-size, 0.875rem);
    }
    .tab-bar {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      padding: 4px 4px 0;
      background: var(--color-primary, #2f5f8f);
      overflow-x: auto;
      flex-shrink: 0;
    }
    .tab {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 6px 3px 10px;
      border-radius: 2px 2px 0 0;
      background: var(--color-secondary, #4a7ab5);
      color: #d0e0f5;
      cursor: pointer;
      font-size: inherit;
      white-space: nowrap;
      user-select: none;
      border: 1px solid #244b71;
      border-bottom: none;
    }
    .tab.active {
      background: var(--color-base-200, #dfe5ea);
      color: var(--color-base-content, #243746);
      font-weight: 500;
    }
    .tab.home { padding: 3px 8px; }
    .tab-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 2px;
      font-size: 15px;
      opacity: 0.6;
      margin-left: 4px;
    }
    .tab-close:hover { background: var(--app-border, #b8c3cc); opacity: 1; color: #111; }
    .workspace { display: flex; flex: 1; overflow: hidden; }
    .panels { flex: 1; position: relative; overflow: hidden; background: var(--app-surface, #f6f8fa); }
    .panel {
      position: absolute;
      inset: 0;
      overflow: auto;
      display: none;
    }
    .panel.active { display: block; }
    .loading-bar {
      height: 3px;
      background: var(--color-primary, #2f5f8f);
      flex-shrink: 0;
      overflow: hidden;
    }
    .loading-bar-inner {
      height: 100%;
      background: #7fb0e0;
      width: 40%;
      animation: loading-slide 1s ease-in-out infinite;
    }
    @keyframes loading-slide {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(350%); }
    }
    /* Повідомлення про невдале відкриття. Кутом робочої області, а не модальним
       вікном: користувач нічого не зіпсував і підтверджувати йому нічого — на
       відміну від alert(), який зупиняв усе й показував адресу сайту. */
    .notice {
      position: absolute;
      right: 16px;
      bottom: 16px;
      z-index: 20;
      max-width: 24rem;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 6px;
      border: 1px solid #f0b4b4;
      background: #fdecec;
      color: #7d1d1d;
      box-shadow: 0 6px 20px rgba(0, 0, 0, .18);
      line-height: 1.45;
    }
    .notice-text { flex: 1; }
    .notice-close {
      cursor: pointer;
      opacity: .55;
      font-size: 15px;
      line-height: 1;
      user-select: none;
    }
    .notice-close:hover { opacity: 1; }
    @media (prefers-color-scheme: dark) {
      .notice { border-color: #7d2b2b; background: #2a1717; color: #f3c9c9; }
    }
  `;

  @state() private tabs: Tab[] = [];
  @state() private activeTabId: string = HOME_TAB_ID;
  @state() private _loadingCount = 0;
  /** Повідомлення про невдале відкриття вкладки; null — показувати нічого. */
  @state() private notice: string | null = null;

  private noticeTimer: number | null = null;
  private unsubs: Array<() => void> = [];
  /** Під час відновлення не пишемо у сховище — інакше частковий стан перетре збережений. */
  private restoring = false;
  private restored = false;

  // Елементи оболонки беремо з реєстру (заповнюється composition root застосунку),
  // тож фреймворк не залежить від конкретних app-компонентів.
  private headerEl!: HTMLElement;
  private menuEl!: HTMLElement;
  private homeTag = "";

  override connectedCallback() {
    super.connectedCallback();
    const shell = shellTags();
    this.headerEl = document.createElement(shell.header);
    this.menuEl = document.createElement(shell.menu);
    this.homeTag = shell.home;

    // Збережені вкладки створюємо заглушками ще до першого рендера й одразу
    // ставимо активну — інакше на час асинхронного завантаження чанків
    // блимала б домашня сторінка.
    const { tabs: stored, active } = this.restored
      ? { tabs: [], active: null }
      : loadStoredTabs();
    this.restored = true;
    // Мітку використання беремо зі знімка — так LRU після перезавантаження
    // пам'ятає, чим користувалися давно, а чим щойно. Знімки старого формату
    // (без мітки) отримують поточний час: гірше за справжню історію, але
    // рівномірно, і перше ж перемикання все розставить.
    const restoredAt = Date.now();
    const placeholders: Tab[] = stored.slice(0, MAX_TABS).map(item => ({
      id: crypto.randomUUID(),
      route: item.route,
      modelId: item.modelId,
      element: null,
      lastUsedAt: item.lastUsedAt ?? restoredAt,
    }));
    const activeTab = active
      ? placeholders.find(t => t.route === active.route && t.modelId === active.modelId)
      : undefined;

    this.tabs = [{
      id: HOME_TAB_ID,
      route: "",
      modelId: null,
      // Домашню сторінку монтуємо лише коли вона справді активна.
      element: activeTab ? null : document.createElement(shell.home),
      lastUsedAt: Date.now(),
      permanent: true,
    }, ...placeholders];
    this.activeTabId = activeTab?.id ?? HOME_TAB_ID;

    this.unsubs.push(
      bus.on("tab.open", (msg) => this.handleOpen(msg.route, msg.id ?? null, msg.params)),
      bus.on("tab.close", (msg) => this.handleClose(msg.tabId)),
      // Оболонка — єдине місце, де показуються короткі повідомлення: вона одна
      // на застосунок і завжди на екрані, на відміну від форми, яка могла й не
      // відкритися саме тому, що є про що повідомити.
      bus.on("notice", (msg) => this.showNotice(msg.text)),
      // Лічильник зміщуємо в микротаск: loading.start/end часто прилітають синхронно
      // під час коміту апдейта (коли монтується вью й одразу вантажить дані), а пряме
      // присвоєння реактивної властивості в цей момент дає Lit-warning "change-in-update".
      bus.on("loading.start", () => { queueMicrotask(() => { this._loadingCount++; }); }),
      bus.on("loading.end",   () => { queueMicrotask(() => { this._loadingCount = Math.max(0, this._loadingCount - 1); }); }),
    );
    void this.hydrateTabs(placeholders.map(t => t.id), activeTab?.id);
  }

  override updated(changed: PropertyValues) {
    if (changed.has("tabs") || changed.has("activeTabId")) this.persistTabs();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubs.forEach(fn => fn());
    this.unsubs = [];
    this.dismissNotice();
  }

  /** Показати повідомлення. Наступне витісняє попереднє разом із його таймером. */
  private showNotice(text: string) {
    this.notice = text;
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice = null;
      this.noticeTimer = null;
    }, NOTICE_TIMEOUT_MS);
  }

  private dismissNotice() {
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
    this.notice = null;
  }

  private activateTab(tabId: string) {
    const now = Date.now();
    const leaving = this.activeTabId;
    this.tabs = this.tabs.map(t => {
      // Вкладку, з якої йдемо, позначаємо використаною ЗАРАЗ: інакше її мітка
      // лишалася б часом входу, і вкладка, в якій довго працювали не
      // перемикаючись, виглядала б «давно не використаною» — LRU закривав би
      // саме її, хоч користувач щойно в ній був.
      if (t.id === leaving && t.id !== tabId) return { ...t, lastUsedAt: now };
      if (t.id !== tabId) return t;
      // Домашня сторінка могла лишитися незмонтованою (див. connectedCallback).
      const element = t.element ?? (t.permanent ? document.createElement(this.homeTag) : null);
      return { ...t, element, lastUsedAt: now };
    });
    this.activeTabId = tabId;
  }

  /**
   * Закриває вкладку, якою не користувалися найдовше (LRU).
   *
   * `lastUsedAt` оновлюється і при вході у вкладку, і при виході з неї
   * (див. `activateTab`), тому «найменше значення» справді означає «найдовше не
   * відкривали». Активна й домашня вкладки під витіснення не потрапляють.
   */
  private evictLru() {
    const lru = [...this.tabs]
      .filter(t => !t.permanent && t.id !== this.activeTabId)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (lru) this.handleClose(lru.id);
  }

  private async createTab(
    route: string,
    modelId: string | null,
    params?: Record<string, unknown>,
    id: string = crypto.randomUUID(),
  ): Promise<OpenResult<Tab>> {
    const resolved = await resolveChunk(route);
    if (!resolved.ok) return resolved;

    const element = await createTabElement(resolved.value.chunkUrl, modelId, id, params);
    if (!element.ok) return element;

    return {
      ok: true,
      value: {
        id,
        route,
        modelId,
        titleKey: resolved.value.titleKey,
        element: element.value,
        lastUsedAt: Date.now(),
      },
    };
  }

  private async handleOpen(route: string, modelId: string | null, params?: Record<string, unknown>) {
    const existing = this.tabs.find(t => t.route === route && t.modelId === modelId);
    if (existing) {
      // Вкладка вже відкрита: не створюємо другу, але параметри застосовуємо —
      // інакше перехід зі звіту в звіт із іншим рахунком показав би старі дані.
      if (params && existing.element) {
        (existing.element as unknown as { applyParams?: (p: Record<string, unknown>) => void })
          .applyParams?.(params);
      }
      this.activateTab(existing.id);
      return;
    }

    let created: OpenResult<Tab>;
    try {
      created = await this.createTab(route, modelId, params);
    } catch (e) {
      // Недоступний сервер малює власний екран поверх усього — друге
      // повідомлення про те саме тільки заважало б.
      if (e instanceof ServerUnavailableError) return;
      throw e;
    }

    if (!created.ok) {
      this.showNotice(created.reason);
      return;
    }

    const tab = created.value;
    if (this.tabs.filter(t => !t.permanent).length >= MAX_TABS) this.evictLru();

    // Вкладку, з якої йдемо, позначаємо використаною зараз — тією ж логікою, що в
    // `activateTab` (сюди воно не заходить, бо активною стає щойно створена).
    const now = Date.now();
    const leaving = this.activeTabId;
    this.tabs = [
      ...this.tabs.map(t => (t.id === leaving ? { ...t, lastUsedAt: now } : t)),
      tab,
    ];
    this.activeTabId = tab.id;
  }

  /**
   * Дозавантаження вкладок-заглушок після перезавантаження сторінки.
   * Активну беремо першою, щоб користувач побачив саме її без затримки.
   */
  private async hydrateTabs(ids: string[], activeId?: string) {
    if (!ids.length) return;
    const ordered = activeId ? [activeId, ...ids.filter(id => id !== activeId)] : ids;

    this.restoring = true;
    try {
      for (const id of ordered) {
        const pending = this.tabs.find(t => t.id === id);
        if (!pending || pending.element) continue;

        let hydrated: OpenResult<Tab>;
        try {
          hydrated = await this.createTab(pending.route, pending.modelId, undefined, id);
        } catch (e) {
          // Сервера немає — припиняємо відновлення, лишивши заглушки. Викидати
          // збережені вкладки через те, що бекенд не запущений, не можна: після
          // його підняття користувач має побачити свій набір, а не порожньо.
          if (e instanceof ServerUnavailableError) return;
          throw e;
        }

        if (hydrated.ok) {
          // `createTab` ставить свіжу мітку — повертаємо відновлену зі знімка,
          // інакше дозавантаження прикинулося б використанням і зрівняло всі
          // вкладки за часом.
          const restored = { ...hydrated.value, lastUsedAt: pending.lastUsedAt };
          this.tabs = this.tabs.map(t => t.id === id ? restored : t);
        } else {
          // View більше не існує — прибираємо вкладку, як і при звичайному закритті.
          console.warn(`[tabs] відновити вкладку ${pending.route} не вдалося: ${hydrated.reason}`);
          this.tabs = this.tabs.filter(t => t.id !== id);
          if (this.activeTabId === id) this.activateTab(HOME_TAB_ID);
        }
      }
    } finally {
      this.restoring = false;
      this.persistTabs();
    }
  }

  private persistTabs() {
    if (this.restoring) return;
    const open = this.tabs.filter(t => !t.permanent);
    const activeTab = open.find(t => t.id === this.activeTabId);
    storeTabs({
      // Активна вкладка «використовується прямо зараз» — інакше після
      // перезавантаження вона виглядала б давньою (мітку їй ставили при вході).
      tabs: open.map(t => ({
        route: t.route,
        modelId: t.modelId,
        lastUsedAt: t.id === this.activeTabId ? Date.now() : t.lastUsedAt,
      })),
      active: activeTab ? { route: activeTab.route, modelId: activeTab.modelId } : null,
    });
  }

  private handleClose(tabId: string) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || tab.permanent) return;
    const idx = this.tabs.indexOf(tab);
    this.tabs = this.tabs.filter(t => t.id !== tabId);
    if (this.activeTabId === tabId) {
      const next = this.tabs[idx] ?? this.tabs[idx - 1] ?? this.tabs[0];
      this.activateTab(next?.id ?? HOME_TAB_ID);
    }
    bus.emit({ type: "tab.closed", tabId, route: tab.route, id: tab.modelId });
  }

  private tabTitle(tab: Tab): string {
    const base = tab.titleKey ? t(tab.titleKey) : tab.route;
    return tab.modelId ? `${base} #${tab.modelId}` : base;
  }

  override render() {
    return html`
      ${this.headerEl}
      <div class="tab-bar">
        ${repeat(this.tabs, tab => tab.id, tab => tab.permanent
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
        ${this.menuEl}
        <div class="panels">
          <!-- repeat з ключем tab.id, а НЕ .map(): панель містить живий DOM-елемент
               форми. У неключевому списку будь-яка зміна масиву (відкриття/закриття
               вкладки) змушує Lit перевставляти ці елементи — кожна форма дістає
               disconnected+connected, а її connectedCallback робить load(). Виходить
               O(n-квадрат) запитів на n вкладок, і на ~10-й вичерпується сокет-буфер
               (ERR_NO_BUFFER_SPACE). Ключ прив'язує панель до вкладки, тож Lit чіпає
               лише ту, що змінилась. -->
          ${repeat(this.tabs, tab => tab.id, tab => html`
            <div class="panel ${tab.id === this.activeTabId ? "active" : ""}">
              ${tab.element}
            </div>
          `)}
          ${this.notice
            ? html`<div class="notice" role="alert">
                <span class="notice-text">${this.notice}</span>
                <span class="notice-close" title="Закрити"
                  @click=${this.dismissNotice}>×</span>
              </div>`
            : ""}
        </div>
      </div>
    `;
  }
}
