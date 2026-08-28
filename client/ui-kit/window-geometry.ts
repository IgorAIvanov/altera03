/**
 * Геометрія плавучого вікна — чиста математика, окремо від DOM.
 *
 * Відокремлено з тієї самої причини, що й `computePlacement` у popover.ts:
 * помилка тут не падає й нічого не ламає — вікно просто тихо з'їжджає за край
 * або відкривається шириною в екран. Побачити це можна лише очима, а перевірити
 * — лише пробою.
 *
 * Модуль навмисно без поведінки: ані Lit, ані `globalThis`. Розміри вікна
 * браузера приходять аргументом, і саме тому їх можна підставити в пробі.
 */

export interface WindowGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const MIN_WINDOW_WIDTH = 320;
export const MIN_WINDOW_HEIGHT = 240;

/**
 * Скільки вікна мусить лишитися на екрані.
 *
 * Затягти вікно за край корисно (звільнити місце під форму), а от втратити його
 * там — ні: воно лишається відкритим і недосяжним, і виглядає це як «зникло».
 * Число — приблизна ширина смуги заголовка, за яку його можна впіймати назад.
 */
export const KEEP_VISIBLE = 96;

/** Висота смуги заголовка: нижче неї вікно не опускаємо, бо тягти буде нічим. */
const TITLE_BAR = 40;

/**
 * Привести геометрію до екрана: розмір у межах, вікно — досяжним мишею.
 *
 * Кличеться не лише при перетягу, а й на кожному відкритті: збережене
 * положення могло приїхати з іншого монітора, і вікно, розставлене на 2560 px,
 * на ноутбуці опинилося б за краєм цілком.
 */
export function clampWindow(geometry: WindowGeometry, viewport: Viewport): WindowGeometry {
  const w = Math.max(MIN_WINDOW_WIDTH, Math.min(geometry.w, viewport.width));
  const h = Math.max(MIN_WINDOW_HEIGHT, Math.min(geometry.h, viewport.height));

  return {
    w,
    h,
    x: Math.max(KEEP_VISIBLE - w, Math.min(geometry.x, viewport.width - KEEP_VISIBLE)),
    y: Math.max(0, Math.min(geometry.y, viewport.height - TITLE_BAR)),
  };
}

/**
 * Умовчання — права половина екрана.
 *
 * Не центр: вікно відкривають, щоб звіряти його з формою, а форма лишається
 * ліворуч. Вікно посеред екрана закрило б рівно ті поля, заради яких його й
 * відкрили.
 */
export function defaultWindow(viewport: Viewport): WindowGeometry {
  const w = Math.max(MIN_WINDOW_WIDTH, Math.round(viewport.width / 2) - 24);
  return clampWindow({ x: viewport.width - w - 12, y: 56, w, h: viewport.height - 96 }, viewport);
}

/**
 * Прочитане зі сховища — це «будь-що»: інший користувач, інша версія, зіпсований
 * JSON. Тому геометрія не приймається на віру, а або впізнається цілком, або
 * замінюється умовчанням.
 */
export function restoreWindow(stored: unknown, viewport: Viewport): WindowGeometry {
  const value = stored as Partial<WindowGeometry> | null;
  const numbers = [value?.x, value?.y, value?.w, value?.h]
    .map((entry) => (typeof entry === "number" && Number.isFinite(entry) ? entry : null));

  if (numbers.some((entry) => entry === null)) return defaultWindow(viewport);

  const [x, y, w, h] = numbers as number[];
  return clampWindow({ x, y, w, h }, viewport);
}
