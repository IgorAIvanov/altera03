/**
 * «Створити на підставі»: що можна ввести на підставі моделі, і відкрити
 * форму цілі, заповнену з документа-підстави.
 *
 * Кнопку малює ЗАСТОСУНОК — у шапці списку, у рядку, у формі, де вирішить;
 * фреймворк дає лише склад меню й дорогу до чернетки. Склад — метадані:
 * перелік `basedOn` лежить у манифесті ЦІЛІ, а питають з боку джерела, тож
 * обернути граф може лише сервер (команда ядра `basis.targets`). Він же рахує
 * маршрут форми цілі з view-manifest — як для `document.locate`.
 *
 * Права тут не фільтруються свідомо: пункт без права відмовить сам, коли форма
 * спробує заповнити чернетку (`fill_basis` просить `create`) або зберегти її.
 *
 * ```ts
 * const targets = await basisTargets("goods_sale");
 * // пункти меню: t(target.titleKey ?? target.model)
 * openOnBasis(target, { model: "goods_sale", id: row.id });
 * ```
 *
 * Далі все робить форма цілі сама (`BaseUI.applyParams` → `fill_basis`):
 * чернетка лягає в `$root` НЕзбереженою, зберігає її людина.
 */
import { bus } from "../bus/bus.ts";
import type { EnvelopeMessage } from "../data/api.ts";

/** Ціль «на підставі» — рядок відповіді `basis.targets`. */
export interface BasisTarget {
  /** Модель цілі. */
  model: string;
  /** Маршрут форми редагування цілі (`document/tax_invoice/edit`). */
  route: string;
  /** Ключ назви форми цілі — підпис пункту меню (`t(titleKey)`). */
  titleKey: string | null;
}

/** Документ-підстава: модель і id. Саме це форма цілі отримує в `params.basis`. */
export interface BasisRef {
  model: string;
  id: string;
}

interface TargetsEnvelope {
  ok?: boolean;
  data?: { rows?: BasisTarget[] };
  messages?: EnvelopeMessage[];
}

/**
 * Кеш на сесію сторінки: склад графа — метадані збірки, між викликами він не
 * міняється. Кешується обіцянка, а не результат, — щоб десять рядків списку,
 * що малюють меню одночасно, не дали десяти запитів.
 */
const cache = new Map<string, Promise<BasisTarget[]>>();

/** Що можна ввести на підставі моделі `model`. Порожньо — нічого (або сервер не відповів). */
export function basisTargets(model: string): Promise<BasisTarget[]> {
  let pending = cache.get(model);
  if (!pending) {
    pending = (async () => {
      const env = await bus.request("data.load", {
        model: "basis",
        command: "targets",
        payload: { model },
      }) as TargetsEnvelope | undefined;
      if (!env?.ok) {
        // Відмову не кешуємо: сервер міг бути недоступний мить.
        cache.delete(model);
        return [];
      }
      return env.data?.rows ?? [];
    })();
    cache.set(model, pending);
  }
  return pending;
}

/**
 * Відкрити НОВУ вкладку форми цілі, заповнену з `basis`.
 *
 * `target` — рядок `basisTargets` або просто ім'я моделі цілі (тоді маршрут
 * шукається серед цілей підстави). Повертає `false`, якщо такої цілі в
 * підстави немає — тобто `basedOn` цілі її не називає.
 *
 * Вкладка завжди нова (`fresh`): дві чернетки на підставі різних документів —
 * законний стан, і друга не має затерти першу, ще не збережену.
 */
export async function openOnBasis(target: BasisTarget | string, basis: BasisRef): Promise<boolean> {
  const resolved = typeof target === "string"
    ? (await basisTargets(basis.model)).find((candidate) => candidate.model === target)
    : target;
  if (!resolved) return false;

  bus.emit({
    type: "tab.open",
    route: resolved.route,
    id: null,
    fresh: true,
    params: { basis: { model: basis.model, id: String(basis.id) } },
  });
  return true;
}
