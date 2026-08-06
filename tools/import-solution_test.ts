/**
 * Проби рішення «що робити з наявним app/».
 *
 * Пакет тут не збирається руками — беремо справжній `exportSolution`, тож
 * проби заразом стережуть round-trip: усе, що експорт виключив, до імпорту не
 * доїде.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";

import { exportSolution, SOLUTION_MANIFEST_FILE } from "./export-solution.ts";
import { importSolution } from "./import-solution.ts";
import { readSolutionStatus } from "./solution-status.ts";

const PINS = {
  "@altera/client": "jsr:@altera/client@^0.6.2",
  "@altera/server": "jsr:@altera/server@^0.6.3",
};

interface Layout {
  [path: string]: string;
}

async function makeProject(files: Layout): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "altera-import-probe-" });
  await Deno.writeTextFile(join(root, "deno.json"), JSON.stringify({ imports: PINS }));
  for (const [path, text] of Object.entries(files)) {
    const target = join(root, "app", path);
    await Deno.mkdir(join(target, ".."), { recursive: true });
    await Deno.writeTextFile(target, text);
  }
  return root;
}

/** Джерело → пакет. Повертає шлях до `.tar.gz`. */
async function packageOf(files: Layout, version = "1.0.0"): Promise<string> {
  const source = await makeProject(files);
  const { outPath } = await exportSolution(join(source, "app"), {
    out: join(source, "pkg.tar.gz"),
    name: "probe",
    version,
  });
  return outPath;
}

const V1: Layout = {
  "sql.json": '{"models":[]}',
  "catalog/bank/manifest.json": '{"model":"bank"}',
};

async function withTarget(
  initial: Layout | null,
  run: (target: string, pkgV1: string) => Promise<void>,
): Promise<void> {
  const pkgV1 = await packageOf(V1);
  const target = await makeProject(initial ?? {});
  if (!initial) await Deno.remove(join(target, "app"), { recursive: true }).catch(() => {});

  try {
    await run(target, pkgV1);
  } finally {
    await Deno.remove(target, { recursive: true }).catch(() => {});
  }
}

Deno.test("імпорт: у порожній app/ ставиться без --force", async () => {
  await withTarget(null, async (target, pkg) => {
    const result = await importSolution(pkg, target);

    assertEquals(result.written, 2);
    assertEquals((await readSolutionStatus(target)).supported, true);
  });
});

// Головна зміна поведінки: той, хто нічого не міняв, більше не мусить щоразу
// підтверджувати «затри мої правки», яких у нього немає.
Deno.test("імпорт: на підтримці оновлення автоматичне, --force не потрібен", async () => {
  await withTarget(null, async (target, pkg) => {
    await importSolution(pkg, target);
    const again = await importSolution(pkg, target);

    assertEquals(again.written, 2);
    assertEquals((await readSolutionStatus(target)).supported, true);
  });
});

Deno.test("імпорт: знято з підтримки — app/ не чіпається, пакет лягає поруч", async () => {
  await withTarget(null, async (target, pkg) => {
    await importSolution(pkg, target);

    const edited = join(target, "app", "catalog/bank/manifest.json");
    await Deno.writeTextFile(edited, '{"model":"bank","mine":true}');
    await Deno.writeTextFile(join(target, "app", "catalog/bank/mine.ts"), "export const x = 1;\n");

    const pkgV2 = await packageOf({ ...V1, "sql.json": '{"models":["catalog/bank"]}' }, "2.0.0");
    await importSolution(pkgV2, target);

    // Правки на місці...
    assertEquals(await Deno.readTextFile(edited), '{"model":"bank","mine":true}');
    assertEquals(await Deno.stat(join(target, "app", "catalog/bank/mine.ts")).then(() => true), true);
    // ...а нова поставка — поруч, і з власним манифестом, тож перейменування
    // каталогу дає одразу коректний стан підтримки.
    const incoming = join(target, "app.incoming");
    assertEquals(await Deno.readTextFile(join(incoming, "sql.json")), '{"models":["catalog/bank"]}');
    assertEquals(await Deno.stat(join(incoming, SOLUTION_MANIFEST_FILE)).then(() => true), true);
  });
});

Deno.test("імпорт: --force затирає правки свідомо", async () => {
  await withTarget(null, async (target, pkg) => {
    await importSolution(pkg, target);
    await Deno.writeTextFile(join(target, "app", "catalog/bank/mine.ts"), "export const x = 1;\n");

    await importSolution(pkg, target, { force: true });

    assertEquals(
      await Deno.stat(join(target, "app", "catalog/bank/mine.ts")).then(() => true).catch(() => false),
      false,
    );
    assertEquals((await readSolutionStatus(target)).supported, true);
  });
});

// Установка, зроблена руками або старим інструментом: манифесту немає, звірити
// нема з чим. Мовчки затирати такий каталог не можна — але й «на підтримці» він
// не є.
Deno.test("імпорт: без манифесту непорожній app/ вимагає --force", async () => {
  await withTarget({ "legacy.txt": "чиєсь дерево" }, async (target, pkg) => {
    await assertRejects(() => importSolution(pkg, target), Error, "--force");

    // З --force — заміна цілком.
    await importSolution(pkg, target, { force: true });
    assertEquals((await readSolutionStatus(target)).supported, true);
  });
});

Deno.test("імпорт: --check нічого не пише навіть коли знято з підтримки", async () => {
  await withTarget(null, async (target, pkg) => {
    await importSolution(pkg, target);
    await Deno.writeTextFile(join(target, "app", "catalog/bank/mine.ts"), "export const x = 1;\n");

    const result = await importSolution(pkg, target, { check: true });

    assertEquals(result.written, 0);
    assertEquals(
      await Deno.stat(join(target, "app.incoming")).then(() => true).catch(() => false),
      false,
    );
  });
});
