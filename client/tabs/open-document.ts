/**
 * Відкрити документ за кодом із бланка — вкладкою його форми.
 *
 * Бланк друкує штрихкод з id документа (`app.document.id`): номер кириличний і
 * в Code 128 не влазить, а id однозначний між організаціями й роками
 * нумерації. Код іде в команду ядра `document.locate`, яка відповідає ВСІМ, що
 * треба для вкладки: маршрутом форми й id. Тип документа, модель, право `view`
 * на неї і маршрут з view-manifest — усе рахує сервер, тож застосунку тут нічого
 * прив'язувати не треба (на відміну від `routeOf` дерева пов'язаних документів).
 *
 * Відмову — «не знайдено», «немає права», «немає форми» — показує оболонка
 * коротким повідомленням: порожня вкладка тут гірша за фразу.
 *
 * Готовий вхід — `<ui-document-open>` для шапки; функція окремо для тих, кому
 * потрібен свій (кнопка на домашній вкладці, власна гаряча клавіша).
 */
import { bus } from "../bus/bus.ts";
import type { EnvelopeMessage } from "../data/api.ts";
import { t } from "../locale.ts";

interface LocateEnvelope {
  ok?: boolean;
  data?: { item?: { id: string; route: string } | null };
  messages?: EnvelopeMessage[];
}

/** `true` — вкладку відкрито; `false` — відмова, і повідомлення вже показане. */
export async function openDocumentByCode(code: string): Promise<boolean> {
  const trimmed = code.trim();
  if (!trimmed) return false;

  const env = await bus.request("data.load", {
    model: "document",
    command: "locate",
    payload: { code: trimmed },
  }) as LocateEnvelope | undefined;

  const item = env?.data?.item;
  if (env?.ok && item?.route) {
    bus.emit({ type: "tab.open", route: item.route, id: item.id });
    return true;
  }

  // Маркер уже розгорнула служба даних; порожньо буває лише без сервера.
  const first = env?.messages?.[0];
  const text = (typeof first === "string" ? first : first?.text) ||
    t("common.requestFailed", { status: "" }).trim();
  bus.emit({ type: "notice", text });
  return false;
}
