import { bus } from "../bus/bus.ts";
import type { DataLoadMessage, DataSaveMessage } from "../bus/bus.types.ts";
import { apiFetch, readEnvelope } from "./api.ts";

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
    const envelope = await readEnvelope(res);
    if (!res.ok && !envelope.ok) {
      throw new Error(envelope.messages?.[0] ?? `Помилка ${res.status}: ${model}/${command}`);
    }

    return envelope;
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
