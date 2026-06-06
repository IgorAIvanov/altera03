import { bus } from "../bus/bus.ts";
import type { DataLoadMessage, DataSaveMessage } from "../bus/bus.types.ts";

async function callApi(model: string, command: string, payload: unknown): Promise<unknown> {
  const res = await fetch(`/api/model/${model}/${command}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${model}/${command}`);
  return res.json();
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
