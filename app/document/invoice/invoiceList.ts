import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import { dateFormat } from "@client/shared/datetime.ts";
import type { InvoiceRow } from "./invoice.schema.ts";
// Компоненти панелі фільтрів імпортує САМЕ ЕКРАН — основа табличних форм про
// них не знає, інакше <ui-period> і <ui-picker> їхали б у чанк кожного списку
// й кожного діалогу підбору.
import "@client/ui-kit/components/ui-period.ts";
import "@client/ui-kit/components/ui-picker.ts";

export const tagName = "invoice-list";

/** Ссылка у фільтрі: id шле клієнт, `{id, name}` дзеркалить назад `invoice_list`. */
type FilterRef = { id: string; name: string } | null;
type PeriodEvent = CustomEvent<{ dateFrom: string; dateTo: string }>;
type PickEvent = CustomEvent<{ id: string; label: string }>;

@customElement(tagName)
export class InvoiceList extends ModelListBase<InvoiceRow> {
  protected model = "invoice";
  protected editRoute = "document/invoice/edit";
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      `,
    },
  ];

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
    // Представлення контрагента приходить з БД поруч з id — сам лише id пікеру
    // нічого не сказав би, і після перезавантаження поле стояло б порожнім при
    // діючому фільтрі.
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
        fetch="lookup"
        show-clear
        .displayValue=${counterparty?.name ?? ""}
        .selectedId=${this.filterValue<string>("counterpartyId") ?? ""}
        @item-selected=${(e: PickEvent) => this.setFilter("counterpartyId", e.detail.id)}
        @item-cleared=${() => this.setFilter("counterpartyId", "")}
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
