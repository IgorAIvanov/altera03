# Диалог выбора (`ModelPickerBase`)

Руководство для разработчика: как устроен модальный пикер модели и как добавить новый.

> Документация для человека. Инструктаж для AI-агента — в skill
> [`model-picker-form`](../.github/skills/model-picker-form/SKILL.md). Держите оба в синхроне.

---

## Что это и где в потоке

«Пикер модели» — это **модальный диалог выбора** одной записи из списка с поиском.
Не путать с двумя соседними вещами:

| Компонент                         | Что это                                                     |
|-----------------------------------|-------------------------------------------------------------|
| `<ui-picker>`                     | Инлайн-поле: input + выпадашка + кнопка-лупа. Общий, один на всё. |
| **`<Model>Picker.ts`**            | **Модалка**, которую открывает та лупа. По одной на модель.  |
| `<Model>List.ts`                  | Полноценный экран списка (тулбар, пагинация, сортировка).   |

Поток выбора:

```
<ui-picker>  ──клик по лупе──▶  bus.pick(route, params)
     ▲                                  │
     │ picker.select {id,label}         ▼
     └──────────────  picker-host (модалка) ──рендерит──▶  <bank-picker>
                                                            (ModelPickerBase)
```

`picker-host` (`client/ui-kit/picker-host.ts`) — общий хост модалки: оверлей,
рамка, заголовок, закрытие по «×» / клику вне / Escape. Он подгружает чанк
пикера по `manifest.json` → `views.picker`.

---

## Зачем база

Пикеров будет столько же, сколько моделей, и все одинаковы кроме модели и колонок.
Вся механика вынесена в **`ModelPickerBase`** (`client/ui-kit/base/model-picker-base.ts`):
поиск с debounce, загрузка через bus, контрастный выбор строки, подтверждение
двойным кликом / Enter, отмена по Escape, события `picker.select` / `picker.cancel`.

Конкретный пикер — тонкий подкласс.

---

## Быстрый старт

```ts
import { customElement } from "lit/decorators.js";
import { ModelPickerBase } from "@client/ui-kit/base/model-picker-base.ts";
import type { ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { ContractorLookupRow } from "./contractor.schema.ts";

export const tagName = "contractor-picker";

@customElement(tagName)
export class ContractorPicker extends ModelPickerBase<ContractorLookupRow> {
  protected model = "contractor";

  protected columns: ListColumn<ContractorLookupRow>[] = [
    { key: "name",   title: "common.name" },
    { key: "edrpou", title: "contractor.edrpou", width: "9rem", muted: true },
  ];
}
```

Это весь файл. `render()`, разметку, загрузку писать **не нужно**.

---

## Что делает база автоматически

| Возможность         | Поведение                                                       |
|---------------------|-----------------------------------------------------------------|
| Загрузка            | `bus.request("data.load", { model, command:"lookup", payload })`|
| Поиск               | поле с иконкой, автофокус, debounce 250 мс, поле `search` в payload |
| Параметры отбора    | `params` от `<ui-picker fetch-params=…>` подмешиваются в payload |
| Выбор строки        | одиночный клик — подсветка; двойной клик или Enter — подтвердить |
| Подтверждение       | `picker.select` с `{ id, label }` (label — поле `labelField`)   |
| Отмена              | кнопка «Скасувати», Escape, «×»/клик вне (через `picker-host`)  |
| Индикатор загрузки  | глобальная полоска под таб-баром                                |

---

## Колонки

Пикер использует **тот же тип `ListColumn`, что и список** (импорт из
`model-list-base.ts`). Поля: `key`, `title` (ключ локали или литерал), `width`
(CSS-значение, не Tailwind-класс), `align`, `overflow` (`"wrap"` | `"nowrap"` |
`"ellipsis"`), `muted`, `sortable` (серверная сортировка, как в списке),
`tooltip`, `render`.

Богатые ячейки (кнопки, бейджи, две строки), хелперы `stopRow` / `twoLine` и
хук `rowStyle(row)` работают так же, как в списке — см.
[`docs/ui-list-form.md`](ui-list-form.md), раздел «Богатые ячейки».

---

## Точки расширения

| Член                          | Когда нужен                                          |
|-------------------------------|------------------------------------------------------|
| `lookupCommand`               | Нестандартная команда вместо `"lookup"`.            |
| `labelField`                  | Поле строки как `label` выбора (по умолч. `name`).  |
| `defaultSortBy` / `defaultSortDir` | Начальная сортировка (по умолч. — первая sortable-колонка, asc). |
| `pageSizeOptions`             | Свой набор размеров страницы вместо `[10,20,50]`.    |
| `dialogWidth` / `dialogHeight` | Размер модалки, напр. `"720px"` / `"560px"` (читается `picker-host`; по умолч. `560×480`). |

---

## Связанные системные решения

- **Контраст выделенной строки.** Правило `tr.selected td { … !important }`
  (именно `td`, не `tr`): `table-zebra` ставит фон на `<td>` чётных строк, и фон
  строки оказывается перекрыт. Красить нужно ячейки. Та же правка применена и в
  списке — см. [`docs/ui-list-form.md`](ui-list-form.md).
- **CSS-переменные темы** резолвятся в Shadow DOM благодаря `:host` в
  `client/styles/theme.css` (см. список).

---

## Файлы

| Файл                                          | Роль                            |
|-----------------------------------------------|---------------------------------|
| `client/ui-kit/base/model-picker-base.ts`     | Базовый класс `ModelPickerBase` |
| `app/catalog/bank/bankPicker.ts`              | Эталонный пикер                 |
| `client/ui-kit/picker-host.ts`                | Хост модалки                    |
| `client/ui-kit/components/ui-picker.ts`       | Инлайн-поле, открывающее пикер  |
| `.github/skills/model-picker-form/SKILL.md`   | Инструктаж для AI-агента        |
