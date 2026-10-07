// Що можна ввести на підставі моделі: `basis.targets`.
//
// Навіщо. «Створити на підставі ▾» малює застосунок — у шапці списку, у рядку,
// у формі, де вирішить. Але склад меню — це метадані: перелік `basedOn` живе в
// манифесті ЦІЛІ, бо заповнювати вміє ціль, а питають з боку ДЖЕРЕЛА. Обернути
// граф може лише той, хто бачить усі манифести одразу, — тобто реєстр. Без цієї
// команди кожна кнопка тримала б свій список цілей руками, і нова ціль
// вимагала б правки у формах, яких її автор не торкався.
//
// Маршрут форми цілі рахує сервер — з того самого view-manifest, що й
// `document.locate`: клієнтська бібліотека манифесту не бачить.
//
// Права не фільтруються свідомо: пункт без права відмовить сам, коли чернетку
// спробують заповнити чи зберегти, — тим самим повідомленням, що й скрізь.
import { getServerConfig } from "../../config/server-config.ts";
import { editRouteOf } from "../document/document-locate.handler.ts";
import type { ModelCommandContext } from "./model-runtime.types.ts";
import { err, rows } from "../../common/response.ts";

export interface BasisTarget {
  /** Модель цілі — для `fill_basis` і для `openOnBasis`. */
  model: string;
  /** Маршрут форми редагування цілі (`document/tax_invoice/edit`). */
  route: string;
  /** Ключ назви форми цілі (з view-manifest) — підпис пункту меню. */
  titleKey: string | null;
}

/** Цілі моделі `source` — моделі, чий `basedOn` її називає. Без форми — пропускаються. */
export function basisTargetsOf(source: string): BasisTarget[] {
  const { models, views } = getServerConfig();
  const targets: BasisTarget[] = [];

  for (const [model, config] of Object.entries(models.registry)) {
    if (!config.basedOn?.includes(source)) continue;
    // Ціль без форми (модель «лише команди») вводиться агентом через
    // `fill_basis` + `save`, але відкрити вкладку їй нічим.
    const route = editRouteOf(model, views.manifest);
    if (!route) continue;
    const titleKey = views.manifest.find((entry) => entry.route === route)?.titleKey ?? null;
    targets.push({ model, route, titleKey });
  }

  return targets.sort((left, right) => left.model.localeCompare(right.model));
}

export function basisTargetsHandler(
  payload: Record<string, unknown>,
  _context: ModelCommandContext,
): Promise<unknown> {
  const model = typeof payload.model === "string" ? payload.model.trim() : "";
  if (!model) return Promise.resolve(err("basis.targets: model обов'язковий"));
  return Promise.resolve(rows(basisTargetsOf(model)));
}
