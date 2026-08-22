/// <reference lib="deno.ns" />
/**
 * Проби періодів: `deno task test:unit`.
 *
 * Директива вгорі — як у table-model_test.ts: `client/` — браузерна бібліотека,
 * `deno.ns` дозволений лише файлам із пробами.
 *
 * `periodLabel` для місяця/кварталу тут не перевіряється: підпис тягне локаль
 * (Intl + t()), а в пробі словники не завантажені. Календарна арифметика —
 * саме те, що ламається тихо: зсув «31 січня → лютий» або квартал, що почав
 * рахуватися з нуля.
 */
import { assertEquals } from "@std/assert";
import { parsePeriodUnits, periodLabel, periodOf, periodUnit, shiftPeriod } from "./period.ts";

Deno.test("periodOf: календарні межі", () => {
  assertEquals(periodOf("day", "2026-07-20"), { dateFrom: "2026-07-20", dateTo: "2026-07-20" });
  // 2026-07-20 — понеділок
  assertEquals(periodOf("week", "2026-07-22"), { dateFrom: "2026-07-20", dateTo: "2026-07-26" });
  assertEquals(periodOf("month", "2026-02-10"), { dateFrom: "2026-02-01", dateTo: "2026-02-28" });
  assertEquals(periodOf("quarter", "2026-08-03"), { dateFrom: "2026-07-01", dateTo: "2026-09-30" });
  assertEquals(periodOf("year", "2026-08-03"), { dateFrom: "2026-01-01", dateTo: "2026-12-31" });
});

Deno.test("periodUnit: розпізнавання рівно-календарних періодів", () => {
  assertEquals(periodUnit({ dateFrom: "2026-07-20", dateTo: "2026-07-20" }), "day");
  assertEquals(periodUnit({ dateFrom: "2026-07-20", dateTo: "2026-07-26" }), "week");
  assertEquals(periodUnit({ dateFrom: "2026-07-01", dateTo: "2026-07-31" }), "month");
  assertEquals(periodUnit({ dateFrom: "2026-07-01", dateTo: "2026-09-30" }), "quarter");
  assertEquals(periodUnit({ dateFrom: "2026-01-01", dateTo: "2026-12-31" }), "year");
  // тиждень не з понеділка — довільний відрізок
  assertEquals(periodUnit({ dateFrom: "2026-07-21", dateTo: "2026-07-27" }), null);
  assertEquals(periodUnit({ dateFrom: "2026-07-01", dateTo: "2026-07-15" }), null);
  assertEquals(periodUnit({ dateFrom: "", dateTo: "2026-07-15" }), null);
});

Deno.test("shiftPeriod: цілі місяці зсуваються місяцями", () => {
  // місяць: січень → лютий не з'їдає днів
  assertEquals(
    shiftPeriod({ dateFrom: "2026-01-01", dateTo: "2026-01-31" }, 1),
    { dateFrom: "2026-02-01", dateTo: "2026-02-28" },
  );
  // квартал назад через межу року
  assertEquals(
    shiftPeriod({ dateFrom: "2026-01-01", dateTo: "2026-03-31" }, -1),
    { dateFrom: "2025-10-01", dateTo: "2025-12-31" },
  );
  // рік
  assertEquals(
    shiftPeriod({ dateFrom: "2026-01-01", dateTo: "2026-12-31" }, 1),
    { dateFrom: "2027-01-01", dateTo: "2027-12-31" },
  );
  // довільне «з 1-го по останнє» (півріччя) — теж місяцями
  assertEquals(
    shiftPeriod({ dateFrom: "2026-01-01", dateTo: "2026-06-30" }, 1),
    { dateFrom: "2026-07-01", dateTo: "2026-12-31" },
  );
});

Deno.test("shiftPeriod: довільний відрізок зсувається на власну довжину", () => {
  assertEquals(
    shiftPeriod({ dateFrom: "2026-07-20", dateTo: "2026-07-20" }, 1),
    { dateFrom: "2026-07-21", dateTo: "2026-07-21" },
  );
  assertEquals(
    shiftPeriod({ dateFrom: "2026-07-20", dateTo: "2026-07-26" }, -1),
    { dateFrom: "2026-07-13", dateTo: "2026-07-19" },
  );
  // 10 днів через межу місяця
  assertEquals(
    shiftPeriod({ dateFrom: "2026-07-25", dateTo: "2026-08-03" }, 1),
    { dateFrom: "2026-08-04", dateTo: "2026-08-13" },
  );
  // без дат — як є
  assertEquals(
    shiftPeriod({ dateFrom: "", dateTo: "" }, 1),
    { dateFrom: "", dateTo: "" },
  );
});

Deno.test("periodLabel: без локалі — день, рік, відрізок", () => {
  assertEquals(periodLabel({ dateFrom: "2026-07-20", dateTo: "2026-07-20" }), "20.07.26");
  assertEquals(periodLabel({ dateFrom: "2026-01-01", dateTo: "2026-12-31" }), "2026");
  assertEquals(
    periodLabel({ dateFrom: "2026-07-01", dateTo: "2026-07-15" }),
    "01.07.26 — 15.07.26",
  );
  assertEquals(periodLabel({ dateFrom: "", dateTo: "" }), "");
});

/**
 * Перелік одиниць вибору. Ціна помилки тут — не падіння: невідоме слово, узяте
 * мовчки, дало б смугу вкладок, у якій немає того, що написали в атрибуті.
 */
Deno.test("parsePeriodUnits: порядок зберігається, невідоме пропускається", () => {
  assertEquals(parsePeriodUnits("month"), { units: ["month"], custom: false });
  assertEquals(parsePeriodUnits("year,quarter"), { units: ["year", "quarter"], custom: false });
  assertEquals(
    parsePeriodUnits("month, quarter , year , custom"),
    { units: ["month", "quarter", "year"], custom: true },
  );

  // Порожньо — режиму одиниці немає взагалі, поповер лишається з пресетами.
  assertEquals(parsePeriodUnits(""), { units: [], custom: false });

  // День і тиждень сюди не входять: сітка для них — це календар, і він уже є.
  assertEquals(parsePeriodUnits("day,week,month"), { units: ["month"], custom: false });

  // Повтор не подвоює вкладку.
  assertEquals(parsePeriodUnits("month,month"), { units: ["month"], custom: false });

  // Сам `custom` одиницею не є — вибір з одного пункту не вибір.
  assertEquals(parsePeriodUnits("custom"), { units: [], custom: true });
});
