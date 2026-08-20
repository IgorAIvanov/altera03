/**
 * Підпорядкований регістр — ПАНЕЛЬ (логіка в `subordinate-register.ts`).
 *
 * Малює те, що в кожному застосунку виходило однаковим: смугу дій, сітку,
 * порожній стан, підказку «спершу збережіть картку» — і правку ПРЯМО В РЯДКУ.
 * Замінити своїм можна будь-коли (усі дії публічні на контролері), але
 * переписувати доводилося саме це, і щоразу з тими самими чотирма пастками
 * (див. коментар контролера).
 *
 * ЧОМУ СІТКА, А НЕ СМУГА РЕДАКТОРА. Доти рядок правився в окремій смузі над
 * таблицею. Вона повторювала ту саму сітку другим разом, вимагала оголосити
 * кожне поле двічі — колонкою й полем редактора, — і давала два різні способи
 * вводу для двох однакових на вигляд таблиць сусідніх екранів. Тепер вигляд і
 * клавіатура ті самі, що в табличної частини документа, і контракт комірок теж
 * її — `.table-tabular` / `cell-control` із теми.
 *
 * ЩО ПРИ ЦЬОМУ НЕ ЗМІНИЛОСЯ: межа запису лишилася явною. Рядок у правці — це
 * чернетка контролера, і на сервер вона їде натисканням (✓ або Enter). Запис
 * «по виходу з рядка» виглядав би природніше рівно доти, доки сервер не
 * відмовить або користувач не перемкне вкладку посеред набору.
 *
 * ЧОМУ ВЛАСНИЙ SignalWatcher. `register.readonly` і `register.ownerId` — це
 * функції форми, а вони читають сигнали (`$root` і право на запис). Без
 * підписки панель про зміну не дізнається: власна властивість `register`
 * лишається ТИМ САМИМ об'єктом, тож після першого збереження картки панель
 * так і стояла б вимкненою. Той самий випадок, що з тулбаром табличної частини.
 */
import { css, type CSSResultGroup, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { GlobalStyledLitElement } from "../base/gsle.ts";
import { tw } from "../../shared/styles.ts";
import { t } from "../../locale.ts";
import { formatDate } from "../../shared/datetime.ts";
import { icons } from "../icons.ts";
import {
  refNameOf,
  type SubordinateColumn,
  type SubordinateRegister,
} from "./subordinate-register.ts";
import "../components/ui-picker.ts";
import "../components/ui-decimal.ts";
import "../components/ui-date.ts";
import "../components/ui-select.ts";

const Base: typeof GlobalStyledLitElement = SignalWatcher(GlobalStyledLitElement);

export const tagName = "ui-subordinate-register";

type AnyRow = Record<string, unknown>;
type ValueEvent = CustomEvent<{ value: string }>;
type PickEvent = CustomEvent<{ value: { id?: string; name?: string } | null }>;

/** Селектор контрола комірки — те саме, що в табличної частини. */
const CELL_CONTROL = "ui-picker, ui-decimal, ui-date, ui-select, input, select";

@customElement(tagName)
export class UiSubordinateRegister extends Base {
  @property({ attribute: false }) register?: SubordinateRegister<AnyRow>;

  static override styles: CSSResultGroup = [tw, css`
    /* Поточний рядок і невалідна комірка — те саме, що в ui-tabular-table:
       дві таблиці, які людина бачить на сусідніх екранах, не мають права
       підсвічувати одне й те саме по-різному.
       Зворотних лапок тут бути не може — це тіло шаблонного рядка css. */
    tr.current td { background: #eef4fb; }
    tr td.cell-invalid {
      background: #fdecec;
      outline: 1px solid var(--color-error);
      outline-offset: -1px;
    }
    /* Рядок, поставлений документом: правити його з картки не можна, і це має
       бути видно ДО того, як користувач натисне на вимкнену кнопку. */
    tbody tr.locked td { color: #6b7785; }
  `];

  #bound?: SubordinateRegister<AnyRow>;
  /** Відкриття правки, у яке фокус уже поставили (`draftSeq` контролера). */
  #focusedFor = 0;

  protected override willUpdate() {
    if (this.register !== this.#bound) {
      this.#bound?.unbind(this);
      this.register?.bind(this);
      this.#bound = this.register;
    }
    // Картка могла щойно зберегтися й дістати id — перелік мусить ожити сам.
    this.register?.syncOwner();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#bound?.unbind(this);
    this.#bound = undefined;
  }

  /**
   * Фокус у першу комірку рядка, який щойно відкрили на правку.
   *
   * Без цього «Додати» давало порожній рядок, у який ще треба потрапити мишею —
   * а ввід тут клавіатурний (Enter пише, Esc скасовує), тобто миша потрібна
   * рівно один раз і рівно на те, щоб почати.
   */
  protected override updated() {
    const register = this.register;
    if (!register?.draft) {
      this.#focusedFor = 0;
      return;
    }
    if (this.#focusedFor === register.draftSeq) return;
    this.#focusedFor = register.draftSeq;
    this.renderRoot.querySelector<HTMLElement>(`tr.editing ${CELL_CONTROL}`)?.focus();
  }

  // ── Клавіатура ─────────────────────────────────────────────────────────────

  /**
   * Enter — записати рядок, Escape — відмовитися, Insert — новий рядок.
   *
   * `defaultPrevented` тут головне: випадний список пікера й календар дати
   * забирають обидві клавіші собі й позначають це (правило «обробив — познач»).
   * Без перевірки Enter у відкритому списку писав би рядок замість вибору
   * значення, а Escape закривав би правку разом зі списком.
   */
  #onKeyDown = (e: KeyboardEvent) => {
    const register = this.register;
    if (!register || e.defaultPrevented) return;

    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && register.draft) {
      e.preventDefault();
      void register.submit();
      return;
    }
    if (e.key === "Escape" && register.draft) {
      e.preventDefault();
      register.cancel();
      return;
    }
    if (e.key === "Insert" && !register.draft && register.ready && !register.readonly) {
      e.preventDefault();
      register.startAdd();
    }
  };

  // ── Комірка: показ ─────────────────────────────────────────────────────────

  #display(column: SubordinateColumn<AnyRow>, row: AnyRow): TemplateResult | string {
    if (column.render) return column.render(row);

    if (column.kind === "picker") {
      const ref = row[refNameOf(column.key, column.refKey)] as AnyRow | null;
      if (!ref) return "";
      return String(ref[column.displayField ?? "name"] ?? ref.name ?? "");
    }

    const value = row[column.key];
    if (value === null || value === undefined) return "";
    if (column.kind === "select") {
      const option = column.options?.().find((o) => o.value === String(value));
      return option?.label ?? String(value);
    }
    if (column.format) return formatDate(String(value), column.format) || String(value);
    if (typeof value === "boolean") return value ? "✓" : "";
    // Вкладений об'єкт-ссылка приходить як `{ id, name }` — показуємо підпис.
    if (typeof value === "object") {
      const ref = value as AnyRow;
      return String(ref.name ?? ref.presentation ?? ref.code ?? "");
    }
    return String(value);
  }

  // ── Комірка: правка ────────────────────────────────────────────────────────

  /**
   * Контрол комірки в режимі `cell`: рамку, висоту рядка й фокус малює
   * контракт табличної частини, а не сам контрол — інакше рядок у правці
   * підстрибував би на висоту звичайного поля.
   */
  #editor(column: SubordinateColumn<AnyRow>, draft: AnyRow): TemplateResult | string {
    const register = this.register!;
    const key = column.key;
    const value = draft[key];

    switch (column.kind) {
      case "custom":
        return column.editor?.(draft) ?? "";

      case "decimal":
        return html`<ui-decimal cell
          .precision=${column.precision ?? 2}
          .value=${String(value ?? "")}
          @value-input=${(e: ValueEvent) => register.patch(key, e.detail.value)}
          @value-changed=${(e: ValueEvent) => register.patch(key, e.detail.value)}
        ></ui-decimal>`;

      case "date":
        return html`<ui-date cell
          .value=${String(value ?? "")}
          @value-changed=${(e: ValueEvent) => register.patch(key, e.detail.value)}
        ></ui-date>`;

      // Прапорець — голий `<input>`, як у табличній частині: класи daisyUI
      // дали б контрол вищий за рядок, а `cell-control` розтягнув би його на
      // всю ширину комірки.
      case "checkbox":
        return html`<input type="checkbox" .checked=${value === true}
          @change=${(e: Event) => register.patch(key, (e.target as HTMLInputElement).checked)} />`;

      case "select":
        return html`<ui-select cell
          .value=${String(value ?? "")}
          .options=${(column.options?.() ?? []) as never}
          @value-changed=${(e: ValueEvent) => register.patch(key, e.detail.value)}
        ></ui-select>`;

      case "picker": {
        // Ключ вкладеного об'єкта — та сама конвенція, що в відборі по
        // власнику: `currencyId` → `currency`. Id і об'єкт пишуться з ОДНІЄЇ
        // події, тож розійтися їм нема як.
        const refKey = refNameOf(key, column.refKey);
        return html`<ui-picker cell
          url=${column.url ?? ""}
          display-field=${column.displayField ?? "name"}
          hint-field=${column.hintField ?? ""}
          ?show-clear=${column.showClear ?? false}
          .value=${(draft[refKey] ?? null) as never}
          @value-changed=${(e: PickEvent) => {
          register.patch(key, String(e.detail.value?.id ?? ""));
          register.patch(refKey, e.detail.value ?? null);
        }}
        ></ui-picker>`;
      }

      default:
        return html`<input class="cell-control" .value=${String(value ?? "")}
          @input=${(e: Event) => register.patch(key, (e.target as HTMLInputElement).value)} />`;
    }
  }

  // ── Розкладка ──────────────────────────────────────────────────────────────

  #alignClass(column: SubordinateColumn<AnyRow>): string {
    const align = column.align ??
      (column.kind === "decimal" ? "right" : column.kind === "checkbox" ? "center" : "left");
    if (align === "right") return "text-right tabular-nums";
    if (align === "center") return "text-center";
    return "";
  }

  /**
   * Комірка показу несе `cell-text` (горизонтальний відступ, вертикальний
   * нуль), комірка з контролом — нічого: відступ у ній зробив би рядок вищим
   * за контрол, а межу й так малює таблиця.
   */
  #cellClass(column: SubordinateColumn<AnyRow>, editable: boolean, invalid: boolean): string {
    const parts = [this.#alignClass(column)];
    if (!editable) parts.push("cell-text");
    if (invalid) parts.push("cell-invalid");
    return parts.filter(Boolean).join(" ");
  }

  #renderRow(row: AnyRow, index: number): TemplateResult {
    const register = this.register!;
    const editing = register.editing(row);
    const draft = (editing ? register.draft : row) as AnyRow;
    const locked = register.locked(row);
    const classes = [
      index === register.currentIndex ? "current" : "",
      editing ? "editing" : "",
      locked ? "locked" : "",
    ].filter(Boolean).join(" ");

    return html`
      <tr class=${classes} title=${register.lockedReason(row) || nothing}
        @click=${() => register.select(index)}
        @dblclick=${() => register.startEdit(row)}>
        ${this.#renderCells(draft, editing)}
        ${this.#renderActions(row, editing, locked)}
      </tr>
    `;
  }

  /** Рядок-чернетка нового запису: у переліку його ще немає. */
  #renderNewRow(): TemplateResult {
    return html`
      <tr class="current editing">
        ${this.#renderCells(this.register!.draft as AnyRow, true)}
        ${this.#renderActions(null, true, false)}
      </tr>
    `;
  }

  #renderCells(row: AnyRow, editing: boolean): TemplateResult[] {
    const register = this.register!;
    const missing = editing ? register.missingFields() : [];
    return register.config.columns.map((column) => {
      const invalid = missing.includes(column.key);
      const editable = editing && !column.readonly;
      return html`
        <td class=${this.#cellClass(column, editable, invalid)}
          title=${invalid ? t("common.fieldRequired") : nothing}>
          ${editable ? this.#editor(column, row) : this.#display(column, row)}
        </td>
      `;
    });
  }

  /**
   * Комірка дій. У рядку в правці — ✓ і ✗ (та сама пара, що на клавішах Enter
   * і Escape), у звичайному — правка й видалення. Кнопки не зникають у режимі
   * перегляду, а гаснуть: відсутня кнопка читається як «дії тут немає ніколи».
   *
   * Плюс слот застосунку — `config.rowActions` (див. його опис): своєї кнопки
   * тут не було куди поставити взагалі, і вона виносилася окремою колонкою.
   */
  #renderActions(row: AnyRow | null, editing: boolean, locked: boolean): TemplateResult {
    const register = this.register!;
    if (editing) {
      return html`
        <td class="text-right whitespace-nowrap">
          <button class="btn btn-ghost btn-xs" title=${t("common.save")}
            @click=${(e: Event) => {
        e.stopPropagation();
        void register.submit();
      }}>${icons.saveClose}</button>
          <button class="btn btn-ghost btn-xs" title=${t("common.cancel")}
            @click=${(e: Event) => {
        e.stopPropagation();
        register.cancel();
      }}>${icons.clear}</button>
        </td>
      `;
    }

    // Доки правиться інший рядок, дії над рештою вимкнені: два відкриті рядки
    // означали б два незаписані стани й питання, який із них пише Enter.
    const busy = register.draft !== null;
    const disabled = busy || register.readonly || !register.ready || locked;
    // Дія застосунку (найчастіше — «відкрити документ, що поставив рядок»)
    // стоїть ЛІВОРУЧ від штатної пари: комірка притиснута до правого краю, тож
    // правка й видалення лишаються на місці й у тих рядках, де своєї дії немає.
    // Вимкненою вона не буває: чужа дія — не наша справа, а найпевніший її
    // випадок (перехід у документ) саме на заблокованому рядку й потрібен.
    const extra = row ? register.config.rowActions?.(row) ?? "" : "";
    return html`
      <td class="text-right whitespace-nowrap">
        ${extra
        // Клік по своїй кнопці не має вважатися вибором рядка — рівно як і по
        // штатних: у них це робить stopPropagation у кожному обробнику, а тут
        // обробник чужий, і забути про це легко.
        ? html`<span @click=${(e: Event) => e.stopPropagation()}>${extra}</span>`
        : nothing}
        <button class="btn btn-ghost btn-xs" ?disabled=${disabled}
          title=${locked ? register.lockedReason(row!) : t("common.open")}
          @click=${(e: Event) => {
        e.stopPropagation();
        register.startEdit(row!);
      }}>${icons.open}</button>
        <!-- Хрестик, а не урна: рядок регістру ЗНИКАЄ, а не позначається на
             видалення (позначка виводиться з поля isDeleted у схемі, і в
             періодичного регістру його немає). Той самий значок, що прибирає
             рядок табличної частини. -->
        <button class="btn btn-ghost btn-xs" ?disabled=${disabled}
          title=${locked ? register.lockedReason(row!) : t("common.delete")}
          @click=${(e: Event) => {
        e.stopPropagation();
        void register.remove(row!);
      }}>${icons.clear}</button>
      </td>
    `;
  }

  /**
   * Смуга дій. Та сама, що над табличною частиною: «Додати» з підписом (єдина
   * дія, яку шукають очима, а не після вибору рядка), решта — значками.
   */
  #renderToolbar(): TemplateResult {
    const register = this.register!;
    const busy = register.draft !== null;
    const editable = register.ready && !register.readonly;
    const current = register.current;
    const hasCurrent = Boolean(current) && !busy && editable && !register.locked(current!);

    return html`
      <div class="flex items-center gap-1">
        <button class="btn btn-sm btn-ghost" ?disabled=${!editable || busy}
          @click=${() => register.startAdd()}>
          ${icons.add} ${t("common.create")}
        </button>
        <button class="btn btn-sm btn-ghost" ?disabled=${!hasCurrent} title=${t("common.open")}
          @click=${() => register.startEdit()}>
          ${icons.open}
        </button>
        <button class="btn btn-sm btn-ghost" ?disabled=${!hasCurrent} title=${t("common.delete")}
          @click=${() => void register.remove()}>
          ${icons.clear}
        </button>
        ${this.#renderGoToDate()}
      </div>
    `;
  }

  /**
   * «Перейти до дати» — вікно стає на названу дату замість найсвіжіших рядків.
   *
   * Показується, лише якщо регістр оголосив `dateField`: без нього відбору за
   * датою немає, і поле обіцяло б дію, якої не буде. Очищення (`show-clear`)
   * повертає до найсвіжіших — інакше з дати не було б виходу, крім
   * перевідкриття картки.
   *
   * Стоїть праворуч від кнопок і за роздільником: це не команда над рядком, а
   * те, ЩО саме показано нижче.
   */
  #renderGoToDate(): TemplateResult | typeof nothing {
    const register = this.register!;
    if (!register.config.dateField || !register.ready) return nothing;

    return html`
      <span class="toolbar-sep"></span>
      <ui-date size="sm" show-clear label-position="left"
        label=${t("core.subordinate.goToDate")}
        .value=${register.anchorDate}
        @value-changed=${(e: ValueEvent) => void register.goToDate(e.detail.value)}
      ></ui-date>
    `;
  }

  override render(): TemplateResult {
    const register = this.register;
    if (!register) return html``;

    const columns = register.config.columns;
    const adding = register.draft !== null && register.editingId === null;
    const empty = register.rows.length === 0 && !register.loading && !adding;

    return html`
      <div class="flex flex-col gap-1" @keydown=${this.#onKeyDown}>
        <!-- Підпис НАД смугою дій, а не поруч із нею: смуга — це команди над
             таблицею, і читається вона зліва, з тієї самої точки, що тулбар
             списку й шапка звіту. Підпис поруч зсував би кнопки на довжину
             перекладу, тобто в кожній мові по-своєму. -->
        ${register.config.titleKey
        ? html`<span class="text-sm font-semibold">${t(register.config.titleKey)}</span>`
        : nothing}
        ${this.#renderToolbar()}

        ${register.ready ? nothing : html`
          <span class="text-xs text-muted">${t("core.subordinate.saveOwnerFirst")}</span>`}

        ${register.error ? html`<span class="text-xs text-error">${register.error}</span>` : nothing}

        ${!register.ready ? nothing : html`
          <table class="table table-sm w-full table-tabular">
            <thead>
              <tr>
                ${columns.map((column) => html`
                  <th style=${column.width ? `width:${column.width}` : ""}
                    class=${this.#alignClass(column)}>
                    ${t(column.title)}${column.required
          ? html`<span class="field-required">*</span>`
          : nothing}
                  </th>
                `)}
                <th style="width:4.5rem"></th>
              </tr>
            </thead>
            <tbody>
              ${adding ? this.#renderNewRow() : nothing}
              ${register.rows.map((row, index) => this.#renderRow(row, index))}
              ${empty
        // Відступ на ВНУТРІШНЬОМУ блоці, а не на комірці: `.table-tabular td`
        // у темі безшарова й обнуляє падінг, тож `py-*` на самій комірці
        // нічого не робить (клас у розмітці — намір, а не результат).
        ? html`<tr><td colspan=${columns.length + 1} class="cell-text">
            <div class="py-3 text-center text-muted">${t("common.noData")}</div>
          </td></tr>`
        : nothing}
            </tbody>
          </table>`}

        ${this.#renderPager()}
      </div>
    `;
  }

  /**
   * Пагінація. Розмітка й ключі — ті самі, що в пагінації списку моделі: це та
   * сама дія над тією самою сутністю, і два різні її вигляди в одному
   * застосунку читалися б як два різні механізми.
   *
   * З'являється, тільки коли сторінок справді більше однієї, і водночас каже
   * загальну кількість: мовчки обрізаний перелік не відрізнити від повного.
   *
   * Кнопкам потрібне ім'я: «‹» і «»» читалка озвучує як назви символів.
   */
  #renderPager(): TemplateResult | typeof nothing {
    const register = this.register!;
    if (!register.ready || register.pageCount <= 1) return nothing;

    const pages = register.pageCount;
    const page = register.page;
    const goto = (target: number) => void register.goToPage(target);

    return html`
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-muted">${register.total} ${t("common.records")}</span>
        <div class="join">
          <button class="join-item btn btn-xs" ?disabled=${page <= 1}
            aria-label=${t("common.pageFirst")} title=${t("common.pageFirst")}
            @click=${() => goto(1)}>«</button>
          <button class="join-item btn btn-xs" ?disabled=${page <= 1}
            aria-label=${t("common.pagePrev")} title=${t("common.pagePrev")}
            @click=${() => goto(page - 1)}>‹</button>
          <span class="join-item btn btn-xs btn-disabled pointer-events-none" aria-live="polite"
            aria-label=${t("common.pageOf", { page, total: pages })}>${page} / ${pages}</span>
          <button class="join-item btn btn-xs" ?disabled=${page >= pages}
            aria-label=${t("common.pageNext")} title=${t("common.pageNext")}
            @click=${() => goto(page + 1)}>›</button>
          <button class="join-item btn btn-xs" ?disabled=${page >= pages}
            aria-label=${t("common.pageLast")} title=${t("common.pageLast")}
            @click=${() => goto(pages)}>»</button>
        </div>
      </div>
    `;
  }
}
