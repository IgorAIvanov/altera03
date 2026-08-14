import { assertEquals } from "@std/assert";
import { resolveServerConfig, type ServerOptions } from "./server-config.ts";

/** Мінімум, без якого `bootstrap()` не збереться — решта має дефолти. */
function options(extra: Partial<ServerOptions> = {}): ServerOptions {
  return {
    database: { url: "postgres://localhost/none", poolSize: 1 },
    models: { registry: {}, tsCommands: {} },
    views: { manifest: {}, projectRoot: "C:/app", dev: false },
    ...extra,
  } as ServerOptions;
}

Deno.test("версія установки: застосунок називає, бібліотека не вигадує", async (t) => {
  await t.step("не назвали — порожньо, а не undefined", () => {
    // Порожній об'єкт, бо його читає контролер і віддає клієнтові як є:
    // `undefined` зник би з JSON, і поле в відповіді то з'являлося б, то ні.
    assertEquals(resolveServerConfig(options()).version, {});
  });

  await t.step("назвали — доїжджає без змін", () => {
    const version = { solution: "erp 1.4.0", framework: "^0.19.0" };
    assertEquals(resolveServerConfig(options({ version })).version, version);
  });

  await t.step("названо наполовину — друге поле лишається відсутнім", () => {
    // Розгортання з репозиторію знає пін фреймворку з карти імпортів, але назви
    // рішення не має звідки взяти. Половина відповіді краща за жодної.
    const version = { framework: "^0.19.0" };
    assertEquals(resolveServerConfig(options({ version })).version, version);
  });
});
