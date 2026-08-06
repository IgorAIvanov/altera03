/**
 * Проби стану підтримки на боці сервера.
 *
 * Сервер його лише ЧИТАЄ — установкою займається окремий інструмент. Тому
 * перевіряється рівно те, що він уміє: звірити дерево з манифестом поставки,
 * розрізнити три стани (на підтримці / знято / невідомо) і не рахувати
 * продукти збірки за правку.
 *
 * Звірка тут написана вдруге — після `@altera/tools/solution-status` — і це
 * навмисно: імпортувати tools у server означало б замкнути цикл залежностей
 * (напрямок `tools → server`). Ціна дублювання закривається цими пробами.
 */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";

import { resolveServerConfig, setServerConfig } from "../../config/server-config.ts";
import { SolutionService } from "./solution.service.ts";

const SOLUTION_MANIFEST_FILE = ".solution.json";

interface Layout {
  [path: string]: string;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function withInstalled(
  files: Layout,
  run: (service: SolutionService, appDir: string) => Promise<void>,
  options: { manifest?: boolean } = {},
): Promise<void> {
  const projectRoot = await Deno.makeTempDir({ prefix: "altera-solution-state-" });
  const appDir = join(projectRoot, "app");
  const encoder = new TextEncoder();
  const entries = [];

  for (const [path, text] of Object.entries(files)) {
    const target = join(appDir, path);
    await Deno.mkdir(join(target, ".."), { recursive: true });
    await Deno.writeTextFile(target, text);
    const bytes = encoder.encode(text);
    entries.push({ path, size: bytes.byteLength, sha256: await sha256(bytes) });
  }

  if (options.manifest !== false) {
    await Deno.writeTextFile(
      join(appDir, SOLUTION_MANIFEST_FILE),
      JSON.stringify({
        formatVersion: 1,
        name: "probe",
        version: "1.0.0",
        installedAt: "2026-01-02T00:00:00.000Z",
        files: entries,
      }),
    );
  }

  setServerConfig(resolveServerConfig({
    database: { host: "localhost", port: 5432, database: "x", username: "x", password: "x", poolSize: 1 },
    models: { registry: {}, tsCommands: [] },
    views: { manifest: [], projectRoot, appDir: "app", dev: false },
  }));

  try {
    await run(new SolutionService(), appDir);
  } finally {
    await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
  }
}

const BASE: Layout = {
  "sql.json": '{"models":[]}',
  "catalog/bank/manifest.json": '{"model":"bank"}',
};

Deno.test("стан рішення: незмінене дерево — на підтримці", async () => {
  await withInstalled(BASE, async (service) => {
    const state = await service.readState();

    assertEquals(state.supported, true);
    assertEquals(state.divergent, 0);
    assertEquals(state.solution?.name, "probe");
    assertEquals(state.solution?.files, 2);
  });
});

Deno.test("стан рішення: правка знімає з підтримки", async () => {
  await withInstalled(BASE, async (service, appDir) => {
    await Deno.writeTextFile(join(appDir, "sql.json"), '{"models":["x"]}');
    const state = await service.readState();

    assertEquals(state.supported, false);
    assertEquals(state.divergent, 1);
  });
});

Deno.test("стан рішення: доданий і видалений файл рахуються теж", async () => {
  await withInstalled(BASE, async (service, appDir) => {
    await Deno.writeTextFile(join(appDir, "catalog/bank/mine.ts"), "export const x = 1;\n");
    await Deno.remove(join(appDir, "sql.json"));
    const state = await service.readState();

    assertEquals(state.supported, false);
    assertEquals(state.divergent, 2);
  });
});

// Та сама межа, що й у консольній команді: після першої ж збірки в app/
// з'являються _sqlpackage/ і .vite/. Рахувати їх — означало б показувати
// «знято з підтримки» кожному, хто просто зібрав фронтенд.
Deno.test("стан рішення: продукти збірки не рахуються за правку", async () => {
  await withInstalled(BASE, async (service, appDir) => {
    await Deno.mkdir(join(appDir, "_sqlpackage"), { recursive: true });
    await Deno.writeTextFile(join(appDir, "_sqlpackage/altera.app.sql"), "-- зібране\n");
    await Deno.mkdir(join(appDir, ".vite/deps"), { recursive: true });
    await Deno.writeTextFile(join(appDir, ".vite/deps/lit.js"), "// кеш\n");

    assertEquals((await service.readState()).supported, true);
  });
});

Deno.test("стан рішення: без манифесту — невідомо, а не «на підтримці»", async () => {
  await withInstalled(BASE, async (service) => {
    const state = await service.readState();

    assertEquals(state.solution, null);
    // Саме null: третій стан, який не можна плутати з «змінювали».
    assertEquals(state.supported, null);
  }, { manifest: false });
});
