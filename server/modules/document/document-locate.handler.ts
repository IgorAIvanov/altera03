// Документ за кодом із бланка: `document.locate`.
//
// Навіщо. Бланк друкує штрихкод з id документа; відсканували папір — має
// відкритися форма. Знання «id → тип → модель» і право належать ядру
// (`app.document_locate`), а маршрут форми — view-manifest, який приходить у
// `bootstrap({ views })`. У базі маніфесту немає, тож команда TS: SQL каже,
// ЯКИЙ це документ і чи можна його бачити, а тут до цього добудовується, ДЕ
// його форма.
//
// Чому маршрут рахує сервер, а не клієнт. Клієнтська бібліотека маніфесту не
// бачить — він генерується з манифестів застосунку, і тому
// `<ui-related-documents>` просить `routeOf` у застосунку. Для поля в шапці це
// означало б ще одну обов'язкову прив'язку в composition root, без якої поле
// мовчки нічого не відкриває. Сервер маніфест і так тримає — для `/api/view`.
import { getServerConfig } from "../../config/server-config.ts";
import type { ModelCommandContext } from "../model-runtime/model-runtime.types.ts";
import { err, ok } from "../../common/response.ts";

/** Що віддає `document.locate`: досить, щоб відкрити вкладку. */
export interface DocumentLocation {
  id: string;
  /** Маршрут форми редагування (`document/invoice/edit`). */
  route: string;
  typeCode: string;
  typeName: string;
}

interface LocateEnvelope {
  ok?: boolean;
  data?: { item?: { id: string; typeCode: string; typeName: string } | null };
}

/**
 * Маршрут форми редагування моделі. Родину («document», «operation») не
 * вгадуємо: ручна операція живе в `operation/`, і маршрут `document/<модель>`
 * вів би в нікуди. Правило те саме, що в `viewRoute` застосунку.
 */
export function editRouteOf(model: string, manifest: ReadonlyArray<{ route: string }>): string | null {
  const suffix = `/${model}/edit`;
  return manifest.find((entry) => entry.route.endsWith(suffix))?.route ?? null;
}

export async function documentLocateHandler(
  payload: Record<string, unknown>,
  context: ModelCommandContext,
): Promise<unknown> {
  const [row] = await context.db.sql<{ result: unknown }[]>`
    select app.document_locate(${context.userId}::bigint, ${context.db.sql.json({ code: String(payload.code ?? "") })}::jsonb) as result
  `;

  // Відмова (не знайдено, немає права) — конверт як є, разом з маркером.
  const envelope = row?.result as LocateEnvelope | undefined;
  const item = envelope?.data?.item;
  if (!envelope?.ok || !item) return row?.result;

  const route = editRouteOf(item.typeCode, getServerConfig().views.manifest);
  if (!route) {
    // Тип документа є в базі, а форми в застосунку немає: документ завели
    // сідом чи імпортом, екрана під нього не зробили.
    return err(`@[core.documentLocate.noForm]${JSON.stringify({ type: item.typeName })}`);
  }

  return ok<DocumentLocation>({ ...item, route });
}
