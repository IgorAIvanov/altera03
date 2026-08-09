import { bus } from "../bus/bus.ts";
import type { DataLoadMessage, DataSaveMessage, DialogIcon } from "../bus/bus.types.ts";
import { resolveText, t } from "../locale.ts";
import { apiFetch, type EnvelopeMessage, readEnvelope } from "./api.ts";

/** Текст повідомлення конверта: воно буває голим рядком і об'єктом. */
function messageText(message: EnvelopeMessage): string {
  return typeof message === "string" ? message : String(message.text ?? "");
}

/**
 * Розгорнути маркери перекладу в повідомленнях конверта.
 *
 * Тут, а не у формі, і з тієї ж причини, що й перехоплення `modal`: це єдина
 * точка, через яку проходять УСІ команди моделей. Повідомлення без маркера
 * лишається як є — тобто діагностика для розробника («attachment_save: id
 * обов'язковий») крізь цю функцію проходить недоторканою, і саме так її й
 * відрізняють від тексту, призначеного користувачеві.
 *
 * Тільки `messages[]`, а не весь payload: обхід усього конверта коштував би
 * рекурсії на кожній відповіді, а головне — тоді контрагент, названий
 * «@[щось]», став би ключем. Поля даних розгортає той екран, який знає, що
 * поле службове (так робить меню).
 */
function resolveMessages<T extends { messages?: EnvelopeMessage[] }>(envelope: T): T {
  const messages = envelope.messages;
  if (!messages?.length) return envelope;

  return {
    ...envelope,
    messages: messages.map((message) =>
      typeof message === "string"
        ? resolveText(message)
        : { ...message, text: resolveText(String(message.text ?? "")) }
    ),
  };
}

/**
 * Повідомлення, помічені `modal: true`, показуємо вікном і прибираємо з
 * конверта — далі по конвеєру вони не йдуть.
 *
 * Перехоплення саме тут, у єдиній точці всіх команд моделей, а не у формі:
 * таке повідомлення не прив'язане до даних, і екран, який його спричинив, міг
 * і закритися (видалення зі списку). Форма про нього знати не мусить взагалі.
 */
function takeModalMessages<T extends { messages?: EnvelopeMessage[] }>(envelope: T): T {
  const messages = envelope.messages ?? [];
  const modal = messages.filter((m) => typeof m !== "string" && m.modal === true);
  if (modal.length === 0) return envelope;

  for (const message of modal) {
    // Не чекаємо на закриття: команда вже виконана, вікно живе своїм життям.
    bus.alert(messageText(message), dialogIcon(message));
  }
  return { ...envelope, messages: messages.filter((m) => !modal.includes(m)) };
}

/** Тип повідомлення як іконка діалогу; `warn` у діалогах зветься `warning`. */
function dialogIcon(message: EnvelopeMessage): DialogIcon {
  if (typeof message === "string") return "info";
  if (message.type === "warn") return "warning";
  return message.type ?? "info";
}

async function callApi(model: string, command: string, payload: unknown): Promise<unknown> {
  bus.emit({ type: "loading.start" });
  try {
    const res = await apiFetch(`/api/model/${model}/${command}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });

    // Конверт читаємо й на невдалому статусі: сервер кладе туди причину, а
    // `API error 503: bank/list` замість неї — рівно та мовчанка, з якої
    // доводилося лізти в консоль. Розбір ще й ловить відповідь не від нашого
    // сервера (сторінку помилки проксі) і піднімає екран «сервера немає».
    // Маркери розгортаємо ДО всього іншого: далі текст іде і у виняток, і у
    // модальне вікно, і в банер форми — розгортати в трьох місцях означало б
    // забути в одному.
    const envelope = resolveMessages(await readEnvelope(res));
    if (!res.ok && !envelope.ok) {
      // Саме messageText, а не `messages[0]`: повідомлення буває об'єктом, і
      // тоді в текст помилки їхало б «[object Object]».
      const first = envelope.messages?.[0];
      throw new Error(
        (first && messageText(first)) || t("common.requestFailed", { status: res.status }),
      );
    }

    return takeModalMessages(envelope);
  } finally {
    bus.emit({ type: "loading.end" });
  }
}

export function initDataService() {
  bus.handle("data.load", async (msg: DataLoadMessage) => {
    return callApi(msg.model, msg.command, msg.payload);
  });

  bus.handle("data.save", async (msg: DataSaveMessage) => {
    const result = await callApi(msg.model, msg.command, msg.payload);
    // оповещаем все формы об изменении модели
    bus.emit({ type: "model.changed", model: msg.model });
    return result;
  });
}
