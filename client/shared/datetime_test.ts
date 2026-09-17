import { assertEquals } from "@std/assert";
import { shiftIsoDate } from "./datetime.ts";

Deno.test("shiftIsoDate: дні через межу місяця й року", () => {
  assertEquals(shiftIsoDate("2026-01-31", 1), "2026-02-01");
  assertEquals(shiftIsoDate("2026-01-01", -1), "2025-12-31");
  assertEquals(shiftIsoDate("2026-07-20", 7), "2026-07-27");
  assertEquals(shiftIsoDate("2026-07-03", -7), "2026-06-26");
});

Deno.test("shiftIsoDate: місяць притискає день, а не переповнює", () => {
  assertEquals(shiftIsoDate("2026-01-31", 0, 1), "2026-02-28");
  assertEquals(shiftIsoDate("2028-01-31", 0, 1), "2028-02-29");
  assertEquals(shiftIsoDate("2026-03-31", 0, -1), "2026-02-28");
});

Deno.test("shiftIsoDate: місяці через межу року в обидва боки", () => {
  assertEquals(shiftIsoDate("2026-11-15", 0, 3), "2027-02-15");
  assertEquals(shiftIsoDate("2026-02-15", 0, -3), "2025-11-15");
  assertEquals(shiftIsoDate("2026-05-10", 0, -12), "2025-05-10");
});
