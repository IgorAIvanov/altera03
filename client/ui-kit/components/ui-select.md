# `<ui-select>` — вибір зі сталого набору

Контрол для TypeBox-перелічень: у моделі зберігається машинний код `value`,
а користувач бачить локалізований `label`. Якщо користувач має сам додавати
варіанти, це вже довідник і для нього потрібен `<ui-picker>`.

```ts
import "@client/ui-kit/components/ui-select.ts";

const partyTypes = [
  { value: "legal_entity", label: t("counterparty.typeLegalEntity") },
  { value: "individual", label: t("counterparty.typeIndividual") },
  { value: "fop", label: t("counterparty.typeFop") },
];

html`
  <ui-select
    .value=${item.partyType}
    .options=${partyTypes}
    placeholder=${t("common.select")}
    @value-changed=${(e: CustomEvent<{ value: string }>) =>
      this.setField("partyType", e.detail.value)}
  ></ui-select>
`;
```

## Властивості

| Властивість | Тип | Типово | Опис |
|---|---|---|---|
| `value` | string | `""` | Обраний машинний код |
| `options` | `UiSelectOption[]` | `[]` | Варіанти `{ value, label, disabled? }`; передавати властивістю `.options` |
| `placeholder` | string | `""` | Текст необраної опції; порожнє значення її не додає |
| `label` | string | `""` | Підпис поля |
| `label-position` | `top` \| `left` | `top` | Розташування підпису |
| `required` | boolean | `false` | Малює зірочку біля підпису |
| `disabled` / `readonly` | boolean | `false` | Блокує зміну значення |
| `size` | `xs` \| `sm` \| `md` \| `lg` | `""` | Розмір daisyUI select |
| `width` | string | `""` | CSS-ширина обгортки |
| `cell` | boolean | `false` | Режим комірки табличної частини |
| `visible` | boolean | `true` | Приховує контрол повністю |

## Подія

`value-changed` виникає при зміні вибору й має `detail.value` з новим кодом.

```ts
html`<ui-select cell .value=${line.kind} .options=${lineKinds}
  @value-changed=${(e: CustomEvent<{ value: string }>) =>
    this.setLine(index, { kind: e.detail.value })}></ui-select>`
```