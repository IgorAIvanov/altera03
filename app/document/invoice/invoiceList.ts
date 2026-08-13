import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import { dateFormat } from "@client/shared/datetime.ts";
import { movementsButton } from "@shared/document-movements.ts";
import type { InvoiceRow } from "./invoice.schema.ts";
// Компоненти панелі фільтрів імпортує САМЕ ЕКРАН — основа табличних форм про
// них не знає, інакше <ui-period> і <ui-picker> їхали б у чанк кожного списку
// й кожного діалогу підбору.
import "@client/ui-kit/components/ui-period.ts";
import "@client/ui-kit/components/ui-picker.ts";
import type { PickerChangeEvent } from "@client/ui-kit/components/ui-picker.ts";
import { icons } from "@client/ui-kit/icons.ts";

export const tagName = "invoice-list";

/** Значення ссылочного фільтра: id вибирає записи, `name` показує пікер. */
type FilterRef = { id: string; name: string };
type PeriodEvent = CustomEvent<{ dateFrom: string; dateTo: string }>;

@customElement(tagName)
export class InvoiceList extends ModelListBase<InvoiceRow> {
  protected model = "invoice";
  protected editRoute = "document/invoice/edit";

  /**
   * Журнал документів — відбір за організацією. Умовчання (поточна
   * організація), можливість його зняти й мовчання при одній організації
   * дає основа; тут лишається сам факт, що документ організації належить.
   */
  protected override organizationFilter = true;
  protected override defaultSortBy = "number";

  protected columns: ListColumn<InvoiceRow>[] = [
    { key: "number", title: "invoice.number", width: "10rem", sortable: true },
    {
      key: "docDate", title: "invoice.date", width: "9rem", muted: true, sortable: true,
      format: dateFormat.dateTime,
    },
    {
      key: "counterparty", title: "invoice.counterparty", sortable: true,
      overflow: "ellipsis",
      render: (r) => r.counterparty?.name ?? "",
      tooltip: (r) => r.counterparty?.name ?? "",
      // Колонка — вкладений об'єкт; без цього у файл пішло б порожньо.
      exportText: (r) => r.counterparty?.name ?? "",
    },
    { key: "total", title: "invoice.total", width: "8rem", align: "right" },
    {
      key: "_actions", title: "", width: "3rem", align: "center",
      render: (row) => html`
        <button class="btn btn-ghost btn-xs px-1" title=${this.t("common.open")}
          @click=${stopRow(() => this.openEdit(row.id))}>
          ${icons.open}
        </button>
      `,
    },
  ];

  /** Рух документа — над виділеним рядком, як «Відкрити» й «Видалити». */
  protected override renderToolbarExtra() {
    const row = this.selectedRow;
    return movementsButton(row?.id, row?.isPosted);
  }

  /**
   * Панель фільтрів. Розмітка тут повністю своя — основа дає лише місце
   * (панель), стан (`$root.$filters`) і зв'язування (`setFilter`/`setFilters`).
   *
   * Ключі мусять збігатися з тим, що розбирає `app.invoice_list`; його генерує
   * `sql:gen` з анотацій `x-filter` у схемі:
   *   · `dateFrom`/`dateTo`   — `docDate` у DocumentHeaderSchema, op: "range";
   *   · `isPosted`            — там само, рівність;
   *   · `counterpartyId`      — `invoice.schema.ts`, ссылка.
   */
  protected override renderFilters() {
    // Ссылочний фільтр — ОДИН ключ з об'єктом: id вибирає записи, `name` малює
    // пікер. Підпис приходить із БД під тим самим ключем, тож після
    // перезавантаження поле не стоїть порожнім при діючому фільтрі.
    const counterparty = this.filterValue<FilterRef>("counterparty");

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
        .label=${this.t("invoice.counterparty")}
        url="catalog/counterparty"
        show-clear
        .value=${counterparty ?? null}
        @value-changed=${(e: PickerChangeEvent) => this.setFilter("counterparty", e.detail.value)}
      ></ui-picker>

      <label class="flex items-center gap-2">
        <input type="checkbox" class="checkbox checkbox-xs"
          .checked=${this.filterValue("isPosted") === true}
          @change=${this.bindFilter("isPosted")} />
        <span>${this.t("document.posted")}</span>
      </label>
    `;
  }
}
