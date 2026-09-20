/**
 * Команда `import_session.start` — завести канал і дістати код спарювання.
 *
 * Це TS, а не SQL-функція, з однієї причини: код спарювання — облікові дані, і
 * народжуватися він мусить із криптографічно випадкових байтів у процесі. У
 * SQL-функції сире значення стало б параметром запиту, тобто потрапило б у
 * будь-який журнал, який пише параметри, — і одноразовий код перестав би бути
 * одноразовим. Те саме правило й з тієї ж причини діє для звичайних токенів.
 *
 * Командою МОДЕЛІ, а не входом у контролері каналу, — теж свідомо: заводить
 * сесію людина, і право на це має рахуватися там само, де права на все інше
 * (`import_session:create`), у тому самому `select`. Друга система прав поруч
 * із першою розійшлася б з нею мовчки.
 */
import { getServerConfig } from "../../config/server-config.ts";
import { err, ok } from "../../common/response.ts";
import type { ModelCommandContext } from "../model-runtime/model-runtime.types.ts";
import { randomPairingCode, sha256Hex } from "./import.codes.ts";

const SOURCE_PATTERN = /^[a-z][a-z0-9_.-]*$/;

export async function importSessionStartHandler(
  payload: Record<string, unknown>,
  ctx: ModelCommandContext,
): Promise<unknown> {
  const source = String(payload.source ?? "").trim();
  if (!SOURCE_PATTERN.test(source)) {
    return err("@[core.importSourceRequired]");
  }

  const params = payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
    ? payload.params as Record<string, unknown>
    : {};

  const code = randomPairingCode();
  const expiresAt = new Date(Date.now() + getServerConfig().import.pairingTtlMinutes * 60_000);

  const rows = await ctx.db.sql<{ id: string }[]>`
    select app.import_session_create(
      ${ctx.userId}::bigint,
      ${source},
      ${ctx.db.sql.json(params as never)}::jsonb,
      ${await sha256Hex(code)},
      ${expiresAt}::timestamptz
    )::text as id
  `;

  const id = rows[0]?.id;
  if (!id) return err("@[core.importSessionNotFound]");

  // Код віддається ОДИН раз і більше ніде: у базі лежить хеш. Далі його читає
  // людина з екрана й диктує тому, хто сидить за чужою базою.
  return ok({ id, code, expiresAt: expiresAt.toISOString() });
}
