import { viewManifest } from "@app/_generated/view-manifest.generated.ts";

/**
 * Маршрут в'ю за ключем моделі.
 *
 * У БД (види аналітики, типи документів) зберігається лише ключ моделі —
 * родина («catalog», «operation», «document») там не дублюється свідомо:
 * джерело правди про маршрути одне, і це view-manifest, згенерований з
 * манифестів. Збирати маршрут як `catalog/<model>` вручну не можна — ручна
 * операція живе в `operation/`, і такий здогад мовчки веде в нікуди.
 *
 * Повертає `null`, якщо в'ю немає: виклик має вирішити, чи це привід
 * приховати посилання, чи показати помилку.
 */
export function viewRoute(modelKey: string, view: "edit" | "list" | "picker" = "edit"): string | null {
  const suffix = `/${modelKey}/${view}`;
  return viewManifest.find((v) => v.route.endsWith(suffix))?.route ?? null;
}

/** Родина моделі (`catalog`, `operation`, `document`…) — префікс маршруту. */
export function viewFamily(modelKey: string): string | null {
  const route = viewRoute(modelKey, "edit") ?? viewRoute(modelKey, "list");
  return route?.split("/")[0] ?? null;
}
