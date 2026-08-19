/**
 * Підпорядкований регістр — правила, у яких помиляються тихо.
 *
 * Проба не чіпає ані шину, ані DOM: перевіряються рівно ті три рішення, ціна
 * помилки в яких — не падіння, а неправильний екран. Відбір за іменем ПОЛЯ
 * замість імені ссылки дає «невідомий фільтр» або (гірше) рядки всіх власників;
 * панель, увімкнена на незбереженій картці, чіпляє рядки нема до чого; правка
 * рядка, поставленого документом, зникає при першому ж перепроведенні.
 */
import { assertEquals } from "@std/assert";
import type { ReactiveControllerHost } from "lit";
import {
  ownerFilterKeyOf,
  rowLockedByDocument,
  SubordinateRegister,
} from "./subordinate-register.ts";

/** Мінімальний хост: контролеру від нього потрібен лише requestUpdate. */
const host = { requestUpdate: () => {} } as unknown as ReactiveControllerHost;

interface Row extends Record<string, unknown> {
  id: string;
  period: string;
  rate: number;
  documentId?: string | null;
}

function register(ownerId: () => string | null, extra: Record<string, unknown> = {}) {
  return new SubordinateRegister<Row>(host, {
    model: "currency_rate",
    ownerField: "currencyId",
    ownerId,
    columns: [{ key: "period", title: "period" }],
    fields: [
      { kind: "date", key: "period", title: "period", required: true },
      { kind: "decimal", key: "rate", title: "rate" },
    ],
    createRow: () => ({ id: "", period: "", rate: 0 }),
    ...extra,
  });
}

/**
 * Ключ відбору — ІМ'Я ССЫЛКИ, а не поля. Згенерований `_list` читає саме його
 * (`v_filters->'currency'->>'id'`), і промах тут не падає: підбір відповідає
 * «невідомий фільтр», а список моделі без відбору мовчки показує чужі рядки.
 */
Deno.test("ключ відбору виводиться з імені поля", () => {
  assertEquals(ownerFilterKeyOf("currencyId"), "currency");
  assertEquals(ownerFilterKeyOf("organizationId"), "organization");
  assertEquals(ownerFilterKeyOf("nomenclatureId"), "nomenclature");
  // Поле без суфікса лишається собою — конвенція не вгадується, а застосовується.
  assertEquals(ownerFilterKeyOf("owner"), "owner");
  // Явне значення сильніше за виведення: `x-ref.as` могли назвати інакше.
  assertEquals(ownerFilterKeyOf("currencyId", "rateCurrency"), "rateCurrency");
});

/**
 * Рядок, поставлений документом, не правиться з картки: документ переписує свої
 * рядки начисто при перепроведенні, тож правка зникла б МОВЧКИ.
 */
Deno.test("реєстратор блокує рядок", () => {
  assertEquals(rowLockedByDocument({ documentId: "42" }), true);
  assertEquals(rowLockedByDocument({ documentId: "" }), false);
  assertEquals(rowLockedByDocument({ documentId: null }), false);
  assertEquals(rowLockedByDocument({}), false);
});

Deno.test("власне правило блокування перекриває умовчання", () => {
  const reg = register(() => "7", { lockedWhen: (row: Row) => row.rate > 100 });
  assertEquals(reg.locked({ id: "1", period: "", rate: 5 }), false);
  assertEquals(reg.locked({ id: "1", period: "", rate: 500 }), true);
  // Реєстратор при цьому більше ні на що не впливає — правило одне, задане.
  assertEquals(reg.locked({ id: "1", period: "", rate: 5, documentId: "9" }), false);
});

/**
 * У нової картки немає id, і чіпляти до неї рядки нема за що. Панель у такому
 * разі не просто порожня — вона ВИМКНЕНА, і каже про це словами.
 */
Deno.test("незбережена картка: панель не готова, редактор не відкривається", () => {
  const reg = register(() => null);
  assertEquals(reg.ready, false);

  reg.startAdd();
  assertEquals(reg.draft, null, "редактор не має відкриватися без власника");
});

Deno.test("збережена картка: редактор відкривається порожнім рядком", () => {
  const reg = register(() => "7");
  assertEquals(reg.ready, true);

  reg.startAdd();
  assertEquals(reg.draft, { id: "", period: "", rate: 0 });
  assertEquals(reg.editingId, null, "новий рядок не має id");

  reg.cancel();
  assertEquals(reg.draft, null);
});

Deno.test("режим перегляду не дає ані додати, ані правити", () => {
  const reg = register(() => "7", { readonly: () => true });

  reg.startAdd();
  assertEquals(reg.draft, null);

  reg.startEdit({ id: "1", period: "2026-01-01", rate: 41 });
  assertEquals(reg.draft, null);
});

Deno.test("заблокований рядок не відкривається на правку", () => {
  const reg = register(() => "7");

  reg.startEdit({ id: "1", period: "2026-01-01", rate: 41, documentId: "9" });
  assertEquals(reg.draft, null);

  reg.startEdit({ id: "2", period: "2026-01-01", rate: 41 });
  assertEquals(reg.editingId, "2");
});

Deno.test("обов'язкові поля чернетки називаються поіменно", () => {
  const reg = register(() => "7");
  reg.startAdd();

  assertEquals(reg.missingFields(), ["period"]);

  reg.patch("period", "2026-06-01");
  assertEquals(reg.missingFields(), []);
});
