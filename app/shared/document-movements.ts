import { html, type TemplateResult } from "lit";
import { bus } from "@client/bus/bus.ts";
import { can } from "@client/auth/session.ts";
import { icons } from "@client/ui-kit/icons.ts";
import { t } from "@client/locale.ts";
import { viewRoute } from "./view-route.ts";

/**
 * Кнопка «Рух документа» — перехід до звіту з проводками цього документа.
 *
 * Живе в застосунку, а не в базовому класі, і навмисно: «рух» має сенс лише
 * для документа, що ПРОВОДИТЬСЯ, а базовий клас списку обслуговує й довідники,
 * і журнали, і адмін-моделі. Оголошення «я документ» у базі довелося б
 * вигадати, а воно вже є — у самій формі, яка малює цю кнопку.
 *
 * Але й чотирьох копій (два списки, дві форми) тут бути не повинно: спільне
 * місце — застосунок, не фреймворк.
 *
 * Показується лише за наявності права на звіт: кнопка, якої користувачеві не
 * дадуть натиснути, не малюється (те саме правило, що з «Провести»).
 * Вимикається на непроведеному документі — рухів у нього немає за побудовою,
 * і звіт відкрився б порожнім.
 */
export function openDocumentMovements(documentId: string): void {
  const route = viewRoute("document_movements", "list");
  if (!route || !documentId) return;
  // Ключ `documentId` — це ім'я ФІЛЬТРА звіту: `applyParams` кладе params
  // прямо в `$filters` приймача (див. ReportBase), звідки їх і читає SQL.
  bus.emit({ type: "tab.open", route, params: { documentId } });
}

/** Чи є сенс і право показувати кнопку взагалі. */
export function mayViewMovements(): boolean {
  return can("document_movements", "view") && viewRoute("document_movements", "list") !== null;
}

/**
 * Сама кнопка — без підпису: у тулбарі списку й у командній панелі форми місце
 * дорожче за слово, а значення несе гліф із загального набору. Ім'я кнопці дає
 * `aria-label`, мишею його показує `title` — правило для будь-якої
 * кнопки-іконки.
 */
export function movementsButton(
  documentId: string | null | undefined,
  isPosted: boolean | undefined,
  extraClass = "",
): TemplateResult | string {
  if (!mayViewMovements()) return "";
  const label = t("documentMovements.title");
  return html`
    <button class="btn btn-sm btn-square ${extraClass}"
      ?disabled=${!documentId || !isPosted}
      title=${label} aria-label=${label}
      @click=${() => openDocumentMovements(documentId as string)}>
      ${icons.movements}
    </button>
  `;
}
