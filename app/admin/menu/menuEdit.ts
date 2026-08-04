import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import { viewManifest } from "../../_generated/view-manifest.generated.ts";
import "../../menu/icon-picker.ts";
import {
  MenuEditRootSchema,
  type MenuEditRoot,
  type MenuEntry,
} from "./menu.schema.ts";

export const tagName = "menu-edit";

/**
 * Маршрути беруться зі згенерованого view-manifest, а не вводяться рядком.
 * Маршрут-опечатка дає пункт, який відкривається в нікуди, і помічає це
 * користувач, а не той, хто редагував меню.
 *
 * `edit` і `picker` відсіяні: вони відкриваються з списку й пікера відповідно,
 * а не з меню — окремий пункт на них веде до порожньої форми без контексту.
 */
const ROUTE_OPTIONS = viewManifest
  .map((v) => v.route)
  .filter((route) => !route.endsWith("/edit") && !route.endsWith("/picker"))
  .sort();

/** Подія вибору іконки з `<icon-picker>`; `key === null` — іконку знято. */
type IconPickEvent = CustomEvent<{ key: string | null }>;

@customElement(tagName)
export class MenuEdit extends BaseUI<MenuEditRoot> {
  protected model = "menu";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() {
    super(MenuEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();
  }

  private async load() {
    if (!await this.loadInto("get", { id: this.modelId })) return;
    // menu_get уже віддає пункти в порядку дерева; проганяємо тим самим
    // правилом, що діє після кожної перестановки, — щоб порядок у таблиці не
    // залежав від того, звідки взявся масив.
    this.$root.item = { ...this.$root.item, entries: this.ordered(this.$root.item.entries) };
    // Той самий перезнімок, що й у printTemplateEdit: нормалізація йде ПІСЛЯ
    // знімка loadInto. Тут вона зазвичай нічого не міняє (БД уже віддає порядок
    // дерева), тож «*» на відкритті з'явився б лише на записі, де порядок
    // розійшовся, — саме тому й ставимо явно, а не покладаємось на збіг.
    this.markClean();
  }

  // ── Пункти ────────────────────────────────────────────────────────────────

  private setEntry(index: number, patch: Partial<MenuEntry>) {
    const entries = this.$root.item.entries.map((e, i) => i === index ? { ...e, ...patch } : e);
    this.$root.item = { ...this.$root.item, entries };
  }

  /**
   * Зміна коду тягне за собою дітей: вони посилаються на батька саме кодом, і
   * без переписування прив'язки перейменування теки мовчки їх осиротило б —
   * помилка вилізла б аж при збереженні, вже без підказки, що саме сталося.
   */
  private setCode(index: number, code: string) {
    const previous = this.$root.item.entries[index].code;
    const entries = this.$root.item.entries.map((e, i) => {
      if (i === index) return { ...e, code };
      return e.parentCode === previous ? { ...e, parentCode: code } : e;
    });
    this.$root.item = { ...this.$root.item, entries: this.ordered(entries) };
  }

  /**
   * Порядок дерева — той самий, що будує `menu_get`: обхід від коренів,
   * сусіди за `sortOrder`. Рахується локально після кожної перестановки, щоб
   * таблиця показувала те, що збережеться, а не те, в якому порядку рядки
   * колись прийшли.
   *
   * Недосяжні пункти (батько щойно перейменований або видалений) не зникають,
   * а лишаються в хвості: інакше рядок пропав би з очей, лишившись у даних.
   */
  private ordered(entries: MenuEntry[]): MenuEntry[] {
    const children = new Map<string, MenuEntry[]>();
    for (const entry of entries) {
      const key = entry.parentCode ?? "";
      const bucket = children.get(key);
      bucket ? bucket.push(entry) : children.set(key, [entry]);
    }

    for (const bucket of children.values()) {
      bucket.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    }

    const out: MenuEntry[] = [];
    const seen = new Set<MenuEntry>();

    const walk = (parent: string) => {
      for (const entry of children.get(parent) ?? []) {
        if (seen.has(entry)) continue;   // цикл — далі не йдемо
        seen.add(entry);
        out.push(entry);
        walk(entry.code);
      }
    };

    walk("");
    return [...out, ...entries.filter((e) => !seen.has(e))];
  }

  /**
   * Перестановка рядка серед СУСІДІВ — пунктів із тим самим батьком. Рухати
   * повз межу батька безглуздо: позиція пункту має сенс лише всередині своєї
   * теки, а «вище» через межу означало б зміну батька, для чого є окрема
   * колонка.
   *
   * Після перестановки `sortOrder` сусідів перенумеровується десятками, а не
   * просто міняється місцями: у сусідів можуть бути однакові значення (типово
   * нулі після ручного вводу), і тоді обмін нічого б не змінив.
   */
  private moveEntry(index: number, direction: -1 | 1) {
    const entries = this.$root.item.entries;
    const entry = entries[index];
    const siblings = entries.filter((e) => (e.parentCode ?? "") === (entry.parentCode ?? ""));
    const at = siblings.indexOf(entry);
    const to = at + direction;
    if (to < 0 || to >= siblings.length) return;

    const reordered = [...siblings];
    reordered.splice(at, 1);
    reordered.splice(to, 0, entry);

    const order = new Map(reordered.map((e, i) => [e, (i + 1) * 10]));
    const updated = entries.map((e) => order.has(e) ? { ...e, sortOrder: order.get(e)! } : e);

    this.$root.item = { ...this.$root.item, entries: this.ordered(updated) };
  }

  /** Чи є куди рухати: на межі своєї теки кнопка гасне. */
  private canMove(entry: MenuEntry, direction: -1 | 1): boolean {
    const siblings = this.$root.item.entries
      .filter((e) => (e.parentCode ?? "") === (entry.parentCode ?? ""));
    const at = siblings.indexOf(entry);
    return at + direction >= 0 && at + direction < siblings.length;
  }

  private addEntry() {
    // Код підставляється вільним, а не лишається порожнім: порожній одразу
    // валить збереження, а придумувати його щоразу вручну — зайва робота.
    const taken = new Set(this.$root.item.entries.map((e) => e.code));
    let n = this.$root.item.entries.length + 1;
    while (taken.has(`item${n}`)) n++;

    const entry: MenuEntry = {
      id: null,
      parentCode: null,
      code: `item${n}`,
      name: "",
      iconKey: null,
      routePath: null,
      sortOrder: (this.$root.item.entries.length + 1) * 10,
      isActive: true,
    };

    this.$root.item = { ...this.$root.item, entries: [...this.$root.item.entries, entry] };
  }

  private removeEntry(index: number) {
    const removed = this.$root.item.entries[index];
    const entries = this.$root.item.entries
      .filter((_, i) => i !== index)
      // Діти видаленої теки лишилися б із неіснуючим батьком — SQL таке
      // відхилить цілим збереженням. Піднімаємо їх на рівень видаленого.
      .map((e) => e.parentCode === removed.code ? { ...e, parentCode: removed.parentCode } : e);

    this.$root.item = { ...this.$root.item, entries: this.ordered(entries) };
  }

  // ── Групи ─────────────────────────────────────────────────────────────────

  private toggleGroup(id: string, checked: boolean) {
    const current = new Set(this.$root.item.groupIds);
    checked ? current.add(id) : current.delete(id);
    this.$root.item = { ...this.$root.item, groupIds: [...current] };
  }

  // ── Рендер ────────────────────────────────────────────────────────────────

  override render() {
    if (this.running === "get") return html`
      <div class="flex justify-center p-8">
        <span class="loading loading-spinner"></span>
      </div>
    `;

    const item = this.$root.item;
    const groups = this.$root.options.groups ?? [];

    return html`
      <div class="p-4 max-w-5xl flex flex-col gap-2">
        ${this.renderNotice()}
        ${this.renderFields(html`
          <div class="grid grid-cols-2 gap-2">
            ${this.renderField(
              this.t("common.code"),
              html`<input class="input input-bordered w-full" .value=${item.code ?? ""}
                @input=${this.bindTo(item, "code")} />`,
              { field: "code" },
            )}

            ${this.renderField(
              this.t("common.name"),
              html`<input class="input input-bordered w-full" .value=${item.name ?? ""}
                @input=${this.bindTo(item, "name")} />`,
              { field: "name" },
            )}
          </div>

          ${this.renderField(
            this.t("menu.isActive"),
            html`<input type="checkbox" class="checkbox checkbox-sm" .checked=${item.isActive !== false}
              @change=${(e: Event) => {
                this.$root.item = { ...item, isActive: (e.target as HTMLInputElement).checked };
              }} />`,
          )}

          <!-- Групи: меню призначається групі, не людині. -->
          <div class="mt-2">
            <div class="font-semibold mb-1">${this.t("menu.groups")}</div>
            ${groups.length === 0
              ? html`<div class="text-base-content/50">${this.t("common.noData")}</div>`
              : html`
                <div class="flex flex-wrap gap-3">
                  ${groups.map((g) => html`
                    <label class="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" class="checkbox checkbox-sm"
                        .checked=${item.groupIds.includes(g.id)}
                        @change=${(e: Event) => this.toggleGroup(g.id, (e.target as HTMLInputElement).checked)} />
                      <span>${g.name}</span>
                    </label>
                  `)}
                </div>
              `}
          </div>

          <!-- Пункти. Плоска таблиця з батьком за кодом: дерево тут читається
               гірше, ніж редагується, а порядок рядків задає menu_get. -->
          <div class="flex items-center justify-between mt-4 mb-2">
            <span class="font-semibold">${this.t("menu.items")}</span>
            <button class="btn btn-sm" @click=${this.addEntry}>+ ${this.t("menu.addItem")}</button>
          </div>

          <table class="table table-sm w-full table-tabular">
            <thead>
              <tr>
                <th class="w-40">${this.t("menu.parent")}</th>
                <th class="w-40">${this.t("common.code")}</th>
                <th>${this.t("common.name")}</th>
                <th class="w-40">${this.t("menu.icon")}</th>
                <th class="w-64">${this.t("menu.route")}</th>
                <th class="w-20 text-right">${this.t("menu.sortOrder")}</th>
                <th class="w-16 text-center">${this.t("menu.isActive")}</th>
                <th class="w-16"></th>
                <th class="w-10"></th>
              </tr>
            </thead>
            <tbody>
              ${item.entries.map((entry, i) => html`
                <tr>
                  <td>
                    <select class="select select-sm w-full" .value=${entry.parentCode ?? ""}
                      @change=${(e: Event) => this.setEntry(i, {
                        parentCode: (e.target as HTMLSelectElement).value || null,
                      })}>
                      <option value="">— ${this.t("menu.root")} —</option>
                      ${item.entries
                        .filter((o) => o.code && o.code !== entry.code)
                        .map((o) => html`
                          <option value=${o.code} ?selected=${o.code === entry.parentCode}>${o.code}</option>
                        `)}
                    </select>
                  </td>
                  <td>
                    <input class="input input-sm w-full" .value=${entry.code}
                      @change=${(e: Event) => this.setCode(i, (e.target as HTMLInputElement).value)} />
                  </td>
                  <td>
                    <input class="input input-sm w-full" .value=${entry.name}
                      @input=${(e: Event) => this.setEntry(i, { name: (e.target as HTMLInputElement).value })} />
                  </td>
                  <!-- Іконка вибирається сіткою: у option розмітки не буває,
                       тож select показував би самі лише ключі. -->
                  <td>
                    <icon-picker
                      .value=${entry.iconKey}
                      @icon-selected=${(e: IconPickEvent) => this.setEntry(i, { iconKey: e.detail.key })}
                    ></icon-picker>
                  </td>
                  <td>
                    <select class="select select-sm w-full" .value=${entry.routePath ?? ""}
                      @change=${(e: Event) => this.setEntry(i, {
                        routePath: (e.target as HTMLSelectElement).value || null,
                      })}>
                      <option value="">— ${this.t("menu.folder")} —</option>
                      ${ROUTE_OPTIONS.map((route) => html`
                        <option value=${route} ?selected=${route === entry.routePath}>${route}</option>
                      `)}
                    </select>
                  </td>
                  <td>
                    <input type="number" class="input input-sm w-full text-right" .value=${String(entry.sortOrder)}
                      @input=${(e: Event) => this.setEntry(i, {
                        sortOrder: Number((e.target as HTMLInputElement).value) || 0,
                      })} />
                  </td>
                  <td class="text-center">
                    <input type="checkbox" class="checkbox checkbox-sm" .checked=${entry.isActive}
                      @change=${(e: Event) => this.setEntry(i, {
                        isActive: (e.target as HTMLInputElement).checked,
                      })} />
                  </td>
                  <td class="cell-text text-center whitespace-nowrap">
                    <button class="btn btn-ghost btn-xs px-0.5" title=${this.t("menu.moveUp")}
                      ?disabled=${!this.canMove(entry, -1)} @click=${() => this.moveEntry(i, -1)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                    <button class="btn btn-ghost btn-xs px-0.5" title=${this.t("menu.moveDown")}
                      ?disabled=${!this.canMove(entry, 1)} @click=${() => this.moveEntry(i, 1)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                  </td>
                  <td class="text-center">
                    <button class="btn btn-ghost btn-xs text-error" title=${this.t("common.delete")}
                      @click=${() => this.removeEntry(i)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    </button>
                  </td>
                </tr>
              `)}
              ${item.entries.length === 0
                ? html`<tr><td colspan="9" class="text-center text-base-content/40 py-4">${this.t("common.noData")}</td></tr>`
                : ""}
            </tbody>
          </table>
        `)}

        ${this.renderFormActions()}
      </div>
    `;
  }
}
