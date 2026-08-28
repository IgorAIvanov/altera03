/**
 * Розкладка розділеного вікна — чиста математика, окремо від DOM.
 *
 * Відокремлено з тієї самої причини, що й `computePlacement` у popover.ts:
 * помилка тут не падає й нічого не ламає — смуга просто з'їжджає, панель
 * стискається в нуль або перестає рухатися. Побачити це можна лише очима, а
 * перевірити — пробою.
 *
 * Модуль без поведінки: ані Lit, ані `globalThis`. Висота контейнера приходить
 * аргументом, і саме тому її можна підставити.
 */

/** Скільки лишається найменшій панелі. Нижче — вміст перестає бути вмістом. */
export const MIN_PANE = 120;

/** Частка висоти під файл, коли її ще не рухали: трохи більше за половину. */
export const DEFAULT_RATIO = 0.5;

/**
 * Як показувати файл. Два режими розв'язують різні задачі, і саме тому їх два:
 * `split` — звірка рядок за рядком, коли форма мусить лишатися видною й
 * гортатися; `float` — «глянути, що це», коли форму розсовувати шкода.
 */
export type ViewMode = "split" | "float";

export interface SplitState {
  /** Частка висоти, віддана файлу: 0…1. */
  ratio: number;
  /** Файл угорі (як просили) чи внизу. */
  fileFirst: boolean;
  mode: ViewMode;
}

/**
 * Привести частку до контейнера: обидві панелі лишаються придатними.
 *
 * Саме в пікселях, а не «не менше 10%»: на короткому вікні десята частина —
 * це смужка в тридцять пікселів, у якій не видно нічого, а на високому екрані
 * та сама десята вже завелика для смуги-роздільника.
 */
export function clampRatio(ratio: number, containerHeight: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_RATIO;
  // Контейнер, у який не влазять дві мінімальні панелі, ділимо навпіл: краще
  // дві однаково тісні, ніж одна нормальна й одна в нуль.
  if (containerHeight <= MIN_PANE * 2) return 0.5;

  const min = MIN_PANE / containerHeight;
  return Math.max(min, Math.min(ratio, 1 - min));
}

/**
 * Частка після перетягу смуги на `delta` пікселів.
 *
 * `fileFirst` міняє знак: коли файл унизу, рух смуги вниз ЗМЕНШУЄ його частку.
 * Без цього роздільник у перевернутій розкладці їхав би в протилежний бік — і
 * саме так це помічають: миша вниз, панель угору.
 */
export function ratioAfterDrag(
  startRatio: number,
  delta: number,
  containerHeight: number,
  fileFirst: boolean,
): number {
  if (containerHeight <= 0) return startRatio;
  const shift = (fileFirst ? delta : -delta) / containerHeight;
  return clampRatio(startRatio + shift, containerHeight);
}

/**
 * Прочитане зі сховища — це «будь-що»: інший користувач, інша версія,
 * зіпсований JSON. Тому стан або впізнається цілком, або замінюється
 * умовчанням.
 */
export function restoreSplit(stored: unknown): SplitState {
  const value = stored as Partial<SplitState> | null;
  const ratio = typeof value?.ratio === "number" && Number.isFinite(value.ratio)
    ? Math.max(0.05, Math.min(value.ratio, 0.95))
    : DEFAULT_RATIO;

  return {
    ratio,
    fileFirst: value?.fileFirst !== false,
    // Умовчання — розділення: воно й є відповідь на звірку, заради якої все
    // робилося. Плавуче вікно вмикають свідомо.
    mode: value?.mode === "float" ? "float" : "split",
  };
}
