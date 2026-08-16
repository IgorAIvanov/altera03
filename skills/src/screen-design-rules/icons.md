<!-- ⚠ ЗГЕНЕРОВАНО `deno task skills:build` — НЕ РЕДАГУВАТИ.
     Джерело: client/ui-kit/icons.ts -->

# Icon set

Every glyph the framework ships, by name. Import once and use by key:

```ts
import { icons } from "@client/ui-kit/icons.ts";
…
html`<button class="btn btn-sm">${icons.print} ${t("common.print")}</button>`
```

Do not hand-write an `<svg>` in a screen when the meaning is already here — a copy
stops following the set, and the size token `--icon-size` no longer reaches it.
Sizes come from the theme inside a control and from the glyph's own attributes
outside one; never from Tailwind classes (they may not be generated in shadow DOM).

Descriptions are quoted from the source as they are written there.

## стан запису в списку

| Key | Meaning |
|---|---|
| `icons.recordNew` | Просто введений: чистий лист. |
| `icons.recordPosted` | Проведений: зелена галочка. |
| `icons.recordDeleted` | Позначений на видалення: червоний хрест. |

## запис

| Key | Meaning |
|---|---|
| `icons.save` | Дискета — «Зберегти». |
| `icons.saveClose` | Галочка — «Зберегти й закрити»: дія завершує роботу з формою. |

## документ

| Key | Meaning |
|---|---|
| `icons.post` | Трикутник — «Провести». |
| `icons.unpost` | Стрілка назад — «Скасувати проведення». |
| `icons.movements` | Дві зустрічні стрілки — «Рух документа»: проводки, які документ зробив. |

## список

| Key | Meaning |
|---|---|
| `icons.create` | Плюс — «Створити»: новий запис зі списку. |
| `icons.open` | Олівець на аркуші — «Відкрити» запис на редагування. |
| `icons.delete` | Кошик — «Видалити» або «Позначити на видалення». |
| `icons.undelete` | Перекреслений кошик — «зняти позначку». |
| `icons.toGroup` | Тека зі стрілкою вгору — «До групи…»: перенести запис у групу. |
| `icons.copy` | Два аркуші — «Копіювати»: рядок табличної частини, пункт меню. |

## порядок рядків

| Key | Meaning |
|---|---|
| `icons.moveUp` | Шеврон угору — пересунути рядок вище. |
| `icons.moveDown` | Шеврон униз — пересунути рядок нижче. |
| `icons.moveLeft` | Шеврони «ліворуч»/«праворуч» — той самий крок на сусіда, але по горизонталі: картка дошки переїжджає в сусідню колонку. |
| `icons.moveRight` | Шеврон праворуч — пересунути в наступну колонку. |
| `icons.clear` | Хрестик — «прибрати»: очистити поле (пікер, вибір) і прибрати рядок табличної частини. |

## вивід і запит

| Key | Meaning |
|---|---|
| `icons.print` | Принтер — «Друк». |
| `icons.excel` | Аркуш із хрестом — вивантаження в Excel. |
| `icons.refresh` | Дві кругові стрілки — «Оновити»: перечитати дані. |
| `icons.filter` | Лійка — панель фільтрів. |
| `icons.search` | Лупа в полі пошуку — не кнопка, а прикраса поля, тому приглушена. |
| `icons.import` | Стрілка в лоток — завантажити файл ззовні. |
| `icons.export` | Стрілка з лотка — вивантажити назовні. |
| `icons.add` | Плюс — «Додати»: рядок табличної частини, елемент набору. |
| `icons.data` | Циліндр бази — дані, сховище, службові розділи. |
| `icons.paste` | Планшет із затиском — узяти з буфера обміну. |
| `icons.camera` | Знімок екрана — сеанс зауважень. |
| `icons.expand` | Розгорнути згорнуте вікно. |
| `icons.collapse` | Згорнути вікно в куток. |

## Menu icons are a different set

Navigation icons live in the application's own `app/menu/icons.ts` (Material Design,
filled — a different family from the outlined glyphs above). The database stores only
the key; an administrator picks them visually in the menu editor. Read that file when
you need the keys for a seed.
