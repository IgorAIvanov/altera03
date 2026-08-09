import { html, svg, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import { bus } from "@client/bus/bus.ts";
import { icons } from "@client/ui-kit/icons.ts";
import { dateFormat } from "@client/shared/datetime.ts";
import { viewRoute } from "@shared/view-route.ts";
import { generatedModelRegistry } from "../../_generated/model-registry.generated.ts";
import type { AuditLogRow } from "./audit_log.schema.ts";
// Компоненти панелі фільтрів імпортує САМЕ ЕКРАН — основа табличних форм про
// них не знає, інакше вони їхали б у чанк кожного списку й кожного пікера.
import "@client/ui-kit/components/ui-period.ts";
import "@client/ui-kit/components/ui-picker.ts";
import "@client/ui-kit/components/ui-select.ts";

export const tagName = "audit-log-list";

type PeriodEvent = CustomEvent<{ dateFrom: string; dateTo: string }>;
type PickEvent = CustomEvent<{ id: string; label: string }>;
type SelectEvent = CustomEvent<{ value: string }>;
/** Значення ссылочного фільтра: id вибирає записи, `name` показує пікер. */
type FilterRef = { id: string; name: string };

/**
 * Перелік моделей для фільтра — з того самого реєстру, що читає рантайм: у
 * журналі лежить ім'я з `manifest.json`, і список, набраний руками, розійшовся
 * б із ним на першій новій моделі.
 */
const MODEL_KEYS = Object.keys(generatedModelRegistry);

/**
 * Результат команди — гліф, а не бейдж із написом.
 *
 * Слово в кольоровій плашці в кожному рядку перетворює колонку на смугу
 * заливки й перетягує на себе увагу там, де дивитися нема на що: успіх — це
 * норма, і в журналі його переважна більшість. Тому успіх — самий лише тонкий
 * птах, а помилка взята в коло: шукають у журналі саме її, і вона мусить
 * вистрілювати з колонки.
 *
 * Розмір задають АТРИБУТИ: гліф стоїть у комірці таблиці, а не в кнопці чи
 * полі, тобто правила теми (`.btn > svg`) до нього не дотягуються.
 */
const resultGlyph = (success: boolean): TemplateResult => html`
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"
    stroke=${success ? "var(--color-success, #28794d)" : "var(--color-error, #dc2626)"}
    stroke-width=${success ? 2.6 : 2}>
    ${success
      ? svg`<polyline points="20 6 9 17 4 12"/>`
      : svg`<circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>`}
  </svg>
`;

@customElement(tagName)
export class AuditLogList extends ModelListBase<AuditLogRow> {
  protected model = "audit_log";
  protected editRoute = null;
  protected override readonly = true;
  protected override defaultSortBy = "occurredAt";
  protected override defaultSortDir: "desc" = "desc";

  protected columns: ListColumn<AuditLogRow>[] = [
    { key: "occurredAt", title: "auditLog.occurredAt", width: "10rem", format: dateFormat.dateTime, sortable: true },
    { key: "user", title: "auditLog.user", width: "12rem", sortable: true, overflow: "ellipsis" },
    {
      key: "model", title: "auditLog.model", width: "11rem", sortable: true, overflow: "ellipsis",
      // Ім'я моделі — технічне (`chart_of_account`); у журналі його читає
      // людина, тож показуємо назву, а ключ лишаємо в підказці.
      render: (row) => this.modelTitle(row.model),
      tooltip: (row) => row.model,
      exportText: (row) => this.modelTitle(row.model),
    },
    {
      key: "command", title: "auditLog.command", width: "11rem", sortable: true, overflow: "ellipsis",
      render: (row) => this.commandTitle(row.command),
      tooltip: (row) => row.command,
      exportText: (row) => this.commandTitle(row.command),
    },
    {
      key: "recordId", title: "auditLog.recordId", width: "7rem", sortable: true, align: "right",
      // Головне, заради чого в журнал і йдуть: подивитися на сам запис. Номер
      // стає посиланням лише там, де є куди вести, — модель без форми
      // редагування (звіт, службова) лишається звичайним текстом.
      render: (row) => this.renderRecordLink(row),
      exportText: (row) => row.recordId ?? "",
    },
    {
      // Кнопка-олівець наприкінці рядка — та сама, що в списку рахунків.
      // Посилання на номері самого по собі мало: журнал `readonly`, тобто ні
      // подвійного кліку, ні тулбарної «Відкрити» тут немає, і єдиний вхід у
      // запис має бути видно, не наводячи на нього мишу.
      key: "_actions", title: "", width: "3rem", align: "center",
      render: (row) => this.recordRoute(row)
        ? html`
          <button class="btn btn-ghost btn-xs px-1"
            title=${this.t("auditLog.openRecord")} aria-label=${this.t("auditLog.openRecord")}
            @click=${stopRow(() => this.openRecord(row))}>
            ${icons.open}
          </button>`
        : "",
    },
    {
      key: "isSuccess", title: "auditLog.result", width: "6rem", sortable: true, align: "center",
      // `role="img"` обов'язковий: сам лише `aria-label` на `<span>` читалка не
      // озвучує — у голого span немає ролі, до якої ім'я могло б прив'язатися.
      render: (row) => html`
        <span role="img"
          title=${this.t(row.isSuccess ? "auditLog.success" : "auditLog.failure")}
          aria-label=${this.t(row.isSuccess ? "auditLog.success" : "auditLog.failure")}>
          ${resultGlyph(row.isSuccess)}
        </span>`,
      exportText: (row) => this.t(row.isSuccess ? "auditLog.success" : "auditLog.failure"),
    },
  ];

  // ── Перехід до запису ─────────────────────────────────────────────────────

  /** Куди веде запис журналу. `null` — форми немає, посилання не малюємо. */
  private recordRoute(row: AuditLogRow): string | null {
    return row.recordId ? viewRoute(row.model) : null;
  }

  private openRecord(row: AuditLogRow) {
    const route = this.recordRoute(row);
    if (route) bus.emit({ type: "tab.open", route, id: row.recordId });
  }

  /**
   * Номер запису посиланням.
   *
   * `link link-primary`, а не `link-hover`: підкреслення на наведення означає,
   * що в спокої посилання не відрізнити від тексту — а миша сама на нього не
   * поїде, бо приводу немає. Спокуса «щоб не строкатіло» тут коштує рівно того,
   * заради чого колонка й існує.
   */
  private renderRecordLink(row: AuditLogRow): TemplateResult | string {
    if (!row.recordId) return "";
    if (!this.recordRoute(row)) return row.recordId;
    return html`
      <button class="link link-primary cursor-pointer"
        title=${this.t("auditLog.openRecord")}
        @click=${stopRow(() => this.openRecord(row))}>${row.recordId}</button>
    `;
  }

  // ── Людські назви ─────────────────────────────────────────────────────────

  /**
   * `t()` повертає сам ключ, коли перекладу немає, — і саме це тут ознака того,
   * що моделі в локалях немає (службові моделі ядра її не мають). Тоді чесніше
   * показати технічне ім'я, ніж «audit_log.titleOne».
   */
  private modelTitle(key: string): string {
    for (const suffix of ["titleOne", "titleMany"]) {
      const value = this.t(`${key}.${suffix}`);
      if (value !== `${key}.${suffix}`) return value;
    }
    return key;
  }

  /** Стандартні команди перекладені; нестандартна лишається як є. */
  private commandTitle(command: string): string {
    const value = this.t(`auditLog.cmd.${command}`);
    return value === `auditLog.cmd.${command}` ? command : value;
  }

  // ── Фільтри ───────────────────────────────────────────────────────────────

  protected override renderFilters() {
    // Ссылочний фільтр — ОДИН ключ з об'єктом: id відбирає, `name` малює пікер.
    // Підпис приходить із БД під тим самим ключем.
    const user = this.filterValue<FilterRef>("user");
    const models = MODEL_KEYS
      .map((key) => ({ key, title: this.modelTitle(key) }))
      .sort((a, b) => a.title.localeCompare(b.title));

    return html`
      <ui-period
        .label=${this.t("period.label")}
        .dateFrom=${this.filterValue<string>("dateFrom") ?? ""}
        .dateTo=${this.filterValue<string>("dateTo") ?? ""}
        @period-changed=${(e: PeriodEvent) =>
          // Обидві межі — ОДНИМ записом: два послідовні setFilter дали б два
          // запити, і другий скасував би перший.
          this.setFilters({ dateFrom: e.detail.dateFrom, dateTo: e.detail.dateTo })}
      ></ui-period>

      <ui-picker
        .label=${this.t("auditLog.user")}
        url="admin/user"
        fetch="lookup"
        show-clear
        .displayValue=${user?.name ?? ""}
        .selectedId=${user?.id ?? ""}
        @item-selected=${(e: PickEvent) =>
          this.setFilter("user", { id: e.detail.id, name: e.detail.label })}
        @item-cleared=${() => this.setFilter("user", null)}
      ></ui-picker>

      <ui-select
        .label=${this.t("auditLog.model")}
        size="sm"
        .placeholder=${this.t("auditLog.anyModel")}
        .options=${models.map((m) => ({ value: m.key, label: m.title }))}
        .value=${this.filterValue<string>("model") ?? ""}
        @value-changed=${(e: SelectEvent) => this.setFilter("model", e.detail.value)}
      ></ui-select>

      <ui-select
        .label=${this.t("auditLog.result")}
        size="sm"
        .placeholder=${this.t("auditLog.anyResult")}
        .options=${[
          { value: "success", label: this.t("auditLog.success") },
          { value: "failure", label: this.t("auditLog.failure") },
        ]}
        .value=${this.filterValue<string>("result") ?? ""}
        @value-changed=${(e: SelectEvent) => this.setFilter("result", e.detail.value)}
      ></ui-select>

      <label class="flex flex-col gap-1">
        <span class="label text-sm leading-none">${this.t("auditLog.command")}</span>
        <input type="text" class="input input-sm"
          .value=${this.filterValue<string>("command") ?? ""}
          @input=${this.bindFilter("command", { debounce: true })} />
      </label>

      <label class="flex flex-col gap-1">
        <span class="label text-sm leading-none">${this.t("auditLog.recordId")}</span>
        <input type="text" inputmode="numeric" class="input input-sm"
          .value=${this.filterValue<string>("recordId") ?? ""}
          @input=${this.bindFilter("recordId", { debounce: true })} />
      </label>
    `;
  }
}
