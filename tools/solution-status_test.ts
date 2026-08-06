/**
 * Проби ознаки підтримки.
 *
 * Перевіряється те, заради чого вона й вивідна: будь-яка правка `app/` після
 * поставки помітна сама, без оголошень. Плюс дві межі, на яких легко
 * помилитися: продукти збірки не рахуються за правку, а відсутній манифест —
 * це «невідомо», а не «на підтримці».
 */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";

import { type InstalledSolution, sha256Hex, SOLUTION_MANIFEST_FILE } from "./export-solution.ts";
import { readSolutionStatus } from "./solution-status.ts";

interface Layout {
  [path: string]: string;
}

/** Готує застосунок із розкладеним рішенням і манифестом поставки. */
async function withInstalled(
  files: Layout,
  run: (projectRoot: string, appDir: string) => Promise<void>,
  options: { pins?: Record<string, string>; installedPins?: Record<string, string> } = {},
): Promise<void> {
  const projectRoot = await Deno.makeTempDir({ prefix: "altera-support-probe-" });
  const appDir = join(projectRoot, "app");
  const encoder = new TextEncoder();

  await Deno.writeTextFile(
    join(projectRoot, "deno.json"),
    JSON.stringify({ imports: options.pins ?? { "@altera/server": "jsr:@altera/server@^0.6.3" } }),
  );

  const entries = [];
  for (const [path, text] of Object.entries(files)) {
    const target = join(appDir, path);
    await Deno.mkdir(join(target, ".."), { recursive: true });
    await Deno.writeTextFile(target, text);
    const bytes = encoder.encode(text);
    entries.push({ path, size: bytes.byteLength, sha256: await sha256Hex(bytes) });
  }

  const installed: InstalledSolution = {
    formatVersion: 1,
    name: "probe",
    version: "1.0.0",
    exportedAt: "2026-01-01T00:00:00.000Z",
    framework: {},
    dependencies: {},
    files: entries,
    installedAt: "2026-01-02T00:00:00.000Z",
    installedFramework: options.installedPins ?? { "@altera/server": "jsr:@altera/server@^0.6.3" },
  };
  await Deno.writeTextFile(join(appDir, SOLUTION_MANIFEST_FILE), JSON.stringify(installed, null, 2));

  try {
    await run(projectRoot, appDir);
  } finally {
    await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
  }
}

const BASE: Layout = {
  "sql.json": '{"models":[]}',
  "catalog/bank/manifest.json": '{"model":"bank"}',
};

Deno.test("підтримка: незмінене дерево — на підтримці", async () => {
  await withInstalled(BASE, async (projectRoot) => {
    const status = await readSolutionStatus(projectRoot);

    assertEquals(status.supported, true);
    assertEquals(status.changed, []);
    assertEquals(status.added, []);
    assertEquals(status.removed, []);
  });
});

Deno.test("підтримка: правлений файл названий поіменно", async () => {
  await withInstalled(BASE, async (projectRoot, appDir) => {
    await Deno.writeTextFile(join(appDir, "catalog/bank/manifest.json"), '{"model":"bank","x":1}');
    const status = await readSolutionStatus(projectRoot);

    assertEquals(status.supported, false);
    assertEquals(status.changed, ["catalog/bank/manifest.json"]);
    assertEquals(status.added, []);
    assertEquals(status.removed, []);
  });
});

Deno.test("підтримка: доданий файл знімає з підтримки", async () => {
  await withInstalled(BASE, async (projectRoot, appDir) => {
    await Deno.writeTextFile(join(appDir, "catalog/bank/bankExtra.ts"), "export const x = 1;\n");
    const status = await readSolutionStatus(projectRoot);

    assertEquals(status.supported, false);
    assertEquals(status.added, ["catalog/bank/bankExtra.ts"]);
    assertEquals(status.changed, []);
  });
});

Deno.test("підтримка: видалений файл знімає з підтримки", async () => {
  await withInstalled(BASE, async (projectRoot, appDir) => {
    await Deno.remove(join(appDir, "sql.json"));
    const status = await readSolutionStatus(projectRoot);

    assertEquals(status.supported, false);
    assertEquals(status.removed, ["sql.json"]);
    assertEquals(status.changed, []);
  });
});

// Найпідступніша межа: після першої ж збірки в app/ з'являються _sqlpackage/ і
// .vite/. Якби обхід їх рахував, установка знімалася б з підтримки сама собою,
// нічого не порушивши, — і ознака не значила б нічого.
Deno.test("підтримка: продукти збірки в app/ не рахуються за правку", async () => {
  await withInstalled(BASE, async (projectRoot, appDir) => {
    await Deno.mkdir(join(appDir, "_sqlpackage"), { recursive: true });
    await Deno.writeTextFile(join(appDir, "_sqlpackage/altera.app.sql"), "-- зібране\n");
    await Deno.mkdir(join(appDir, ".vite/deps"), { recursive: true });
    await Deno.writeTextFile(join(appDir, ".vite/deps/lit.js"), "// кеш\n");

    const status = await readSolutionStatus(projectRoot);
    assertEquals(status.supported, true);
  });
});

Deno.test("підтримка: без манифесту стан невідомий, а не «на підтримці»", async () => {
  await withInstalled(BASE, async (projectRoot, appDir) => {
    await Deno.remove(join(appDir, SOLUTION_MANIFEST_FILE));
    const status = await readSolutionStatus(projectRoot);

    assertEquals(status.installed, null);
    // Саме false: невідомо не означає «не чіпали», і автооновлення тут не місце.
    assertEquals(status.supported, false);
  });
});

Deno.test("підтримка: артефакти, зібрані старішим фреймворком, помітні", async () => {
  await withInstalled(
    BASE,
    async (projectRoot) => {
      const status = await readSolutionStatus(projectRoot);

      // Саме рішення не чіпали — підтримка ціла...
      assertEquals(status.supported, true);
      // ...але dist/ і _sqlpackage/ зібрані попередньою версією фреймворку.
      assertEquals(status.frameworkDrift.length, 1);
      assertEquals(status.frameworkDrift[0].pkg, "@altera/server");
      assertEquals(status.frameworkDrift[0].installed, "jsr:@altera/server@^0.6.2");
      assertEquals(status.frameworkDrift[0].current, "jsr:@altera/server@^0.6.3");
    },
    {
      pins: { "@altera/server": "jsr:@altera/server@^0.6.3" },
      installedPins: { "@altera/server": "jsr:@altera/server@^0.6.2" },
    },
  );
});
