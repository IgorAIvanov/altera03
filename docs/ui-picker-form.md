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

Механика таблицы живёт в **`QueryTableBase`** (`client/ui-kit/base/query-table-base.ts`) —
общей основе пикера и списка: загрузка, серверная сортировка, поиск с debounce,
пагинация, клавиатура строк (↑↓, Home/End, пробел — выделить, Enter — активировать)
и тулбар. **`ModelPickerBase`** (`client/ui-kit/base/model-picker-base.ts`) добавляет
поверх только то, что делает из таблицы диалог: фокус в поиск при открытии,
подтверждение и отмену, события `picker.select` / `picker.cancel`.

Разделение появилось не ради красоты: пока код был скопирован, копии молча
расходились — в пикере `#cell` игнорировал `col.format` (колонка с датой показала бы
сырой ISO), debounce был 250 против 300 в списке без причины, а клавиатура и ARIA
достались только списку.

Конкретный пикер — тонкий подкласс. Правило деления: всё про **таблицу** — в
`QueryTableBase` (и тогда меняется заодно и список), всё про **выбор значения** —
в `ModelPickerBase`.

---

## Быстрый старт

```ts
import { customElement } from "lit/decorators.js";
import { ModelPickerBase } from "@client/ui-kit/base/model-picker-base.ts";
import type { ListColumn } from "@client/ui-kit/base/table-contract.ts";
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

Пикер использует **тот же тип `ListColumn`, что и список** — но импортируется он
из `table-contract.ts`, общего для обоих, а не из `model-list-base.ts`. Раньше
он лежал именно там, и пикер тянул за собой весь модуль списка вместе с
`<ui-group-tree>` и выгрузкой в Excel — около 36 кБ, из которых диалог подбора
не использует ничего. Поля: `key`, `title` (ключ локали или литерал), `width`
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
| `renderToolbarExtra()`        | Свои кнопки в тулбаре диалога.                       |
| `extraPayload()`              | Поля запроса сверх `params` — то, чем управляют эти кнопки. |

### Свои кнопки в диалоге

У диалога есть тулбар — такой же, как у списка: свои кнопки слева, поиск и «Обновить»
справа. Точка расширения одна, `renderToolbarExtra()`, чтобы все пикеры ставили кнопки
в одно и то же место:

```ts
@state() private showArchived = false;

protected override renderToolbarExtra() {
  return html`
    <button class="btn btn-sm" @click=${() => { this.showArchived = !this.showArchived; this.reload(); }}>
      ${t("counterparty.showArchived")}
    </button>
  `;
}

protected override extraPayload() {
  return { showArchived: this.showArchived };
}
```

Флаг держите в `@state`, а не в `$root`: это транзиентное состояние экрана, не данные
модели. `reload()` перезапрашивает с первой страницы — именно то, что нужно при смене
фильтра.

### Множественный выбор

Решает **вызывающий**, а не пикер: тот же справочник подбирают то одним значением в
поле, то пачкой в табличную часть документа.

```ts
const rows = await bus.pickMany("catalog/nomenclature");   // → [{id, label}, …] | null
```

`bus.pickMany()` открывает тот же диалог с `multiple: true`; `picker-host` передаёт
это свойством, и база показывает колонку флажков, «все на странице», счётчик и
«Выбрать (N)» в подвале. `bus.pick()` не изменился и по-прежнему возвращает одно
значение.

Два поведения, о которых стоит знать:

- **Двойной клик и Enter в множественном режиме отмечают строку, а не закрывают
  диалог.** Иначе подбор пачки завершался бы на первой же строке — то есть ровно
  тогда, когда он и нужен.
- **Отметки переживают перелистывание**, а `checked` хранит строки целиком — поэтому
  в ответе есть `label` для каждого id, включая строки с других страниц.

В подклассе пикера не меняется ничего: `multiple` приходит свойством.

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
