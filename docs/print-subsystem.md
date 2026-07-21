# Підсистема друку

Друк — частина **ядра**. Застосунок про рендер нічого не знає: у `app/` живе лише
опис друкованої форми в `manifest.json` та сам файл шаблону.

Клієнт теж нічого не рендерить. Він викликає команду моделі, а сервер бере дані,
бере шаблон, малює PDF і повертає готовий файл.

## Розкладка по файлах

| Де | Що |
| --- | --- |
| [`server/modules/print/print-template.ts`](../server/modules/print/print-template.ts) | формат шаблону: типи блоків, нормалізація «сирого» JSON, резолвінг шляхів |
| [`server/modules/print/print-render-plan.ts`](../server/modules/print/print-render-plan.ts) | шаблон + дані → плаский план блоків із підставленими значеннями |
| [`server/modules/print/print-pdf.renderer.ts`](../server/modules/print/print-pdf.renderer.ts) | малювання плану в PDF (pdf-lib). Чистий рендер: без БД і без знання про моделі |
| [`server/modules/print/print.handlers.ts`](../server/modules/print/print.handlers.ts) | рантайм-команди `runtime.printPdf` і `runtime.printPreview` |
| [`app/_sqlinit/print_template/db/`](../app/_sqlinit/print_template/db) | таблиця `app.print_template` + `print_template_resolve` — те, без чого ядро не працює |
| `app/<family>/<model>/manifest.json` | опис друкованої форми моделі |
| `app/<family>/<model>/prints/*.template.json` | файл шаблону |
| [`app/admin/print_template/`](../app/admin/print_template) | звичайна admin-модель: CRUD-SQL, список і редактор шаблонів |

## Як модель отримує друк

```json
{
  "prints": {
    "invoice_default": {
      "templateFile": "./prints/invoice_default.template.json",
      "dataCommand": "printData"
    }
  },
  "commands": {
    "sql": { "printData": "invoice_print_data" },
    "ts":  { "printPdf": { "handlerKey": "runtime.printPdf" } }
  }
}
```

`handlerKey` — ключ готового хендлера ядра. Застосунок не знає шляхів усередині
`server/`: ключ резолвиться реєстром
([`model-registry.ts`](../server/modules/model-runtime/model-registry.ts)).

Далі — SQL-команда даних (`app.<model>_print_data`), файл шаблону в `prints/`,
`deno task sql:registry && deno task sql:assemble && deno task sql:publish`.

У формі редагування кнопка друку викликає команду `printPdf` з `{ id }`, бере
`data.extra.pdfBase64` і відкриває blob у новій вкладці. Еталон — `printPdf()`
у [`invoiceEdit.ts`](../app/document/invoice/invoiceEdit.ts).

## Контракт даних

Рендерер читає **один корінь** — `data.item` відповіді команди, названої в
шаблоні полем `dataCommand`. Прив'язки — крапкові шляхи від цього кореня:

- скалярне поле (`field-list`): повний шлях, напр. `document.counterpartyName`;
- `source` таблиці: повний шлях до масиву, напр. `document.lines`;
- `path` колонки: шлях **усередині одного рядка** масиву, напр. `name`
  (а не `document.lines.name`).

Команда даних має повертати вже денормалізований payload: назви замість id,
пораховані суми, дати й гроші — рядками. Еталон — `app.invoice_print_data`
у [`invoice.custom.sql`](../app/document/invoice/db/invoice.custom.sql).

## Формат шаблону

Типи блоків: `text`, `field-list`, `table`, `image`, `horizontal-line`,
`vertical-line`.

Розкладка абсолютна: `placement` задає `xPercent`/`yPercent`/`widthPercent`/
`heightPercent` у відсотках від області друку (A4 мінус поля 40pt). Числа
зберігаються рядками — щоб поле форми не «стрибало» під час набору; у числа їх
перетворює `resolvePrintTemplateBlockPlacement`.

## Джерело правди шаблону в рантаймі

Рантайм читає шаблони **тільки з `app.print_template`** — жодних файлів шаблонів
на диску. Файли в `prints/` — це вихідний код системних шаблонів; `sql:assemble`
перетворює їх на `insert ... on conflict (code) do nothing`, тож відредагований
користувачем шаблон публікацією не затирається.

Підбір шаблону — `app.print_template_resolve`: явно вказаний `templateCode`,
інакше шаблон із `is_default`, інакше найсвіжіший активний.

## Редактор

`admin/print_template/edit` — звичайна admin-форма: реквізити шаблону, список
блоків, панель властивостей вибраного блока і прев'ю.

Прев'ю малює **ядро**: редактор шле чернетку шаблону разом із даними в команду
`preview` (`runtime.printPreview`) і показує повернутий PDF в `<iframe>`. Тому
прев'ю не може розійтися з друком — це той самий рендерер. Перемальовується
через 0,7 с після останньої правки або кнопкою «Оновити».

Щоб з'явилися шляхи для прив'язки полів, у панелі «Дані прев'ю» вкажіть payload
(напр. `{ "id": "1" }`) і натисніть «Завантажити дані» — редактор виконає ту саму
команду, що потім виконає рантайм друку, і побудує список шляхів із відповіді.

Позиція та розмір блока задаються числами. Перетягування мишею не реалізоване.
