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

/**
 * Вікно, що розкривається ЗБОКУ від якоря, а не під ним.
 *
 * Другий випадок, і геометрія в нього інша: підменю згорнутої рейки, контекстне
 * меню рядка, розшифровка комірки звіту стоять праворуч від того, що їх
 * відкрило, і вирівнюються по його ВЕРХУ, а не по низу. Тому окрема функція, а
 * не прапорець у `computePlacement`: там кожна гілка міркує «вниз чи вгору», і
 * бік довелося б протягнути через усі.
 *
 * Спільне в них головне — межа вікна. Саме її не було в підменю рейки: `top`
 * брався з якоря як є, і в застосунку з довгим меню нижні пункти списку просто
 * йшли за нижній край екрана, звідки їх ніяк не дістати (вікно `fixed`, і
 * прокрутка сторінки під ним не рухає нічого).
 */
export interface SidePlacementInput {
  /** Пункт, від якого розкривається вікно. */
  anchor: Rect;
  popover: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Проміжок між якорем і вікном по горизонталі. */
  gap: number;
  /** Мінімальний відступ від краю вікна. */
  margin: number;
}

/**
 * Збоку від якоря, вирівняно по його верху, у межах екрана.
 *
 * По вертикалі: верх — як у якоря, але вікно цілком мусить лишитися на екрані,
 * тож надто низьке ПІДІЙМАЄТЬСЯ (а не обрізається — підменю з трьох пунктів
 * краще показати цілим трохи вище, ніж прокруткою на два з половиною). Вище за
 * верхній відступ не підіймаємо: там немає нічого кращого.
 *
 * Вікно, вище за екран, — інша річ: підняти його нікуди, тож воно стає під
 * верхній відступ і дістає `maxHeight`, тобто прокручується саме. Це той
 * випадок, коли меню довше за екран, і сказати «не влізло» ні до чого.
 *
 * По горизонталі: праворуч від якоря; не влазить — ліворуч (дзеркально), і вже
 * потім притискання до краю. Дзеркалення тут не косметика: рейка може стояти
 * праворуч, і тоді підменю праворуч від неї не видно взагалі.
 */
export function computeSidePlacement(input: SidePlacementInput): Placement {
  const { anchor, popover, viewport, gap, margin } = input;

  const room = viewport.height - margin * 2;
  const tooTall = popover.height > room;
  const maxHeight = tooTall ? room : undefined;
  const height = maxHeight ?? popover.height;

  const lowest = viewport.height - margin - height;
  const top = Math.max(margin, Math.min(anchor.top, lowest));

  const right = anchor.left + anchor.width + gap;
  const flipped = right + popover.width > viewport.width - margin;
  const wanted = flipped ? anchor.left - gap - popover.width : right;
  const maxLeft = viewport.width - popover.width - margin;
  const left = Math.max(margin, Math.min(wanted, maxLeft));

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

export interface PlaceSidePopoverOptions {
  /** Проміжок між якорем і вікном по горизонталі. */
  gap?: number;
  /** Мінімальний відступ від краю вікна. */
  margin?: number;
}

/**
 * Те саме «виміряти, порахувати, застосувати», але збоку.
 *
 * Викликати ПІСЛЯ того, як вікно потрапило в DOM (`updated()` у Lit): у
 * невиміряного елемента немає висоти, а саме вона вирішує, чи треба підіймати.
 *
 * Ставить `top`/`left` стилем, тож розмітка НЕ мусить прив'язувати їх сама —
 * інакше наступний рендер поверне вікно туди, звідки його щойно відсунули.
 */
export function placeSidePopover(
  popover: HTMLElement,
  anchor: HTMLElement,
  options: PlaceSidePopoverOptions = {},
): void {
  const box = popover.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();

  const placement = computeSidePlacement({
    anchor: { top: a.top, left: a.left, bottom: a.bottom, width: a.width },
    popover: { width: box.width, height: box.height },
    viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
    gap: options.gap ?? 0,
    margin: options.margin ?? 4,
  });

  if (placement.maxHeight !== undefined) {
    popover.style.maxHeight = `${placement.maxHeight}px`;
    popover.style.overflowY = "auto";
  } else {
    // Скидаємо явно: розміщення кличуть на кожне оновлення, і обмеження,
    // поставлене раз, лишалося б на вікні, якому вже вистачає місця.
    popover.style.maxHeight = "";
    popover.style.overflowY = "";
  }
  popover.style.top = `${placement.top}px`;
  popover.style.left = `${placement.left}px`;
}
