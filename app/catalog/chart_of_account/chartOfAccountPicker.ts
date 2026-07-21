import { customElement } from "lit/decorators.js";
import { ModelPickerBase } from "@client/ui-kit/base/model-picker-base.ts";
import type { ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { ChartOfAccountLookupRow } from "./chart_of_account.schema.ts";

export const tagName = "chart-of-account-picker";

/**
 * Пікер рахунку. Групи в lookup не потрапляють — їх відсікає
 * app.chart_of_account_lookup (db/chart_of_account.custom.sql),
 * бо проводка на групу неможлива.
 */
@customElement(tagName)
export class ChartOfAccountPicker extends ModelPickerBase<ChartOfAccountLookupRow> {
  protected model = "chart_of_account";
  protected override defaultSortBy = "code";

  /**
   * Рахунок ідентифікується КОДОМ, а не назвою: саме код лягає в проводку
   * (`varchar(10)`). Без цього діалог підбору повертав би найменування рахунку
   * і запис проводки падав би на довжині колонки.
   */
  protected override labelField = "code";

  protected columns: ListColumn<ChartOfAccountLookupRow>[] = [
    { key: "code", title: "chartOfAccount.code", width: "6rem", sortable: true },
    { key: "name", title: "common.name", sortable: true },
  ];
}
