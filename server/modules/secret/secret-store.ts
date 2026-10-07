/**
 * Секрети моделей — запис, опис і розшифрування (`app.secret`).
 *
 * Межа проходить так: рантайм моделей (`model-runtime.service.ts`) вирішує,
 * КОЛИ сюди звертатися (на `save` — вилучити й записати, на `get` — описати),
 * а тут — ЯК. Відкрите значення назовні віддає лише `readSecret`, і кличе його
 * тільки `ctx.secret` TS-команди тієї самої моделі.
 */
import { getServerConfig, type SecretsConfig } from "../../config/server-config.ts";
import type { DatabaseService } from "../../database/database.service.ts";
import { importSecretKey, openSecret, type SecretKey, sealSecret } from "./secret-cipher.ts";

let cache: { source: SecretsConfig; keys: Promise<SecretKey[]> } | null = null;

/** Ключі з конфігурації: перший пише, решта лише читає. */
function keys(): Promise<SecretKey[]> {
  const config = getServerConfig().secrets;
  if (!cache || cache.source !== config) {
    const list = [config.key, config.previousKey].filter((value): value is string => !!value);
    cache = { source: config, keys: Promise.all(list.map(importSecretKey)) };
  }
  return cache.keys;
}

/**
 * Перевірка на старті: модель оголосила секрет, а ключа немає. Разового ключа
 * на процес тут бути не може (див. `SecretsConfig`), тож краще не стартувати,
 * ніж прийняти токен і втратити його на першому рестарті.
 */
export function assertSecretsConfigured(models: Record<string, { secrets?: string[] }>): void {
  const owners = Object.entries(models).filter(([, config]) => config.secrets?.length).map(([model]) => model);
  if (owners.length && !getServerConfig().secrets.key) {
    throw new Error(
      `Моделі ${owners.join(", ")} зберігають секрети (x-secret), а SECRET_KEY не задано. ` +
        `Згенеруй ключ (deno eval "console.log(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))") ` +
        `і поклади в оточення — без нього записаний токен став би нечитаним після рестарту.`,
    );
  }
}

/** Що в payload `save` сказано про секрет: записати, стерти чи не чіпати. */
export type SecretChange = { field: string; value: string } | { field: string; clear: true };

/**
 * Вилучити поля-секрети з `payload.item`. Повертає копію payload-а без них і
 * перелік змін. Відсутнє поле й порожній рядок — «не змінювати» (форма не
 * знає старого значення й не мусить слати його назад), `null` — стерти.
 * Супутні `<поле>Set`/`<поле>ChangedAt` теж прибираються: їх дописує рантайм.
 */
export function extractSecrets(
  payload: Record<string, unknown>,
  fields: string[],
): { payload: Record<string, unknown>; changes: SecretChange[] } {
  const item = payload.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return { payload, changes: [] };
  const rest: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  const changes: SecretChange[] = [];
  for (const field of fields) {
    const value = rest[field];
    delete rest[field];
    delete rest[`${field}Set`];
    delete rest[`${field}ChangedAt`];
    if (value === null) changes.push({ field, clear: true });
    else if (typeof value === "string" && value !== "") changes.push({ field, value });
  }
  return { payload: { ...payload, item: rest }, changes };
}

export async function writeSecrets(
  db: DatabaseService,
  model: string,
  ownerId: string,
  userId: string,
  changes: SecretChange[],
): Promise<void> {
  if (!changes.length) return;
  const [key] = await keys();
  if (!key) throw new Error("SECRET_KEY не задано — секрет записати нічим");
  for (const change of changes) {
    if ("clear" in change) {
      await db.sql`
        delete from app.secret where owner_model = ${model} and owner_id = ${ownerId}::bigint and field = ${change.field}
      `;
      continue;
    }
    const sealed = await sealSecret(key, change.value, { model, id: ownerId, field: change.field });
    await db.sql`
      insert into app.secret (owner_model, owner_id, field, iv, cipher, key_id, updated_by, updated_at)
      values (${model}, ${ownerId}::bigint, ${change.field}, ${sealed.iv}, ${sealed.cipher}, ${sealed.keyId},
              ${userId}::bigint, now())
      on conflict (owner_model, owner_id, field)
      do update set iv = excluded.iv, cipher = excluded.cipher, key_id = excluded.key_id,
                    updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `;
  }
}

/**
 * Дописати до запису відповіді `<поле>Set` і `<поле>ChangedAt` — і нічого
 * більше: жодного символу самого секрету, навіть маски. Дата зміни відповідає
 * людині на питання «чи той це токен, що я вчора вставив».
 */
export async function describeSecrets(
  db: DatabaseService,
  model: string,
  item: Record<string, unknown>,
  fields: string[],
): Promise<void> {
  for (const field of fields) {
    delete item[field];
    item[`${field}Set`] = false;
    item[`${field}ChangedAt`] = null;
  }
  const id = item.id;
  if (id === null || id === undefined || id === "" || !/^\d+$/.test(String(id))) return;
  const rows = await db.sql<{ field: string; updated_at: string }[]>`
    select field, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
      from app.secret
     where owner_model = ${model} and owner_id = ${String(id)}::bigint and field = any(${fields})
  `;
  for (const row of rows) {
    item[`${row.field}Set`] = true;
    item[`${row.field}ChangedAt`] = row.updated_at;
  }
}

export async function readSecret(
  db: DatabaseService,
  model: string,
  ownerId: string,
  field: string,
): Promise<string | null> {
  const [row] = await db.sql<{ iv: Uint8Array; cipher: Uint8Array; key_id: string }[]>`
    select iv, cipher, key_id from app.secret
     where owner_model = ${model} and owner_id = ${ownerId}::bigint and field = ${field}
  `;
  if (!row) return null;
  // Драйвер віддає Buffer; копія — щоб WebCrypto отримав звичайний ArrayBuffer.
  const sealed = { iv: new Uint8Array(row.iv), cipher: new Uint8Array(row.cipher), keyId: row.key_id };
  return await openSecret(await keys(), sealed, {
    model,
    id: ownerId,
    field,
  });
}
