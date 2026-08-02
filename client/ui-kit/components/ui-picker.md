# ui-picker

Компонент поля вибору з автодоповненням і кнопкою відкриття picker-діалогу.

## Використання

```html
<ui-picker
  url="catalog/bank"
  fetch="lookup"
  label="Банк"
  placeholder="Введіть назву..."
  show-clear
  @item-selected=${(e) => console.log(e.detail)}
  @item-cleared=${() => console.log('cleared')}
></ui-picker>
```

## Властивості

| Властивість | Атрибут | Тип | За замовч. | Опис |
|---|---|---|---|---|
| `label` | `label` | `string` | `""` | Підпис поля |
| `labelPosition` | `label-position` | `"top" \| "left"` | `"top"` | Положення підпису — зверху або зліва |
| `placeholder` | `placeholder` | `string` | `""` | Підказка в полі введення |
| `url` | `url` | `string` | `""` | Базовий шлях моделі, наприклад `catalog/bank` |
| `fetch` | `fetch` | `string` | `"fetch"` | Команда для автодоповнення (lookup). POST на `/api/model/{model}/{fetch}` з `{ search }` |
| `picker` | `picker` | `string` | `"picker"` | Вʼю для picker-діалогу. Відкривається через `bus.pick("{url}/{picker}")` |
| `displayField` | `display-field` | `string` | `"name"` | Поле з рядків відповіді, яке виводиться як текст |
| `idField` | `id-field` | `string` | `"id"` | Поле з рядків відповіді, яке зберігається як ідентифікатор |
| `listSize` | `list-size` | `number` | `10` | Максимальна кількість видимих рядків у dropdown |
| `showClear` | `show-clear` | `boolean` | `false` | Показувати кнопку очищення поля |
| `fetchParams` | `fetch-params` | `object` | `{}` | Додаткові параметри, що додаються до тіла fetch-запиту |
| `pickerParams` | `picker-params` | `object` | `{}` | Параметри, що передаються у picker-діалог |
| `displayValue` | `display-value` | `string` | `""` | Поточний текст у полі (читання / встановлення зовні) |
| `selectedId` | `selected-id` | `string` | `""` | Поточний вибраний id (читання / встановлення зовні) |
| `width` | `width` | `string` | `""` | Ширина компонента, будь-яке CSS-значення (`200px`, `100%`). Без значення — займає доступний простір |
| `disabled` | `disabled` | `boolean` | `false` | Блокує поле введення та всі кнопки |
| `visible` | `visible` | `boolean` | `true` | Приховує компонент (`false` → порожній шаблон, місце не займає) |

## Події

| Подія | `e.detail` | Опис |
|---|---|---|
| `item-selected` | `{ id, label, item }` | Користувач вибрав запис — з dropdown або через picker-діалог |
| `item-cleared` | — | Користувач натиснув кнопку очищення |

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

Кнопка 🔍 відкриває picker через `bus.pick("{url}/{picker}", pickerParams)`.  
Picker-вʼю повинне викликати `bus.emit({ type: "picker.select", callbackId, value: { id, label } })` для підтвердження вибору.

## Часті помилки

### `url` — це маршрут вʼю, а не API-шлях

```html
<ui-picker url="catalog/bank" fetch="lookup">   <!-- ✅ -->
<ui-picker url="/api/model/bank">               <!-- ❌ мовчки не працює -->
```

`url` має формат `family/model` (як у `view-manifest`), бо з нього збирається **маршрут вʼю**
`"{url}/{picker}"` → `catalog/bank/picker`. `picker-host` розбирає його як `module/model/view`
і резолвить через `/api/view/catalog/bank/picker`.

Якщо передати API-шлях `/api/model/bank`, то:
- 🔍 покличе `bus.pick("/api/model/bank/picker")` → після `split("/")` вийде
  `module=""`, `model="api"`, `view="model"` → `[picker-host] view не знайдено`, діалог не відкриється;
- автодоповнення піде на `/api/model/bank/fetch`.

Ім'я моделі для API компонент бере окремо — останнім сегментом `url`, тож `catalog/bank` коректно
дає `/api/model/bank/...`.

### `fetch` за замовчуванням — `"fetch"`, а не `"lookup"`

У цьому проєкті команда автодоповнення називається `lookup`, тож **завжди** вказуй `fetch="lookup"`.
Без цього запит піде на неіснуючу команду `{model}_fetch` і випадаючий список буде порожній —
без видимої помилки у формі.

## Приклади

```html
<!-- Підпис зверху, кнопка очищення -->
<ui-picker
  url="catalog/bank"
  fetch="lookup"
  label="Банк"
  show-clear
  width="320px"
  @item-selected=${(e) => { this.bankId = e.detail.id; }}
></ui-picker>

<!-- Підпис зліва, заблоковано -->
<ui-picker
  url="catalog/bank"
  fetch="lookup"
  label="Банк"
  label-position="left"
  ?disabled=${this.readonly}
></ui-picker>

<!-- Прихований -->
<ui-picker
  url="catalog/bank"
  fetch="lookup"
  ?visible=${this.showBank}
></ui-picker>
```
