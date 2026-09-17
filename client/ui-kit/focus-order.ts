/**
 * «Наступний контрол» — те, куди повів би Tab, але викликом із коду.
 *
 * Платформа такого API не має: `focus()` ставить фокус на названий елемент, а
 * послідовну навігацію браузер робить лише сам, на справжній Tab. Тому черга
 * обходиться тут — у ПЛОСКОМУ дереві, тобто так, як його бачить Tab: усередину
 * shadow root і крізь слоти (дочірні елементи хоста, що не потрапили в слот, на
 * екрані не існують і пропускаються).
 *
 * Дві свідомі межі:
 *  - додатний `tabindex` не впорядковується — у ui-kit його немає, а черга за
 *    ним суперечила б порядку розмітки;
 *  - у відкритому модальному `<dialog>` обхід не виходить за нього: решта
 *    сторінки під ним `inert`, і фокус туди не дістав би й сам Tab.
 */

const FOCUSABLE = "input:not([type=hidden]), select, textarea, button, a[href], [tabindex]";

function* children(parent: ParentNode): Generator<Element> {
  for (const el of Array.from(parent.children)) yield* visit(el);
}

function* visit(el: Element): Generator<Element> {
  if (el instanceof HTMLSlotElement) {
    const assigned = el.assignedElements({ flatten: true });
    if (assigned.length === 0) {
      yield* children(el); // запасний вміст слота
      return;
    }
    for (const a of assigned) yield* visit(a);
    return;
  }
  yield el;
  yield* children(el.shadowRoot ?? el);
}

function tabbable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.matches(FOCUSABLE)) return false;
  if (el.tabIndex < 0 || el.matches(":disabled")) return false;
  // Схована вкладка, закритий popover, згорнута частина форми.
  return el.checkVisibility?.() ?? el.getClientRects().length > 0;
}

/** Предок у складеному дереві: крізь межу shadow root до його хоста. */
function composedParent(el: Element): Element | null {
  return el.parentElement ?? ((el.getRootNode() as ShadowRoot).host ?? null);
}

function scopeOf(el: Element): ParentNode {
  for (let p: Element | null = el; p; p = composedParent(p)) {
    if (p instanceof HTMLDialogElement && p.open) return p;
  }
  return document.body;
}

/**
 * Перевести фокус на наступний (`step = 1`) або попередній контрол після
 * `from` — того елемента, у якому фокус зараз (для компонента це внутрішній
 * `input`, а не хост). `false` — далі нікуди, фокус не рухався.
 */
export function focusNext(from: HTMLElement, step: 1 | -1 = 1): boolean {
  const scope = scopeOf(from);
  const order = [...(scope instanceof Element ? visit(scope) : children(scope))];
  const at = order.indexOf(from);
  if (at < 0) return false;
  for (let i = at + step; i >= 0 && i < order.length; i += step) {
    const el = order[i];
    if (tabbable(el)) {
      el.focus();
      return true;
    }
  }
  return false;
}

/**
 * `Enter` поля, в якому нічого не набирали, — до наступного контрола, але лише
 * якщо клавішу ніхто вище не забрав.
 *
 * Поле кличе це зі свого `keydown`, тобто ПЕРШИМ на шляху події, а вирішувати
 * мусить ОСТАННІМ: у табличній частині `Enter` уже веде до наступної комірки,
 * у підпорядкованому регістрі — записує рядок. Обидва позначають це
 * `preventDefault()` (правило «обробив — познач»), тож рух відкладається до
 * кінця диспетчеризації й скасовується, якщо позначка з'явилася; інакше фокус
 * перескочив би двічі.
 */
export function focusNextAfterEnter(e: KeyboardEvent, from: HTMLElement): void {
  setTimeout(() => {
    if (!e.defaultPrevented) focusNext(from);
  });
}

/**
 * Елемент, у якому фокус насправді: `document.activeElement` зупиняється на
 * хості першого shadow root, а фокус лежить глибше — в `input` усередині.
 */
export function deepActiveElement(): HTMLElement | null {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

/** `Enter` без модифікаторів: Ctrl+Enter — кнопка за замовчуванням форми. */
export function isPlainEnter(e: KeyboardEvent): boolean {
  return e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}
