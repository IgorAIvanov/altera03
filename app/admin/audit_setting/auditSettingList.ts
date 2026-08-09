import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import { icons } from "@client/ui-kit/icons.ts";
import { modelKeysMatching, modelTitle } from "@shared/model-title.ts";
import type { AuditSettingRow } from "./audit_setting.schema.ts";

export const tagName = "audit-setting-list";

@customElement(tagName)
export class AuditSettingList extends ModelListBase<AuditSettingRow> {
  protected model = "audit_setting";
  protected editRoute = "admin/audit_setting/edit";
  protected override defaultSortBy = "id";

  protected columns: ListColumn<AuditSettingRow>[] = [
    {
      key: "id", title: "auditSetting.model", sortable: true, overflow: "ellipsis",
      // Назва — для людини, технічний ключ — у підказці: саме він лежить у
      // журналі, тож знайти рядок за ним теж має бути можливо.
      render: (row) => modelTitle(row.id),
      tooltip: (row) => row.id,
      exportText: (row) => modelTitle(row.id),
    },
    {
      key: "level", title: "auditSetting.level", width: "14rem", sortable: true,
      render: (row) => this.t(`auditSetting.level_${row.level}`),
      exportText: (row) => this.t(`auditSetting.level_${row.level}`),
    },
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

  /**
   * Пошук по тому, що видно, а не по тому, що лежить у базі.
   *
   * У колонці стоїть НАЗВА моделі («Банки»), а в таблиці — ключ (`bank`), і
   * перекласти його вміє лише клієнт. Тому збіг за назвою рахуємо тут і
   * передаємо готові ключі; пошук по самому ключу SQL лишає — техніку теж
   * зручно шукати по імені з журналу.
   */
  protected override extraPayload() {
    return { modelKeys: modelKeysMatching(this.search) };
  }

  /**
   * Перелік моделей сіє деплой: створювати чи видаляти рядки з екрана нічого —
   * налаштування для неіснуючої моделі це сміття, а видалене означало б модель,
   * якій журнал більше не ввімкнути. Тому в тулбарі лише «Відкрити».
   */
  protected override renderToolbarActions() {
    return html`
      <button class="btn btn-sm" ?disabled=${!this.selectedId}
        @click=${() => this.openEdit(this.selectedId)}>
        ${icons.open} ${this.t("common.open")}
      </button>
    `;
  }

  /** Insert створює запис — а створювати тут нічого (див. renderToolbarActions). */
  override hotkeyCreate() {}
}
