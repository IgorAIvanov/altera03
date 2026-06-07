---
name: lit
description: >
  Rules and patterns for writing Lit Web Components correctly in this project.
  Trigger this skill whenever writing or editing any Lit component (.ts files with
  @customElement, @property, LitElement, html``, css``), when adding new properties
  to existing components, or when debugging why an attribute isn't working from HTML.
  Always use this skill before writing any @property decorator — getting the attribute
  name wrong is a silent bug that's very hard to trace.
---

# Lit Web Components — правила цього проекту

## Критичне правило: атрибути camelCase → kebab-case

**Проблема:** Lit за замовчуванням перетворює camelCase назви властивостей на lowercase без дефісів:
- `showClear` → атрибут `showclear` (НЕ `show-clear`)
- `displayField` → атрибут `displayfield` (НЕ `display-field`)
- `listSize` → атрибут `listsize` (НЕ `list-size`)

Це мовчазна помилка — компонент просто ігнорує атрибут, без попереджень.

**Рішення:** Для будь-якої camelCase властивості завжди вказувати `attribute` явно:

```ts
// Правильно
@property({ type: String, attribute: "label-position" }) labelPosition: "top" | "left" = "top";
@property({ type: Boolean, attribute: "show-clear" }) showClear = false;
@property({ type: Number, attribute: "list-size" }) listSize = 10;
@property({ type: String, attribute: "display-field" }) displayField = "name";
@property({ type: String, attribute: "id-field" }) idField = "id";
@property({ type: Object, attribute: "picker-params" }) pickerParams = {};
@property({ type: Object, attribute: "fetch-params" }) fetchParams = {};
@property({ type: String, attribute: "display-value" }) displayValue = "";
@property({ type: String, attribute: "selected-id" }) selectedId = "";

// Однословні — attribute не потрібний (lowercase вже збігається)
@property({ type: String }) label = "";
@property({ type: String }) placeholder = "";
@property({ type: Boolean }) disabled = false;
@property({ type: String }) url = "";
@property({ type: String }) width = "";
@property({ type: Boolean }) visible = true;
```

**Правило:** якщо назва властивості містить велику літеру — обов'язково додай `attribute: "kebab-case-name"`.

## Boolean атрибути в Lit-шаблонах

Для boolean властивостей використовувати `?` прив'язку:

```ts
// Правильно
html`<ui-picker ?show-clear=${this.readonly}></ui-picker>`
html`<button ?disabled=${!this.canSave}>Зберегти</button>`

// Неправильно — передає рядок "show-clear", не true/false
html`<ui-picker show-clear></ui-picker>`
```

Виняток: статичний boolean атрибут без виразу (завжди true) — можна без `?`:
```ts
html`<input required>`  // OK — завжди true
```

## Shadow DOM та Tailwind CSS

Компоненти, що наслідують `GlobalStyledLitElement`, отримують весь `tailwind.css` через `unsafeCSS`.  
Але Tailwind генерує тільки класи, що використовуються у файлах зі списку `@source`.

Якщо додаєш Tailwind-класи в новий каталог — додай `@source` до `client/styles/tailwind.css`:
```css
@source "../../app";
@source "../../client";   /* ← вже додано */
```

Якщо клас не генерується — перевір `@source` першим чином, до будь-яких інших рішень.

## Базові класи компонентів

| Клас | Де використовувати |
|------|-------------------|
| `GlobalStyledLitElement` | Компоненти ui-kit, що потребують Tailwind + daisyUI |
| `LitElement` | Компоненти зі своїми `static styles = css\`...\`` |

`GlobalStyledLitElement` живе в `client/ui-kit/base/gsle.ts`.

## Структура нового компонента

```ts
import { GlobalStyledLitElement } from "../base/gsle.ts";
import { html } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";

@customElement("ui-my-component")
export class UiMyComponent extends GlobalStyledLitElement {
  // Однословні — attribute не потрібний
  @property({ type: String }) label = "";
  @property({ type: Boolean }) disabled = false;

  // camelCase — ОБОВ'ЯЗКОВО вказувати attribute
  @property({ type: String, attribute: "display-field" }) displayField = "name";
  @property({ type: Boolean, attribute: "show-icon" }) showIcon = false;

  override render() {
    return html`...`;
  }
}
```

## Checklist при додаванні нової @property

- [ ] Назва camelCase? → додай `attribute: "kebab-case"`
- [ ] Boolean? → у шаблонах використовуй `?attr-name=${value}`
- [ ] Оновив документацію (`.md` файл компонента) з правильними іменами атрибутів?
- [ ] Tailwind-класи з нового каталогу? → перевір `@source` у `tailwind.css`
