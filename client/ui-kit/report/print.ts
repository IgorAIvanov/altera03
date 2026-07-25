/**
 * Друк звіту — те, що на екрані, тим самим браузером.
 *
 * Окремого рендерера немає свідомо. Звіт — це таблиця, яку щойно намалював
 * браузер; він же вміє розкласти її на сторінки, повторити шапку і врахувати
 * поля. Серверний PDF довелося б описувати шаблоном на кожен звіт, а колонки в
 * звітах з'являються за наявністю даних (валюта, кількість) — шаблон і екран
 * розійшлися б на першому ж такому звіті.
 *
 * Механіка: `window.print()` плюс правила `@media print`, розкидані по трьох
 * рівнях, бо кожен володіє своєю частиною розкладки:
 *  1. документ — цей модуль (html/body/#app розтиснути з висоти 100%);
 *  2. оболонка — `tab-controller` (сховати вкладки й меню, розабсолютити панель);
 *  3. компонент — тема (`client/styles/theme.css`): `.no-print`, `.print-only`,
 *     компактна таблиця, посилання звичайним текстом.
 *
 * Друкується лише активна вкладка: неактивні панелі й так `display: none`.
 */

const STYLE_ID = "altera-print-reset";

/**
 * Правила рівня документа. У світлий DOM вони інакше не потрапляють: зібраний
 * Tailwind (`tw`) адоптується тільки в shadow root, а `html/body/#app` живуть
 * поза ними — їхню висоту задає `index.html` застосунку.
 */
const RESET = `
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  #app { height: auto !important; overflow: visible !important; }
  tab-controller { display: block !important; height: auto !important; }
  @page { size: landscape; margin: 10mm; }
}
`;

/** Один раз на сторінку: повторний друк не додає другого аркуша стилів. */
function ensureResetStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = RESET;
  document.head.append(style);
}

/**
 * Надрукувати поточний екран.
 *
 * `title` підміняє заголовок документа на час друку, і це не косметика:
 * браузер малює `document.title` у верхньому колонтитулі сторінки й підставляє
 * його як ім'я файлу в «Зберегти як PDF». Без підміни на папері стояло б ім'я
 * вкладки застосунку замість назви звіту.
 *
 * Повертається заголовок за подією `afterprint` — раніше не можна: у частині
 * браузерів `print()` віддає керування ще до того, як сторінку відрендерено.
 */
export function printCurrentView(title?: string): void {
  ensureResetStyle();

  const original = document.title;
  if (title) {
    document.title = title;
    globalThis.addEventListener("afterprint", () => { document.title = original; }, { once: true });
  }

  globalThis.print();
}
