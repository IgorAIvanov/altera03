/**
 * Дерево груп ієрархічного довідника (патерн A2v10).
 *
 * Два режими:
 *  - `filter` — панель праворуч від списку: чекбокси відмічають групи-фільтри
 *    (список показує вміст відмічених гілок РАЗОМ з підгрупами), зверху —
 *    керування групами (додати/перейменувати/видалити);
 *  - `select` — діалог «перемістити до групи»: клік вибирає одну ціль,
 *    `show-root` додає вузол «Корінь» (id "") — окремої команди «з групи»
 *    немає, корінь — просто ще одна ціль.
 *
 * Дані — команди моделі за конвенцією ієрархії: groupTree / groupSave /
 * groupDelete (оголошуються в manifest.json моделі, генерує sql:gen).
 *
 * Події:
 *  - "groups-changed"  detail {ids: string[]} — змінився набір відмічених;
 *  - "group-selected"  detail {id: string}    — вибрана ціль (select);
 *  - "groups-mutated"  без detail             — групи змінені (rename міняє
 *    groupName у рядках списку — список має перезавантажитися).
 */
import { GlobalStyledLitElement } from "../base/gsle.ts";
import { css, type CSSResultGroup, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { t } from "../../locale.ts";
import { apiFetch } from "../../data/api.ts";
import { tw } from "../../shared/styles.ts";

export interface GroupNode {
  id: string;
  parentId: string | null;
  name: string;
}

type Envelope = {
  ok: boolean;
  data?: { rows?: GroupNode[] };
  messages?: Array<string | { text?: string }>;
};

function firstMessage(env: Envelope): string {
  const m = env.messages?.[0];
  if (!m) return t("common.notFound");
  return typeof m === "string" ? m : m.text ?? "";
}

const icon = {
  add: html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  rename: html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  del: html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
};

export const tagName = "ui-group-tree";

@customElement(tagName)
export class UiGroupTree extends GlobalStyledLitElement {
  // Власний CSS, а не utility-класи: вигляд дерева (чекбокси, направляючі
  // лінії вкладеності) не має залежати від того, які утиліти згенерував
  // Tailwind із чужих файлів. Чекбокс — нативний з accent-color: простіший за
  // daisyUI-варіант і не залежить від структурних змінних теми (`--border`,
  // `--size-selector` — див. коментар у styles/theme.css).
  static override styles: CSSResultGroup = [tw, css`
    :host { display: block; background: var(--color-base-100, #ffffff); }
    .node {
      display: flex; align-items: center; gap: .35rem;
      padding: .18rem .35rem; border-radius: .25rem;
      cursor: pointer; font-size: .85rem; line-height: 1.2;
    }
    .node:hover { background: var(--color-base-200, #eef1f4); }
    .node.current { background: var(--color-base-200, #e3e8ee); }
    .children {
      margin-left: .6rem;
      border-left: 1px solid var(--color-base-300, #d8dde3);
      padding-left: .45rem;
    }
    .expander {
      flex: none; width: 1rem; height: 1rem; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      border: none; background: none; cursor: pointer;
      font-size: .7rem; color: inherit; opacity: .55;
    }
    .expander:hover { opacity: 1; }
    .spacer { flex: none; width: 1rem; }
    input[type="checkbox"] {
      flex: none; width: 14px; height: 14px; margin: 0;
      accent-color: var(--color-primary, #2563eb); cursor: pointer;
    }
    .name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .root-name { font-style: italic; }
  `];

  @property({ type: String }) model = "";
  @property({ type: String }) mode: "filter" | "select" = "filter";
  @property({ type: Boolean, attribute: "show-root" }) showRoot = false;

  @state() private nodes: GroupNode[] = [];
  @state() private expanded = new Set<string>();
  @state() private checked = new Set<string>();
  /** Підсвічений вузол: у select — ціль, у filter — контекст для керування. */
  @state() private currentId: string | null = null;
  /** Інлайн-редагування (додавання/перейменування): жодних prompt(). */
  @state() private editing: { id: string | null; parentId: string | null; name: string } | null = null;
  @state() private error = "";

  override connectedCallback() {
    super.connectedCallback();
    if (this.model) this.load();
  }

  private async command(command: string, payload: unknown): Promise<Envelope> {
    const res = await apiFetch(`/api/model/${this.model}/${command}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    return await res.json() as Envelope;
  }

  private async load() {
    this.error = "";
    const env = await this.command("groupTree", {});
    if (!env.ok) { this.error = firstMessage(env); return; }
    this.nodes = env.data?.rows ?? [];
    // Груп у довіднику десятки, не тисячі — розгортаємо все: згорнуте дерево
    // ховає фільтри, які користувач сам і відмітив.
    this.expanded = new Set(this.nodes.map((n) => n.id));
  }

  private childrenOf(parentId: string | null): GroupNode[] {
    return this.nodes.filter((n) => (n.parentId ?? null) === (parentId ?? null));
  }

  #toggleExpand(id: string) {
    const next = new Set(this.expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expanded = next;
  }

  #toggleCheck(id: string) {
    const next = new Set(this.checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.checked = next;
    this.dispatchEvent(new CustomEvent("groups-changed", {
      detail: { ids: [...next] },
      bubbles: true,
      composed: true,
    }));
  }

  #select(id: string) {
    this.currentId = id;
    if (this.mode === "select") {
      this.dispatchEvent(new CustomEvent("group-selected", {
        detail: { id },
        bubbles: true,
        composed: true,
      }));
    }
  }

  #mutated() {
    this.dispatchEvent(new CustomEvent("groups-mutated", { bubbles: true, composed: true }));
  }

  // ── Керування групами (лише mode="filter") ─────────────────────────────────

  #startAdd() {
    this.error = "";
    this.editing = { id: null, parentId: this.currentId, name: "" };
  }

  #startRename() {
    if (this.currentId === null) return;
    const node = this.nodes.find((n) => n.id === this.currentId);
    if (!node) return;
    this.error = "";
    this.editing = { id: node.id, parentId: node.parentId, name: node.name };
  }

  async #commitEdit() {
    if (!this.editing) return;
    const name = this.editing.name.trim();
    if (!name) return;
    const env = await this.command("groupSave", {
      item: { id: this.editing.id, parentId: this.editing.parentId, name },
    });
    if (!env.ok) { this.error = firstMessage(env); return; }
    this.editing = null;
    await this.load();
    this.#mutated();
  }

  async #deleteCurrent() {
    if (this.currentId === null) return;
    const node = this.nodes.find((n) => n.id === this.currentId);
    if (!node) return;
    if (!confirm(`${t("common.confirmDelete")} "${node.name}"?`)) return;
    // Непорожню групу сервер відмовиться видаляти (fail-closed) — текст
    // відмови показуємо як є.
    const env = await this.command("groupDelete", { id: node.id });
    if (!env.ok) { this.error = firstMessage(env); return; }
    const next = new Set(this.checked);
    next.delete(node.id);
    if (next.size !== this.checked.size) {
      this.checked = next;
      this.dispatchEvent(new CustomEvent("groups-changed", {
        detail: { ids: [...next] },
        bubbles: true,
        composed: true,
      }));
    }
    this.currentId = null;
    await this.load();
    this.#mutated();
  }

  // ── Рендер ─────────────────────────────────────────────────────────────────

  #renderNode(node: GroupNode): TemplateResult {
    const children = this.childrenOf(node.id);
    const open = this.expanded.has(node.id);
    return html`
      <div class="node ${this.currentId === node.id ? "current" : ""}"
        @click=${() => this.#select(node.id)}>
        ${children.length > 0
          ? html`<button class="expander"
              @click=${(e: Event) => { e.stopPropagation(); this.#toggleExpand(node.id); }}>
              ${open ? "▾" : "▸"}
            </button>`
          : html`<span class="spacer"></span>`}
        ${this.mode === "filter"
          ? html`<input type="checkbox"
              .checked=${this.checked.has(node.id)}
              @click=${(e: Event) => e.stopPropagation()}
              @change=${() => this.#toggleCheck(node.id)} />`
          : nothing}
        <span class="name" title=${node.name}>${node.name}</span>
      </div>
      ${open && children.length > 0
        ? html`<div class="children">${children.map((c) => this.#renderNode(c))}</div>`
        : nothing}
    `;
  }

  #renderEditor(): TemplateResult | typeof nothing {
    if (!this.editing) return nothing;
    return html`
      <div class="flex items-center gap-1 p-1 border-b border-base-300">
        <input class="input input-xs flex-1" placeholder=${t("groups.name")}
          .value=${this.editing.name}
          @input=${(e: Event) => { this.editing = { ...this.editing!, name: (e.target as HTMLInputElement).value }; }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") this.#commitEdit();
            if (e.key === "Escape") this.editing = null;
          }} />
        <button class="btn btn-primary btn-xs" @click=${this.#commitEdit}>${t("common.save")}</button>
        <button class="btn btn-ghost btn-xs" @click=${() => { this.editing = null; }}>✕</button>
      </div>
    `;
  }

  override render(): TemplateResult {
    return html`
      <div class="flex flex-col text-sm">
        ${this.mode === "filter"
          ? html`
            <div class="flex items-center gap-1 p-1 border-b border-base-300">
              <span class="font-medium flex-1 px-1">${t("groups.title")}</span>
              <button class="btn btn-ghost btn-xs px-1" title=${t("groups.add")} @click=${this.#startAdd}>
                ${icon.add}
              </button>
              <button class="btn btn-ghost btn-xs px-1" title=${t("groups.rename")}
                ?disabled=${this.currentId === null} @click=${this.#startRename}>
                ${icon.rename}
              </button>
              <button class="btn btn-ghost btn-xs px-1" title=${t("groups.delete")}
                ?disabled=${this.currentId === null} @click=${this.#deleteCurrent}>
                ${icon.del}
              </button>
            </div>`
          : nothing}
        ${this.#renderEditor()}
        ${this.error
          ? html`<div class="text-error text-xs px-2 py-1">${this.error}</div>`
          : nothing}
        <div class="py-1 px-1">
          ${this.mode === "select" && this.showRoot
            ? html`
              <div class="node ${this.currentId === "" ? "current" : ""}"
                @click=${() => this.#select("")}>
                <span class="spacer"></span>
                <span class="name root-name">${t("groups.root")}</span>
              </div>`
            : nothing}
          ${this.childrenOf(null).map((n) => this.#renderNode(n))}
        </div>
      </div>
    `;
  }
}
