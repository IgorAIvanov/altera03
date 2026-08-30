# ui-picker

Компонент поля вибору з автодоповненням і кнопкою відкриття picker-діалогу.

## Використання

```html
<ui-picker
  url="catalog/bank"
  label="Банк"
  placeholder="Введіть назву..."
  show-clear
  .value=${item.bank ?? null}
  @value-changed=${(e) => this.setRef("bank", e.detail.value)}
></ui-picker>
```

**Значення — об'єкт**, як його віддає база: `{ id, name }`. Той самий, що
приходить у `get`, у рядку списку й в эху фільтра, — жодного розбирання на id
і підпис.

## Властивості

| Властивість | Атрибут | Тип | За замовч. | Опис |
|---|---|---|---|---|
| `label` | `label` | `string` | `""` | Підпис поля |
| `labelPosition` | `label-position` | `"top" \| "left"` | `"top"` | Положення підпису — зверху або зліва |
| `placeholder` | `placeholder` | `string` | `""` | Підказка в полі введення |
| `url` | `url` | `string` | `""` | Базовий шлях моделі, наприклад `catalog/bank` |
| `picker` | `picker` | `string` | `"picker"` | Вʼю для picker-діалогу. Відкривається через `bus.pick("{url}/{picker}")` |
| `displayField` | `display-field` | `string` | `"name"` | Поле з рядків відповіді, яке виводиться як текст |
| `idField` | `id-field` | `string` | `"id"` | Поле з рядків відповіді, яке зберігається як ідентифікатор |
| `listSize` | `list-size` | `number` | `10` | Максимальна кількість видимих рядків у dropdown |
| `showClear` | `show-clear` | `boolean` | `false` | Показувати кнопку очищення поля |
| `fetchParams` | `fetch-params` | `object` | `{}` | Додаткові параметри, що додаються до тіла fetch-запиту |
| `pickerParams` | `picker-params` | `object` | `{}` | Параметри діалогу — «відкрий його ось так». Ключ `filters` у них діалог бере за ПОЧАТКОВИЙ стан своєї панелі відборів, і людина його правитиме |
| `value` | — | `{id, …} \| null` | `null` | Вибрана ссылка цілком: ключ і підпис в одному об'єкті |
| `filters` | — | `object \| null` | `null` | Чим форма ЗВУЖУЄ перелік — і випадний список, і діалог; зняти його людина не може. Ключі — оголошені `x-filter` моделі |
| `width` | `width` | `string` | `""` | Ширина компонента, будь-яке CSS-значення (`200px`, `100%`). Без значення — займає доступний простір |
| `disabled` | `disabled` | `boolean` | `false` | Блокує поле введення та всі кнопки |
| `visible` | `visible` | `boolean` | `true` | Приховує компонент (`false` → порожній шаблон, місце не займає) |
| `required` | `required` | `boolean` | `false` | Малює зірочку біля підпису: `?required=${this.isRequired("counterparty")}` |
| `invalid` | `invalid` | `string` | `""` | Текст помилки: рамка червона + підпис під контролом. `.invalid=${this.fieldError("counterparty")}` — див. [ui-form-validation.md](../../../docs/ui-form-validation.md) |

## Події

| Подія | `e.detail` | Опис |
|---|---|---|
| `value-changed` | `{ value }` | Вибрано запис або очищено поле (`value === null`). Ім'я те саме, що в `ui-date` і `ui-decimal` |

## Як працює автодоповнення

При введенні тексту компонент робить `POST /api/model/{model}/{fetch}` з тілом:
```json
{ "search": "введений текст", ...fetchParams }
```
Очікує відповідь формату:
```json
{ "ok": true, "data": { "rows": [{ "id": "1", "name": "..." }] } }
```
Dropdown позиціонується через JS (`getBoundingClientRect`): за замовчуванням
під полем, а коли місця внизу бракує — над ним. Висота обмежується доступним
простором, тож довгий список лишається прокручуваним.  
Закривається по `Esc` або кліку поза списком (Popover API).

Коли список відкритий, перший `↑` / `↓` переносить фокус із поля вводу на
останній / перший пункт списку; наступні стрілки змінюють активний варіант.
`Enter` його вибирає, а `Esc` закриває список. Активний рядок автоматично
прокручується у видиму область.

## Як працює picker-діалог

Кнопка 🔍 відкриває picker через `bus.pick("{url}/{picker}", params)`.
Picker-вʼю повинне викликати `bus.emit({ type: "picker.select", callbackId, value: { id, label } })` для підтвердження вибору.

### Два канали відбору в діалог — і вони означають РІЗНЕ

| Звідки | Куди приходить | Що означає |
|---|---|---|
| `filters` | `params.lockedFilters` | Звуження формою. Діалог накладає його ПОВЕРХ панелі, тож «Скинути» його не знімає, а панель не показує |
| `pickerParams.filters` | `params.filters` | Початковий стан панелі діалогу (`ModelPickerBase.defaultFilters()`). Людина правитиме, «Скинути» повертає сюди |

Приклад: документ підставляє в діалог свій вид звіту й кінець періоду, але
подати уточнення за старий період не забороняє —

```html
<ui-picker url="catalog/report_form_version"
  .pickerParams=${{ filters: { form: this.$root.item.form, date: this.periodEnd } }}>
</ui-picker>
```

а «рахунки лише цієї організації» — навпаки, зняти не можна:

```html
<ui-picker url="catalog/bank_account" .filters=${{ organization: orgId }}></ui-picker>
```

### Діалог із діалога

Пікер у тулбарі діалога — звичайна вкладеність: `picker-host` тримає вікна
СТЕКОМ, вибір у верхньому повертається тому, хто його відкрив, а нижнє лишається
на місці зі своїм станом. Enter у вкладеному контролі до діалога не доходить
(інакше він підтверджував би вибір рядка, що стоїть під курсором), а Escape
доходить — коли вкладеному контролу нема чого закривати.

## Часті помилки

### `url` — це маршрут вʼю, а не API-шлях

```html
<ui-picker url="catalog/bank">                  <!-- ✅ -->
<ui-picker url="/api/model/bank">               <!-- ❌ мовчки не працює -->
```

`url` має формат `family/model` (як у `view-manifest`), бо з нього збирається **маршрут вʼю**
`"{url}/{picker}"` → `catalog/bank/picker`. `picker-host` розбирає його як `module/model/view`
і резолвить через `/api/view/catalog/bank/picker`.

Якщо передати API-шлях `/api/model/bank`, то:
- 🔍 покличе `bus.pick("/api/model/bank/picker")` → після `split("/")` вийде
  `module=""`, `model="api"`, `view="model"` → `[picker-host] view не знайдено`, діалог не відкриється;
- автодоповнення піде на `/api/model/bank/lookup` з невідомим іменем моделі.

Ім'я моделі для API компонент бере окремо — останнім сегментом `url`, тож `catalog/bank` коректно
дає `/api/model/bank/...`.

### Поле порожнє, хоча `get` значення повертає

Значить, форма передала не той об'єкт: пікер показує `value[displayField]`, а
`displayField` за замовчуванням `name`. Довантажувати підпис компонент не буде —
він уже приїхав разом із даними: `x-ref` кладе в кожну відповідь вкладений
`{ id, name }`.

```html
<ui-picker url="catalog/currency"
  .value=${item.currency ?? null}                 <!-- ✅ об'єкт цілком -->
  @value-changed=${(e) => this.setRef("currency", e.detail.value)}
></ui-picker>
```

`BaseUI.setRef()` пише і сам об'єкт, і `<name>Id` — розсинхронити їх нема як.
Доти форма тримала пару прив'язок (`selected-id` + `display-value`), і забути
можна було будь-яку: на екрані порожньо, симптом «дані не прийшли», причина за
три шари.

### Звузити перелік: `filters`

Рахунки цієї організації, договори цього контрагента, номенклатура цього складу —
відбір задає ФОРМА, і зняти його користувач не може (на відміну від фільтрів
списку, які задає він сам панеллю):

```html
<ui-picker url="catalog/bank_account"
  .filters=${{ organizationId: item.organizationId }}
  .value=${item.bankAccount ?? null}
  @value-changed=${(e) => this.setRef("bankAccount", e.detail.value)}
></ui-picker>
```

Одна властивість веде обидва шляхи вибору — випадний список і діалог 🔍. Підбір,
звужений в одному й повний у другому, гірший за незвужений: помилку в ньому не
видно.

Ключі — це оголошені в схемі моделі `x-filter` (ті самі, що й у списку).
**Невідомий ключ підбір ВІДХИЛЯЄ**, а не ігнорує: форма, яка звузила перелік,
вважає, що звузила його, і мовчазна друкарська помилка лишила б на екрані повний
перелік без жодного сліду. Модель, яка фільтрів не оголошує, відмовляє на
будь-якому наборі — з тієї самої причини.

### Команда автодоповнення

Завжди `lookup` — саме її дає генератор CRUD. Налаштування імені прибрано:
моделі з іншою назвою підбору не існує, а атрибут лише дозволяв помилитися
(умовчанням колись стояло `fetch`, і воно не працювало ні в кого — випадаючий
список лишався порожнім без видимої помилки).

## Приклади

```html
<!-- Підпис зверху, кнопка очищення -->
<ui-picker
  url="catalog/bank"
  label="Банк"
  show-clear
  width="320px"
  .value=${item.bank ?? null}
  @value-changed=${(e) => this.setRef("bank", e.detail.value)}
></ui-picker>

<!-- Фільтр списку чи звіту: значення фільтра вже об'єкт -->
<ui-picker
  url="catalog/counterparty"
  .value=${this.filterValue("counterparty") ?? null}
  @value-changed=${(e) => this.setFilter("counterparty", e.detail.value)}
></ui-picker>

<!-- Підпис зліва, заблоковано -->
<ui-picker
  url="catalog/bank"
  label="Банк"
  label-position="left"
  ?disabled=${this.readonly}
></ui-picker>
```
