# `<ui-period>` — вибір періоду

Одне поле замість пари «дата з / дата по» для звітів і регістрів. Значення —
пара ISO-дат `dateFrom..dateTo`, **обидві включно** — саме так період приймають
SQL-функції звітів.

Посередині — кнопка з людською назвою періоду: календарний період називається
(«Липень 2026», «III квартал 2026», «2026»), довільний показується парою дат
(«01.07.26 — 15.07.26»). Кнопка відкриває пресети (сьогодні, тиждень, місяць,
квартал, рік — цей і минулий) та два `ui-date` для довільного періоду. Стрілки
`◀ ▶` зсувають період на його ж величину: місяць — місяцем (лютий не з'їдає
днів), довільні N днів — на N днів.

Невалідної пари не буває: редагування однієї межі за іншу підтягує ту другу.

```ts
import "@client/ui-kit/components/ui-period.ts";
import { periodOf } from "@client/shared/period.ts";

// дефолт «поточний місяць» — хелпером, а не ручною арифметикою дат
const month = periodOf("month");
this.$root.$query.dateFrom ||= month.dateFrom;
this.$root.$query.dateTo ||= month.dateTo;

html`
  <ui-period
    .label=${t("period.label")}
    .dateFrom=${q.dateFrom}
    .dateTo=${q.dateTo}
    @period-changed=${(e: CustomEvent<{ dateFrom: string; dateTo: string }>) => {
      q.dateFrom = e.detail.dateFrom;
      q.dateTo = e.detail.dateTo;
    }}
  ></ui-period>
`;
```

## Властивості

| Властивість | Тип | Типово | Опис |
|---|---|---|---|
| `date-from` | string (ISO) | `""` | Початок періоду, включно |
| `date-to` | string (ISO) | `""` | Кінець періоду, включно |
| `label` | string | `""` | Підпис поля |
| `label-position` | `top` \| `left` | `top` | Розташування підпису |
| `format` | string | `DD.MM.YY` | Шаблон дат довільного періоду (підпис і поля вводу) |
| `size` | `xs` \| `sm` \| `md` \| `lg` | `""` | Розмір daisyUI-кнопок |
| `width` | string | `""` | CSS-ширина обгортки |
| `disabled` | boolean | `false` | Блокує зміну |
| `visible` | boolean | `true` | Приховує контрол повністю |

## Подія

`period-changed` — на кожну зміну (пресет, стрілка, редагування межі),
`detail: { dateFrom, dateTo }` (ISO або `""`).

## Хелпери періодів — `client/shared/period.ts`

Логіка не зашита в компонент і доступна окремо:

- `periodOf(unit, base?)` — календарний період (`day` | `week` | `month` |
  `quarter` | `year`), що містить дату `base` (типово сьогодні);
- `shiftPeriod(p, ±1)` — попередній/наступний період тієї ж величини;
- `periodUnit(p)` — якій одиниці період дорівнює рівно, або `null`;
- `periodLabel(p, format?)` — людська підпис мовою інтерфейсу; нею ж варто
  формувати `printSubtitle()` звіту, щоб папір не розходився з екраном.
