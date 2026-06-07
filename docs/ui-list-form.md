# Форма списка (`ModelListBase`)

Руководство для разработчика: как устроена типовая форма списка и как добавить новую за пару минут.

> Это документация для человека. Параллельный инструктаж для AI-агента — в skill
> [`model-list-form`](../.github/skills/model-list-form/SKILL.md). Держите оба в синхроне.

---

## Зачем

Списков в системе будет много (банки, контрагенты, номенклатура, документы…),
и все они выглядят и ведут себя одинаково: тулбар с иконками, поиск, серверная
сортировка по колонкам, пагинация, выделение строки, удаление.

Чтобы не копировать ~200 строк разметки и логики в каждую форму, вся механика
вынесена в базовый класс **`ModelListBase`**
(`client/ui-kit/base/model-list-base.ts`). Конкретная форма — это тонкий
подкласс, который объявляет только то, что уникально: модель, маршрут
редактирования и набор колонок.

```
┌─────────────────────────────────────────────┐
│ ModelListBase<Row>   (client/ui-kit/base)    │  ← вся логика и вёрстка
│   load · sort · paginate · search · select   │
│   delete · model.changed · render()          │
└───────────────────▲─────────────────────────┘
                    │ extends
        ┌───────────┴───────────┐
   BankList                 ContractorList   …   ← только model + columns
   (17 строк)               (≈17 строк)
```

---

## Быстрый старт: новая форма за 5 шагов

Допустим, добавляем список контрагентов (`contractor`).

**1. Тип строки** берётся из TypeBox-схемы модели (см.
[`typebox-model-schema`](../.github/skills/typebox-model-schema/SKILL.md)).
Руками интерфейс строки не пишем:

```ts
// contractor.schema.ts уже содержит:
export type ContractorRow = Static<typeof ContractorRowSchema>;
```

**2. Файл `contractorList.ts`** — это весь экран:

```ts
import { customElement } from "lit/decorators.js";
import { ModelListBase, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { ContractorRow } from "./contractor.schema.ts";

export const tagName = "contractor-list";

@customElement(tagName)
export class ContractorList extends ModelListBase<ContractorRow> {
  protected model = "contractor";
  protected editRoute = "catalog/contractor/edit";
  protected defaultSortBy = "name";

  protected columns: ListColumn<ContractorRow>[] = [
    { key: "code", title: "common.code", width: "8rem", sortable: true },
    { key: "name", title: "common.name", sortable: true },
    { key: "edrpou", title: "contractor.edrpou", width: "9rem", muted: true, sortable: true },
  ];
}
```

**3. SQL-функция `list`** должна принимать `sortBy` для каждой `sortable`-колонки
(белый список внутри функции) — см.
[`db-function-contract`](../.github/skills/db-function-contract/SKILL.md).

**4. Ключи заголовков** добавить в локали (`client/_locales/*.json` для общих,
`app/_locales/*.json` для специфичных модели).

**5. Маршрут** объявляется в `manifest.json` модели как обычно.

Готово. `render()`, `static styles`, загрузку и пагинацию писать **не нужно**.

---

## Что делает база автоматически

| Возможность            | Поведение                                                      |
|------------------------|----------------------------------------------------------------|
| Загрузка               | `bus.request("data.load", { model, command:"list", payload })` |
| Поиск                  | поле в тулбаре, debounce 300 мс, поле `search` в payload        |
| Сортировка             | клик по заголовку → `sortBy`/`sortDir` на сервер, повторный клик меняет направление |
| Пагинация              | подвал: «‹ › » «», номер страницы, выбор размера (10/20/50/100) |
| Выделение строки       | одиночный клик — подсветка; кнопки «Открыть»/«Удалить» активируются |
| Открытие               | двойной клик или «Открыть» → `tab.open` на `editRoute`          |
| Создание               | «+ Создать» → `editRoute` с `id: null`                          |
| Удаление               | «Удалить» → `confirm` → команда `delete`                        |
| Автообновление         | подписка на `model.changed` — список перезагружается после сохранения в любой форме |
| Индикатор загрузки     | глобальная полоска под таб-баром (см. `tab-controller`); свой спиннер — только на самой первой загрузке |

---

## Колонки — `ListColumn`

| Поле       | Назначение                                                            |
|------------|----------------------------------------------------------------------|
| `key`      | Ключ поля в строке **и** значение `sortBy` для сервера.               |
| `title`    | Ключ локализации (`"common.code"`) или литерал — проходит через `t()`.|
| `width`    | Ширина CSS, напр. `"8rem"`. Без значения — гибкая (растягивается) колонка. |
| `align`    | `"left"` (по умолч.) \| `"right"` \| `"center"`.                     |
| `overflow` | `"wrap"` (по умолч.) \| `"nowrap"` \| `"ellipsis"`. `ellipsis` обрезает с `…`, требует `width`. |
| `muted`    | `true` → приглушённый текст для вторичных данных (коды, даты).        |
| `sortable` | `true` → заголовок кликабельный, сортирует на сервере.                |
| `tooltip`  | `(row) => string` — нативный tooltip ячейки (атрибут `title`).       |
| `render`   | `(row) => TemplateResult \| string` — кастомная ячейка (кнопки, бейджи, две строки, форматированные даты, метки пикеров). |

> ⚠️ **`width` задавайте CSS-значением, а не Tailwind-классом `w-32`.**
> Динамические Tailwind-классы не доезжают в Shadow DOM этих компонентов
> (JIT не видит их при сборке). Inline-ширина (`width:8rem`) работает всегда.

Пример кастомной ячейки:

```ts
{
  key: "status",
  title: "doc.status",
  width: "7rem",
  render: (row) => html`<span class="badge ${row.posted ? "badge-success" : ""}">
    ${row.posted ? "Проведён" : "Черновик"}
  </span>`,
}
```

---

## Точки расширения (override)

Для нестандартных форм база даёт швы — переопределяйте только нужное:

| Член / хук                          | Когда нужен                                                |
|-------------------------------------|------------------------------------------------------------|
| `defaultSortBy` / `defaultSortDir`  | Начальная сортировка (по умолчанию — первая колонка, asc). |
| `pageSizeOptions`                   | Свой набор размеров страницы вместо `[10,20,50,100]`.       |
| `listCommand`                       | Нестандартная команда вместо `"list"`.                     |
| `rowLabel(row)`                     | Текст в диалоге удаления (по умолч. `row.name`).            |
| `rowClass(row)`                     | Доп. CSS-классы строки.                                    |
| `rowStyle(row)`                     | Inline-стиль строки (цвет текста/фона). Применяется к каждой `<td>` (перебивает zebra; выделение приоритетнее). Напр. `row.isActive === false ? "color:#9ca3af" : ""`. |
| `onActivate(row)`                   | Действие по двойному клику (по умолч. — открыть edit).     |
| `extraPayload()`                    | Доп. поля в payload — **шов для панели фильтров**.         |
| `renderToolbarExtra()`              | Доп. кнопки тулбара между стандартными действиями и поиском.|
| `renderHeaderArea()`                | Полноширинная зона под тулбаром — **шов для панели фильтров / навигации по группам**. |

---

## Богатые ячейки

`render` колонки возвращает любой Lit-контент. Два helper'а из
`model-list-base.ts` закрывают типовые задачи, а `this.t(...)` доступен в `render`.

```ts
import { html } from "lit";
import { ModelListBase, stopRow, twoLine, type ListColumn }
  from "@client/ui-kit/base/model-list-base.ts";

// Кнопка в ячейке — обработчик через stopRow, чтобы клик не выделял строку:
{ key: "_act", title: "", width: "3rem", align: "center",
  render: (row) => html`<button class="btn btn-ghost btn-xs"
    title=${this.t("common.open")}
    @click=${stopRow(() => this.openEdit(row.id))}>✎</button>` }

// Бейдж / отметка:
{ key: "status", title: "doc.status", width: "7rem",
  render: (row) => html`<span class="badge ${row.posted ? "badge-success" : "badge-ghost"}">
    ${row.posted ? "Проведён" : "Черновик"}</span>` }

// Две строки в ячейке:
{ key: "name", title: "common.name", render: (row) => twoLine(row.name, row.edrpou) }
```

- **Цвет строки** — override `rowStyle(row)`.
- **Tooltip** — поле `tooltip` колонки или `title=` внутри `render`.

> ⚠️ Кнопки в ячейке всегда оборачивайте обработчик в `stopRow(...)` —
> иначе клик «протекает» в строку и выделяет/открывает её.

## Будущие варианты

Их планируется строить тем же приёмом — как родственные базовые классы или через швы:

### Список документов с отборами (фильтрами)

Документам мало поиска — нужны отборы по периоду, контрагенту, статусу.
Реализуется поверх существующей базы:

```ts
export class InvoiceList extends ModelListBase<InvoiceRow> {
  @state() private filterStatus = "";

  protected renderHeaderArea() {
    return html`<div class="flex gap-2 p-2 border-b border-base-300">
      <!-- селекты/пикеры фильтров; по изменению → this.reload() -->
    </div>`;
  }

  protected extraPayload() {
    return { status: this.filterStatus || undefined };
  }
}
```

`extraPayload()` подмешивается в payload команды `list`, а `reload()`
перезагружает с первой страницы.

### Каталог с группами (дерево + элементы)

Двухпанельный макет (дерево групп слева + список элементов справа) —
это **отдельный** будущий базовый класс `ModelTreeListBase`, а не нагрузка
на `ModelListBase`. Он переиспользует те же соглашения по колонкам,
выделению и пагинации, описанные здесь.

---

## Связанные системные решения

При построении формы попутно зафиксированы общие правила (полезно знать):

- **CSS-переменные темы в Shadow DOM.** Тема daisyUI объявлена в
  `client/styles/tailwind.css` под `[data-theme="1c"], :root, :host` — добавленный
  `:host` нужен, чтобы `var(--color-primary)` и др. резолвились внутри Shadow DOM.
  Без него `bg-primary`, выделение строки и пр. оказываются прозрачными.
- **Подсветка выделенной строки** — правило `tr.selected td { … !important }`
  в `static styles` базы. Красить нужно именно `td`, а не `tr`: `table-zebra`
  ставит фон на `<td>` чётных строк, который иначе перекрывает фон строки
  (белый текст на светлом фоне → невидим). Inline-стиль не годится — нет
  приоритета над `table-zebra`.
- **`<select>` с динамическими `<option>`** — выбранный пункт помечается
  `?selected=${...}`, а не байндингом `.value` на самом `<select>`
  (Lit не успевает применить `.value` до появления опций).

---

## Файлы

| Файл                                          | Роль                          |
|-----------------------------------------------|-------------------------------|
| `client/ui-kit/base/model-list-base.ts`       | Базовый класс `ModelListBase` |
| `app/catalog/bank/bankList.ts`                | Эталонная форма (17 строк)    |
| `app/catalog/bank/bank.schema.ts`             | TypeBox-схема, источник `Row` |
| `.github/skills/model-list-form/SKILL.md`     | Инструктаж для AI-агента      |
