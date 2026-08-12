/**
 * Розміщення випадного вікна (Popover API) під полем — спільне для `ui-picker`,
 * `ui-date` і `ui-period`.
 *
 * Кожен із трьох рахував позицію сам, і однаково неповно: `top` з низу поля,
 * `left` з його лівого краю — і все. Пікеру це минало, бо його список завширшки
 * з поле; але календар (16rem) і період (19rem) ШИРШІ за поле, і біля правого
 * краю екрана — а панель фільтрів стоїть саме там — вилазили за межу вікна.
 * Горизонтального притискання не було в жодного.
 *
 * Нативний `<select>` (`ui-select`) такого не має, бо його список розміщує сам
 * браузер. Popover API цього не робить: `position: fixed` + `inset: unset`
 * означає «координати ставить автор».
 *
 * Розрахунок відокремлений від DOM навмисно — як розпізнавання гарячих клавіш у
 * `shell/shortcuts.ts`: чиста функція перевіряється пробами, а не очима.
 */

/**
 * Обов'язковий скид для елемента з атрибутом `popover`, який розміщує автор.
 *
 * Без нього браузер центрує вікно у в'юпорті власними `inset: 0` + `margin:
 * auto`, і задані `top`/`left` не діють узагалі — тобто `placePopover()`
 * відпрацює, а вікно лишиться посередині екрана. Домовленість, без якої
 * розрахунок не має сенсу, тому вона живе тут, поруч із ним, а не в трьох
 * розмітках, переписаних слово в слово.
 *
 * ```ts
 * html`<div popover="manual" style=${POPOVER_ANCHORED_STYLE + "width:20rem;"}>`
 * ```
 */
export const POPOVER_ANCHORED_STYLE = "position:fixed; margin:0; inset:unset;";

export interface Rect {
  top: number;
  left: number;
  bottom: number;
  width: number;
}

export interface PlacementInput {
  /** Поле, під яким розкривається вікно. */
  anchor: Rect;
  /** Розмір самого вікна. */
  popover: { width: number; height: number };
  viewport: { width: number; height: number };
  gap: number;
  margin: number;
  /**
   * Бажана висота вмісту. Задана — вікно дістає `maxHeight` за вільним місцем
   * (список сам прокрутиться). Не задана — висота береться як є і потрібна лише
   * щоб вирішити, вниз чи вгору: обрізати календар не можна, він не
   * прокручується.
   */
  desiredHeight?: number;
}

export interface Placement {
  top: number;
  left: number;
  /** `undefined` — висоту не обмежуємо. */
  maxHeight?: number;
}

export function computePlacement(input: PlacementInput): Placement {
  const { anchor, popover, viewport, gap, margin, desiredHeight } = input;

  // ── по вертикалі: вниз, якщо влазить; інакше туди, де місця більше ──
  const wanted = desiredHeight ?? popover.height;
  const below = viewport.height - anchor.bottom - gap;
  const above = anchor.top - gap;
  const openAbove = below < wanted && above > below;
  const available = Math.max(0, openAbove ? above : below);

  const maxHeight = desiredHeight === undefined ? undefined : Math.min(wanted, available);
  // Куди ставити верх, коли розкриваємось угору, рахуємо за ФАКТИЧНОЮ висотою:
  // для списку це обрізана `maxHeight`, для календаря — його власна.
  const height = maxHeight ?? wanted;

  const top = openAbove
    ? Math.max(margin, anchor.top - gap - height)
    : anchor.bottom + gap;

  // ── по горизонталі: за лівим краєм поля, але не за межу вікна ──
  // Саме зсув, а не звуження: вміст розрахований на свою ширину, і стиснути
  // календар — зламати сітку днів. Вікно, ширше за екран, притискається до
  // лівого краю: побачити початок важливіше, ніж кінець.
  const maxLeft = viewport.width - popover.width - margin;
  const left = Math.max(margin, Math.min(anchor.left, maxLeft));

  return { top, left, maxHeight };
}

export interface PlacePopoverOptions {
  /** Відступ від поля по вертикалі. */
  gap?: number;
  /** Мінімальний відступ від краю вікна. */
  margin?: number;
  /** Ширина вікна = ширині поля (список пікера). */
  matchAnchorWidth?: boolean;
  /** Див. `PlacementInput.desiredHeight`. */
  desiredHeight?: number;
}

/**
 * Виміряти, порахувати, застосувати.
 *
 * Викликати ПІСЛЯ `showPopover()`: у схованого елемента немає розмірів, а без
 * ширини нема чого притискати. Видимого миготіння це не дає — до
 * відмальовування браузер виконує весь синхронний код.
 */
export function placePopover(
  popover: HTMLElement,
  anchor: HTMLElement,
  options: PlacePopoverOptions = {},
): void {
  if (options.matchAnchorWidth) {
    popover.style.width = `${anchor.getBoundingClientRect().width}px`;
  }
  // Заміряємо ПІСЛЯ ширини: вона впливає на перенос вмісту, отже й на висоту.
  const box = popover.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();

  const placement = computePlacement({
    anchor: { top: a.top, left: a.left, bottom: a.bottom, width: a.width },
    popover: { width: box.width, height: box.height },
    viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
    gap: options.gap ?? 2,
    margin: options.margin ?? 4,
    desiredHeight: options.desiredHeight,
  });

  if (placement.maxHeight !== undefined) {
    popover.style.maxHeight = `${placement.maxHeight}px`;
  }
  popover.style.top = `${placement.top}px`;
  popover.style.left = `${placement.left}px`;
}
