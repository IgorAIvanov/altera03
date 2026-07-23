// Робота з бінарними об'єктами (вкладення, зображення) на клієнті.
//
// Три речі, і всі три — навколо токена доступу:
//  · blobUrl()      — посилання для <img src> / <a download>;
//  · uploadBlob()   — завантаження файлу на сервер;
//  · bindBlobOwner()— прив'язка вкладення до запису після його збереження.
//
// Токен приходить із сервера у полі `token` / `<field>Token` конверта моделі й
// живе стільки ж, скільки сесія. Зберігати його в localStorage безглуздо: у
// наступній сесії він уже інший.

import { apiFetch } from "../data/api.ts";

export interface BlobRef {
  id: string;
  token: string;
  name?: string;
  mime?: string;
  size?: number;
}

interface UploadEnvelope {
  ok: boolean;
  data?: { item?: BlobRef | null };
  messages?: (string | { text?: string })[];
}

function firstMessage(messages: UploadEnvelope["messages"]): string | null {
  const first = messages?.[0];
  if (!first) return null;
  return typeof first === "string" ? first : first.text ?? null;
}

/**
 * URL байтів вкладення.
 * `disposition: "attachment"` змушує браузер завантажити файл, а не показати.
 * Небезпечні типи сервер усе одно віддає як завантаження — незалежно від цього
 * параметра.
 */
export function blobUrl(
  id: string,
  token: string,
  disposition: "inline" | "attachment" = "inline",
): string {
  const params = new URLSearchParams({ token });
  if (disposition === "attachment") params.set("disp", "attachment");
  return `/api/blob/${encodeURIComponent(id)}?${params}`;
}

/**
 * Завантажити файл на сервер.
 *
 * `owner` можна не передавати: якщо форма ще не збережена, id запису невідомий.
 * Тоді вкладення лишається «сиротою» — прив'яжіть його через bindBlobOwner()
 * після збереження, інакше його прибере планове очищення (app.attachment_gc).
 */
export async function uploadBlob(
  file: File,
  owner?: { model?: string | null; id?: string | null },
): Promise<BlobRef> {
  const form = new FormData();
  form.append("file", file);
  if (owner?.model) form.append("ownerModel", owner.model);
  if (owner?.id) form.append("ownerId", owner.id);

  const response = await apiFetch("/api/blob/upload", { method: "POST", body: form });
  const envelope = await response.json().catch(() => null) as UploadEnvelope | null;

  if (!response.ok || !envelope?.ok || !envelope.data?.item) {
    throw new Error(firstMessage(envelope?.messages) ?? `Помилка завантаження (${response.status})`);
  }

  return envelope.data.item;
}

/** Прив'язати вкладення до запису (після того, як запис отримав id). */
export async function bindBlobOwner(
  attachmentId: string,
  owner: { model: string; id: string },
): Promise<void> {
  await apiFetch("/api/model/attachment/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ item: { id: attachmentId, ownerModel: owner.model, ownerId: owner.id } }),
  });
}

/** Чи можна показати вміст як картинку. */
export function isImageMime(mime: string | undefined | null): boolean {
  return typeof mime === "string" && mime.toLowerCase().startsWith("image/");
}

/** Розмір файлу в читабельному вигляді. */
export function formatFileSize(bytes: number | undefined | null): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / Math.pow(1024, power);
  return `${power === 0 ? scaled : scaled.toFixed(1)} ${units[power]}`;
}
