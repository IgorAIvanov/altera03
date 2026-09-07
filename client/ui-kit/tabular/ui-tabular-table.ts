/**
 * Таблична частина документа — ПОДАННЯ таблиці (логіка — tabular-section.ts).
 *
 * Самодостатній компонент: приймає секцію властивістю `.section` і малює
 * table-tabular за її конфігурацією колонок. Можна не використовувати —
 * намалювати таблицю руками, секція про це не дізнається.
 *
 * Клавіатура (операторський ввід, як в 1С):
 *  - Enter — наступна редагована комірка; в останній комірці останнього
 *    рядка — новий рядок;
 *  - ↑/↓ — та сама колонка сусіднього рядка (не перехоплюються в ui-picker:
 *    його випадний список сам живе на клавіатурі);
 *  - Insert — новий рядок; Ctrl+Delete — видалити поточний.
 * Tab лишається нативним і не перехоплюється: у поточному рядку його веде
 * `delegatesFocus` контролів, а в решті рядків точкою обходу стає сама комірка
 * (`tabindex`) — контролів там немає, вони живуть лише в тому записі, який
 * редагують.
 *
 * Слухаємо keydown/focusin на контейнері: обидві події composed, тож
 * долітають із shadow DOM контролів уже ретаргетнуті на їхні host-елементи.
 */
import {
  css,
  type CSSResultGroup,
  html,
  type LitElement,
  nothing,
  type TemplateResult,
} from "lit";
import { customElement, property } from "lit/decorators.js";
import { guard } from "lit/directives/guard.js";
import { SignalWatcher } from "@lit-labs/signals";
import { GlobalStyledLitElement } from "../base/gsle.ts";
import { tw } from "../../shared/styles.ts";
import { t } from "../../locale.ts";
import { dec, type TabularColumn, type TabularSection } from "./tabular-section.ts";
import { formatDate } from "../../shared/datetime.ts";
import "../components/ui-picker.ts";
import "../components/ui-decimal.ts";
import "../components/ui-date.ts";
import "../components/ui-select.ts";
import { icons } from "../icons.ts";

type PickEvent = CustomEvent<{ value: Record<string, unknown> | null }>;
type ValueEvent = CustomEvent<{ value: string }>;

/** Селектор редагованого контрола всередині комірки. */
const CELL_CONTROL = "ui-picker, ui-decimal, ui-date, input, select";

// Рядки читаються з `$root` форми через сигнали — без SignalWatcher
// компонент не дізнавався б про зміни (секція чужого стану не тримає).
const Base: typeof GlobalStyledLitElement = SignalWatcher(GlobalStyledLitElement);

export const tagName = "ui-tabular-table";

@customElement(tagName)
export class UiTabularTable extends Base {
  static override styles: CSSResultGroup = [tw, css`
    tr.current td { background: #eef4fb; }
    /* Невалідна комірка. У комірці рамки немає взагалі (.cell-control її
       знімає — межу малює сама таблиця), тому сигнал інший: заливка й
       внутрішній контур. Правило нижче за "tr.current td" навмисно — у
       виділеному рядку помилка має лишатися видимою.
       Зворотних лапок тут бути не може — це тіло шаблонного рядка css. */
    tr td.cell-invalid {
      background: #fdecec;
      outline: 1px solid var(--color-error);
      outline-offset: -1px;
    }
  `];

  @property({ attribute: false }) section?: TabularSection<Record<string, unknown>>;

  #bound?: TabularSection<Record<string, unknown>>;

  protected override willUpdate() {
    if (this.section !== this.#bound) {
      this.#bound?.unbind(this);
      this.section?.bind(this);
      this.#bound = this.section;
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#bound?.unbind(this);
    this.#bound = undefined;
  }

  protected override updated() {
    const focus = this.section?.pendingFocus;
    if (!focus) return;
    this.section!.pendingFocus = null;
    if (this.#focusCell(focus.row, focus.col)) return;
    // Комірка могла лишитися без контрола (custom-колонка, що його не малює) —
    // тоді беремо наступну придатну в тому ж рядку, а не губимо фокус.
    for (const col of this.#editableCols()) {
      if (col > focus.col && this.#focusCell(focus.row, col)) return;
    }
  }

  // ── Фокус і клавіатура ─────────────────────────────────────────────────────

  #cellAt(row: number, col: number): HTMLTableCellElement | null {
    return this.renderRoot.querySelector(`td[data-row="${row}"][data-col="${col}"]`);
  }

  /**
   * Фокус у контрол комірки. `false` — контрола там немає (custom-комірка, що
   * його не малює), і той, хто кличе, пробує наступну колонку.
   *
   * Контрол може бути ЩОЙНО створеним — рядок став поточним аж цим
   * перемальовком. Тоді елемент у DOM уже є, а вміст його shadow root ще ні:
   * власний рендер компонента — окремий цикл, який ще не відбувся. Фокус у
   * таку мить не робить нічого (`delegatesFocus` не має куди вести), і
   * закінчується це тим, що фокус лишається на комірці, а та вже втратила
   * `tabindex` — тобто зникає зовсім. Тому чекаємо на `updateComplete`
   * контрола; у нативного `<input>` його немає, і фокус ставиться одразу.
   */
  #focusCell(row: number, col: number): boolean {
    const control = this.#cellAt(row, col)?.querySelector<HTMLElement>(CELL_CONTROL);
    if (!control) return false;
    const ready = (control as Partial<LitElement>).updateComplete;
    if (ready) ready.then(() => control.focus());
    else control.focus();
    return true;
  }

  /** Комірка події — з composedPath, бо target ретаргетнутий на host контрола. */
  #eventCell(e: Event): { row: number; col: number } | null {
    for (const el of e.composedPath()) {
      if (el instanceof HTMLTableCellElement && el.dataset.row !== undefined) {
        return { row: Number(el.dataset.row), col: Number(el.dataset.col) };
      }
    }
    return null;
  }

  /**
   * Перейти в комірку — байдуже, чи є там уже контрол.
   *
   * У чужому рядку контрола ще немає: спершу цей рядок має стати поточним, і
   * лише наступний перемальовок його створить. Тому фокус відкладається
   * (`pendingFocus`), а ставить його `updated()`.
   */
  #goToCell(row: number, col: number): boolean {
    const section = this.section!;
    if (row < 0 || row >= section.rows.length) return false;
    if (row === section.editingIndex) return this.#focusCell(row, col);
    section.select(row);
    section.pendingFocus = { row, col };
    return true;
  }

  /**
   * Фокус увійшов у комірку.
   *
   * Друга половина — про статичну комірку: вона сама точка табуляції
   * (`tabindex`), і потрапити в неї можна і Tab-ом, і мишею. Обидва шляхи
   * мають закінчуватися однаково — рядок стає поточним, у ньому з'являються
   * контроли, і фокус іде в той, на який цілилися. Саме тому Tab не
   * перехоплюється взагалі: порядок обходу лишається нативним, як і доти, і
   * кнопки всередині `<ui-picker>` з нього не випадають.
   */
  #onFocusIn = (e: Event) => {
    const cell = this.#eventCell(e);
    if (!cell) return;
    const section = this.section;
    if (!section) return;
    section.select(cell.row);
    if ((e.target as HTMLElement)?.tagName === "TD") {
      section.pendingFocus = { row: cell.row, col: cell.col };
      this.requestUpdate();
    }
  };

  #editableCols(): number[] {
    const section = this.section!;
    const cols: number[] = [];
    section.visibleColumns().forEach((col, i) => {
      if (col.kind !== "computed") cols.push(i);
    });
    return cols;
  }

  #onKeyDown = (e: KeyboardEvent) => {
    const section = this.section;
    if (!section) return;

    // У режимі перегляду клавіатура секції мовчить цілком: рядки не додаються,
    // не видаляються, і Enter не створює новий у кінці таблиці.
    if (section.readonly) return;

    if (e.key === "Insert") {
      e.preventDefault();
      section.addLine();
      return;
    }
    if (e.key === "Delete" && e.ctrlKey) {
      e.preventDefault();
      section.removeLine();
      return;
    }

    const cell = this.#eventCell(e);
    if (!cell) return;
    const inPicker = e.composedPath().some((el) =>
      el instanceof HTMLElement && el.tagName === "UI-PICKER"
    );

    // Ctrl+Enter — не наш Enter: це кнопка за замовчуванням форми, і секція
    // мусить його пропустити. Без цієї умови таблиця з'їдала б його разом із
    // preventDefault, і в документі з табличною частиною — тобто саме там, де
    // сполучення й потрібне, — воно не працювало б узагалі.
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // Enter веде вправо (порядок — оголошення колонок, підрядкові після
      // сіткових); ui-decimal свій Enter (канонізація) не гасить — подія
      // долітає сюди вже після його обробки. Спроби по черзі: custom-комірка
      // може не мати контрола (тире валюти) — фокус не вдався, йдемо далі.
      const editable = this.#editableCols();
      e.preventDefault();
      for (const c of editable) {
        if (c > cell.col && this.#focusCell(cell.row, c)) return;
      }
      // У наступному рядку контролів ще немає — туди веде #goToCell, а перебір
      // колонок, якщо перша не візьме фокус, доробить `updated()`.
      if (cell.row + 1 < section.rows.length) {
        this.#goToCell(cell.row + 1, editable[0] ?? 0);
        return;
      }
      section.addLine();
      return;
    }

    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !inPicker) {
      const target = cell.row + (e.key === "ArrowUp" ? -1 : 1);
      if (target < 0 || target >= section.rows.length) return;
      e.preventDefault();
      this.#goToCell(target, cell.col);
    }
  };

  // ── Комірки ────────────────────────────────────────────────────────────────

  /**
   * Чи малює ця комірка значення текстом замість контрола.
   *
   * Статичними стають лише види на КАСТОМНИХ ЕЛЕМЕНТАХ (`picker`, `decimal`,
   * `date`) — кожен зі своїм shadow root, і саме їх у великому документі
   * тисячі. Нативні `text` і `checkbox` коштують один вузол, тож лишаються
   * живими завжди: інакше довелося б підробляти вигляд галочки й поля вводу, а
   * виграти не було б чого. `custom` стає статичною, лише якщо колонка сама
   * сказала як (`display`).
   */
  #isStatic(col: TabularColumn<Record<string, unknown>>, index: number): boolean {
    const section = this.section!;
    if (!section.readonly && index === section.editingIndex) return false;
    if (col.display) return true;
    return col.kind === "picker" || col.kind === "decimal" || col.kind === "date";
  }

  /**
   * Значення текстом — те, що видно в рядку, який зараз не редагують.
   *
   * Формат мусить збігатися з тим, що показує контрол, інакше значення
   * «стрибне» при вході в рядок. Тому дата йде через той самий `formatDate`,
   * що й `<ui-date>`, а десяткове — через `toFixed(precision)`; порожнє
   * лишається порожнім, як і в `<ui-decimal>` без `empty-as-zero`.
   */
  #display(
    col: TabularColumn<Record<string, unknown>>,
    line: Record<string, unknown>,
    index: number,
  ): TemplateResult | string {
    if (col.display) return col.display(line, index);
    const key = col.key ?? "";
    switch (col.kind) {
      case "decimal": {
        const raw = line[key];
        return raw == null || raw === "" ? "" : dec(raw).toFixed(col.precision ?? 2);
      }
      case "date":
        return formatDate(String(line[key] ?? ""));
      case "picker": {
        const refKey = col.refKey ?? (key.endsWith("Id") ? key.slice(0, -2) : key);
        const ref = line[refKey] as Record<string, unknown> | null;
        return String(ref?.[col.displayField ?? "name"] ?? "");
      }
      default:
        return String(line[key] ?? "");
    }
  }

  #cellContent(
    col: TabularColumn<Record<string, unknown>>,
    line: Record<string, unknown>,
    index: number,
  ): TemplateResult | string {
    const section = this.section!;
    const key = col.key ?? "";
    if (this.#isStatic(col, index)) return this.#display(col, line, index);
    switch (col.kind) {
      case "custom":
        return col.render?.(line, index) ?? "";
      case "computed":
        return html`${col.value?.(line) ?? ""}`;
      case "text":
        return html`<input class="cell-control" ?disabled=${section.readonly}
          .value=${String(line[key] ?? "")}
          @input=${(e: Event) => section.patch(index, { [key]: (e.target as HTMLInputElement).value })} />`;
      case "checkbox":
        return html`<input type="checkbox" ?disabled=${section.readonly} .checked=${line[key] === true}
          @change=${(e: Event) => section.patch(index, { [key]: (e.target as HTMLInputElement).checked })} />`;
      case "decimal":
        return html`<ui-decimal cell ?disabled=${section.readonly}
          .precision=${col.precision ?? 2}
          .value=${String(line[key] ?? "")}
          @value-input=${(e: ValueEvent) => section.patch(index, { [key]: e.detail.value })}
          @value-changed=${(e: ValueEvent) => section.patch(index, { [key]: e.detail.value })}
        ></ui-decimal>`;
      case "date":
        return html`<ui-date cell ?disabled=${section.readonly}
          .value=${String(line[key] ?? "")}
          @value-changed=${(e: ValueEvent) => section.patch(index, { [key]: e.detail.value })}
        ></ui-date>`;
      case "picker": {
        const refKey = col.refKey ?? (key.endsWith("Id") ? key.slice(0, -2) : key);
        const ref = line[refKey] as { id?: string; name?: string } | null;
        const display = col.displayField ?? "name";
        // Значення комірки — сам об'єкт ссылки; id рядок тримає окремо, бо
        // саме його чекає `save` табличної частини. Пишуться обидва з ОДНІЄЇ
        // події, тож розійтися їм нема як.
        return html`<ui-picker cell ?disabled=${section.readonly}
          url=${col.url ?? ""}
          display-field=${display}
          hint-field=${col.hintField ?? ""}
          ?show-clear=${col.showClear ?? false}
          .value=${ref ?? null}
          @value-changed=${(e: PickEvent) =>
            section.patch(index, {
              [key]: String(e.detail.value?.id ?? ""),
              [refKey]: e.detail.value,
            })}
        ></ui-picker>`;
      }
    }
  }

  #cellClass(col: TabularColumn<Record<string, unknown>>, index: number): string {
    const align = col.align ?? (col.kind === "decimal" || col.kind === "computed" ? "right" : "left");
    const parts: string[] = [];
    if (col.kind === "computed") parts.push("cell-text", "tabular-nums");
    // `cell-static` — не те саме, що `cell-text`: він тримає ще й висоту рядка.
    // Без неї рядок без контролів був би нижчим за той, у якому редагують, і
    // таблиця смикалася б при кожному переході по рядках.
    if (this.#isStatic(col, index)) {
      parts.push("cell-static");
      if (col.kind === "decimal") parts.push("tabular-nums");
    }
    if (col.kind === "checkbox") parts.push("text-center");
    if (align === "right") parts.push("text-right");
    if (align === "center" && col.kind !== "checkbox") parts.push("text-center");
    if (this.section?.cellError(index, col)) parts.push("cell-invalid");
    return parts.join(" ");
  }

  /**
   * Статична комірка — сама точка табуляції.
   *
   * Це і є відповідь на «а як тепер ходити по таблиці клавішею Tab»: контролів
   * у чужих рядках немає, тож без цього Tab вивалювався б із таблиці на кінці
   * поточного рядка. Комірка стає точкою обходу замість контрола, який у ній
   * з'явиться, — порядок лишається нативним, перехоплювати Tab не треба, і
   * кнопки всередині `<ui-picker>` із обходу не зникають.
   *
   * У режимі перегляду — жодного tabindex: правити нічого, а тисяча зайвих
   * зупинок перетворила б таблицю на пастку для клавіатури.
   */
  #cellTabIndex(col: TabularColumn<Record<string, unknown>>, index: number) {
    const section = this.section!;
    return !section.readonly && this.#isStatic(col, index) && col.kind !== "computed" ? "0" : nothing;
  }

  /**
   * Текст помилки їде в `title` комірки, а не окремим підписом: у щільній
   * таблиці зайвий рядок під коміркою поламав би сітку, а сама підсвітка
   * каже, ЩО не так, лише наполовину. Повний текст першої помилки форма
   * додатково показує банером — див. `TabularSection.firstErrorText()`.
   */
  #cellTitle(col: TabularColumn<Record<string, unknown>>, index: number) {
    return this.section?.cellError(index, col) || nothing;
  }

  // ── Рендер ─────────────────────────────────────────────────────────────────

  /** Колонки сітки (row 1) — вони визначають ширини всієї таблиці. */
  #grid(columns: Array<TabularColumn<Record<string, unknown>>>) {
    return columns.filter((c) => (c.row ?? 1) <= 1);
  }

  /** Рівні підрядків (row ≥ 2), за зростанням. */
  #subLevels(columns: Array<TabularColumn<Record<string, unknown>>>): number[] {
    return [...new Set(columns.map((c) => c.row ?? 1).filter((r) => r >= 2))].sort((a, b) => a - b);
  }

  override render(): TemplateResult {
    const section = this.section;
    if (!section) return html``;

    const columns = section.visibleColumns();
    const grid = this.#grid(columns);
    const levels = this.#subLevels(columns);
    const totals = grid.some((c) => c.total);
    // Колонок сітки в рядку: [#] + сітка + [кошик]
    const colCount = grid.length + (section.showLineNo ? 1 : 0) + (section.rowDelete ? 1 : 0);
    // Склад видимих колонок — залежність кешу записів (див. #renderRecord).
    // Умовна колонка (валюта в проводках) з'являється й зникає, і рядок мусить
    // це помітити. Рахується раз на таблицю, а не на рядок.
    const colsKey = columns.map((c) => c.key ?? c.title ?? "").join("|");

    return html`
      <table class="table table-sm w-full table-tabular"
        @keydown=${this.#onKeyDown} @focusin=${this.#onFocusIn}>
        ${this.#renderHead(columns, section)}
        <tbody>
          ${section.rows.map((line, i) =>
            this.#renderRecord(line, i, columns, grid, levels, colsKey))}
          ${section.rows.length === 0
            ? html`<tr><td colspan=${colCount} class="text-center text-muted py-4">${t("common.noData")}</td></tr>`
            : nothing}
        </tbody>
        ${totals ? this.#renderTotals(grid, section) : nothing}
      </table>
    `;
  }

  /**
   * Запис через кеш подання.
   *
   * `guard` малює тіло, лише коли змінилася хоч одна залежність, інакше лишає
   * на місці вже намальоване. Це відповідь на «правка однієї комірки
   * перемальовує всю табличну частину»: у документі на тисячу рядків правка
   * коштувала 78 мс, з кешем — 25 мс (заміряно, `scripts/bench/tabular`). До
   * сотні рядків різниці не видно; помітно там, де таблиця й так велика.
   *
   * Тримається все на тому, що рядок ЗАМІНЮЄТЬСЯ, а не міняється на місці:
   * `patch()` кладе на його місце новий об'єкт, і саме identity відрізняє
   * змінений рядок від решти. Мутувати рядок у `$root` напряму після цього не
   * можна — таблиця зміни не побачить. Секція сама так ніколи й не робила
   * (`patch`, `addLine`, `copyLine`, `removeLine`, `move` — усі immutable).
   *
   * Що НЕ видно за самим рядком — помилки перевірки й стан, який custom-комірка
   * читає з форми, — приходить окремою залежністю `section.epoch`.
   *
   * Помилка тут іде в безпечний бік: якщо identity рядків колись перестане
   * бути стабільною, кеш просто перестане економити, а не почне показувати
   * застаріле.
   */
  #renderRecord(
    line: Record<string, unknown>,
    i: number,
    columns: Array<TabularColumn<Record<string, unknown>>>,
    grid: Array<TabularColumn<Record<string, unknown>>>,
    levels: number[],
    colsKey: string,
  ): unknown {
    const section = this.section!;
    return guard(
      [
        line, //                       сам рядок: patch замінює об'єкт
        i, //                          номер: вставка й видалення зсувають хвіст
        i === section.currentIndex, // підсвітка поточного рядка
        i === section.editingIndex, // тут живуть контроли (без вибору — перший)
        section.readonly, //           режим перегляду (право, проведення)
        section.epoch, //              помилки й стан поза рядком
        colsKey, //                    склад видимих колонок
      ],
      () => this.#record(line, i, columns, grid, levels),
    );
  }

  /**
   * Один запис = 1 + N рядків `<tr>` (N — рівні підрядків). Ячейки підрядка
   * лягають під сітку зліва направо, ширина — `span` у колонках сітки;
   * залишок добивається порожньою ячейкою. № і кошик — rowspan на весь запис.
   */
  #record(
    line: Record<string, unknown>,
    i: number,
    columns: Array<TabularColumn<Record<string, unknown>>>,
    grid: Array<TabularColumn<Record<string, unknown>>>,
    levels: number[],
  ): TemplateResult {
    const section = this.section!;
    const recordSpan = 1 + levels.length;
    const cur = i === section.currentIndex ? "current" : "";
    return html`
      <tr class=${cur} @click=${() => section.select(i)}>
        ${section.showLineNo
          ? html`<td class="cell-text" rowspan=${recordSpan}>
              ${section.lineNoKey ? String(line[section.lineNoKey] ?? i + 1) : i + 1}
            </td>`
          : nothing}
        ${grid.map((col) => html`
          <td data-row=${i} data-col=${columns.indexOf(col)} class=${this.#cellClass(col, i)}
            tabindex=${this.#cellTabIndex(col, i)} title=${this.#cellTitle(col, i)}>
            ${this.#cellContent(col, line, i)}
          </td>
        `)}
        ${section.rowDelete
          ? html`
            <td class="text-center" rowspan=${recordSpan}>
              <!-- Хрестик і колір шрифту — той самий значок, що в панелі дій
                   секції: дія прибирає рядок, а не позначає запис на видалення. -->
              <button class="btn btn-ghost btn-xs" title=${t("tabular.delete")}
                ?disabled=${section.readonly}
                @click=${(e: Event) => { e.stopPropagation(); section.removeLine(i); }}>
                ${icons.clear}
              </button>
            </td>`
          : nothing}
      </tr>
      ${levels.map((level) => {
        const subs = columns.filter((c) => (c.row ?? 1) === level);
        const used = subs.reduce((s, c) => s + (c.span ?? 1), 0);
        const pad = grid.length - used;
        return html`
          <tr class=${cur} @click=${() => section.select(i)}>
            ${subs.map((col) => html`
              <td colspan=${col.span ?? 1} data-row=${i} data-col=${columns.indexOf(col)}
                class=${this.#cellClass(col, i)} tabindex=${this.#cellTabIndex(col, i)}
                title=${this.#cellTitle(col, i)}>
                ${this.#cellContent(col, line, i)}
              </td>
            `)}
            ${pad > 0 ? html`<td colspan=${pad}></td>` : nothing}
          </tr>
        `;
      })}
    `;
  }

  #leafTh(col: TabularColumn<Record<string, unknown>>, rowspan = 1): TemplateResult {
    const right = col.align === "right" || col.kind === "decimal" || col.kind === "computed";
    return html`
      <th rowspan=${rowspan} style=${col.width ? `width:${col.width}` : ""}
        class=${right ? "text-right" : ""}>
        ${col.title ? t(col.title) : ""}
      </th>
    `;
  }

  /**
   * Шапка. Однорядна, доки колонки сітки не оголосили `group`; з групами —
   * два ряди: суміжні колонки однієї групи накриті спільною ячейкою
   * (colspan), негруповані розтягнуті на обидва ряди (rowspan). Підрядки
   * (row ≥ 2) додають свій ряд заголовків, лише якщо мають хоч один title.
   */
  #renderHead(
    columns: Array<TabularColumn<Record<string, unknown>>>,
    section: TabularSection<Record<string, unknown>>,
  ): TemplateResult {
    const grid = this.#grid(columns);
    const hasGroups = grid.some((c) => c.group);
    const subHeaderLevels = this.#subLevels(columns).filter((level) =>
      columns.some((c) => (c.row ?? 1) === level && c.title)
    );
    const headRows = (hasGroups ? 1 : 0) + 1 + subHeaderLevels.length;

    const gridRow: TemplateResult[] = [];
    const groupRow: TemplateResult[] = [];
    if (hasGroups) {
      let i = 0;
      while (i < grid.length) {
        const col = grid[i];
        if (col.group) {
          let span = 1;
          while (i + span < grid.length && grid[i + span].group === col.group) span++;
          groupRow.push(html`<th colspan=${span} class="text-center">${t(col.group)}</th>`);
          for (let k = i; k < i + span; k++) gridRow.push(this.#leafTh(grid[k]));
          i += span;
        } else {
          groupRow.push(this.#leafTh(col, 2));
          i++;
        }
      }
    }

    const subRows = subHeaderLevels.map((level) => {
      const subs = columns.filter((c) => (c.row ?? 1) === level);
      const used = subs.reduce((s, c) => s + (c.span ?? 1), 0);
      const pad = grid.length - used;
      return html`
        <tr>
          ${subs.map((col) => html`
            <th colspan=${col.span ?? 1}>${col.title ? t(col.title) : ""}</th>
          `)}
          ${pad > 0 ? html`<th colspan=${pad}></th>` : nothing}
        </tr>
      `;
    });

    return html`
      <thead>
        <tr>
          ${section.showLineNo ? html`<th class="w-10" rowspan=${headRows}>#</th>` : nothing}
          ${hasGroups ? groupRow : grid.map((col) => this.#leafTh(col))}
          ${section.rowDelete ? html`<th class="w-10" rowspan=${headRows}></th>` : nothing}
        </tr>
        ${hasGroups ? html`<tr>${gridRow}</tr>` : nothing}
        ${subRows}
      </thead>
    `;
  }

  /**
   * Підвал: підпис «Разом» займає все до першої total-колонки, під кожною
   * total-колонкою — її сума, решта — порожні th.
   */
  #renderTotals(
    columns: Array<TabularColumn<Record<string, unknown>>>,
    section: TabularSection<Record<string, unknown>>,
  ): TemplateResult {
    const firstTotal = columns.findIndex((c) => c.total);
    const labelSpan = firstTotal + (section.showLineNo ? 1 : 0);
    return html`
      <tfoot>
        <tr>
          ${labelSpan > 0
            ? html`<th colspan=${labelSpan} class="text-right">${t("tabular.total")}</th>`
            : nothing}
          ${columns.slice(firstTotal).map((col) => html`
            <th class="text-right tabular-nums">
              ${col.total ? section.columnTotal(col) : ""}
            </th>
          `)}
          ${section.rowDelete ? html`<th></th>` : nothing}
        </tr>
      </tfoot>
    `;
  }
}
