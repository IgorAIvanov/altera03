/**
 * Проби формату посилання на вкладку.
 *
 * Стережуть двобічність: що зібрали, те й мусимо розібрати назад. Помилка тут
 * не падає, а тихо відкриває не ту вкладку — саме те, чого очима не видно.
 */
import { assertEquals } from "@std/assert";
import { buildTabUrl, parseTabPath } from "./tab-url.ts";

const ORIGIN = "http://localhost:5173";

Deno.test("URL вкладки: із записом і без", () => {
  assertEquals(
    buildTabUrl(ORIGIN, "catalog/bank/edit", "5"),
    "http://localhost:5173/catalog/bank/edit/5",
  );
  assertEquals(
    buildTabUrl(ORIGIN, "catalog/bank/list", null),
    "http://localhost:5173/catalog/bank/list",
  );
});

Deno.test("розбір: маршрут і id", () => {
  assertEquals(parseTabPath("/catalog/bank/edit/5"), {
    route: "catalog/bank/edit",
    modelId: "5",
  });
  assertEquals(parseTabPath("/catalog/bank/list"), {
    route: "catalog/bank/list",
    modelId: null,
  });
});

Deno.test("розбір: зібране розбирається назад", () => {
  for (const [route, id] of [["catalog/bank/edit", "5"], ["report/turnover_balance/list", null]] as const) {
    const url = buildTabUrl(ORIGIN, route, id);
    assertEquals(parseTabPath(new URL(url).pathname), { route, modelId: id });
  }
});

Deno.test("розбір: корінь або обрізана адреса — null, а не здогадка", () => {
  assertEquals(parseTabPath(""), null);
  assertEquals(parseTabPath("/"), null);
  // Маршрут в'ю — рівно три сегменти; двох замало, вгадувати вид не будемо.
  assertEquals(parseTabPath("/catalog/bank"), null);
});

Deno.test("розбір: зайві сегменти не міняють маршрут", () => {
  assertEquals(parseTabPath("/catalog/bank/edit/5/зайве"), {
    route: "catalog/bank/edit",
    modelId: "5",
  });
  // Подвійні скоси й хвостовий скіс не ламають розбір.
  assertEquals(parseTabPath("//catalog//bank//edit//5/"), {
    route: "catalog/bank/edit",
    modelId: "5",
  });
});
