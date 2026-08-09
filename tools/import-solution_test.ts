/**
 * Проби рішення «що робити з наявним app/».
 *
 * Пакет тут не збирається руками — беремо справжній `exportSolution`, тож
 * проби заразом стережуть round-trip: усе, що експорт виключив, до імпорту не
 * доїде.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";

import {
  exportSolution,
  SOLUTION_FORMAT_FULL,
  SOLUTION_FORMAT_PARTIAL,
  SOLUTION_MANIFEST_FILE,
} from "./export-solution.ts";
import { importSolution } from "./import-solution.ts";
import { readSolutionStatus } from "./solution-status.ts";
import { updateSolution } from "./update-solution.ts";

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

// ── Часткове перенесення ─────────────────────────────────────────────────────

/**
 * Джерело з двома моделями, які посилаються одна на одну: `invoice` тягне
 * `bank` і маршрутом (`ui-picker`), і його таблицею в SQL.
 */
const TWO_MODELS: Layout = {
  "sql.json": '{"models":["catalog/bank","document/invoice"]}',
  "shared/money.ts": "export const round = (x: number) => x;\n",
  "catalog/bank/manifest.json": '{"model":"bank","schema":"app"}',
  "catalog/bank/bankList.ts": "export const list = 1;\n",
  "document/invoice/manifest.json": '{"model":"invoice","schema":"app"}',
  "document/invoice/invoiceEdit.ts":
    'import { round } from "@shared/money.ts";\nconst url = "catalog/bank";\nexport { round, url };\n',
  "document/invoice/db/invoice.sql": "select * from app.bank where id = 1;\n",
};

async function partialPackage(routes: string[], files: Layout = TWO_MODELS) {
  const source = await makeProject(files);
  return await exportSolution(join(source, "app"), {
    out: join(source, "models.tar.gz"),
    name: "probe",
    version: "1.0.0",
    models: routes,
  });
}

Deno.test("часткове вивантаження: у пакет їдуть рівно перелічені моделі", async () => {
  const { manifest } = await partialPackage(["document/invoice"]);

  assertEquals(manifest.kind, "partial");
  assertEquals(manifest.models, ["document/invoice"]);
  assertEquals(manifest.files.map((entry) => entry.path).sort(), [
    "document/invoice/db/invoice.sql",
    "document/invoice/invoiceEdit.ts",
    "document/invoice/manifest.json",
  ]);
});

// Тільки попереджаємо. Добирати залежності інструмент не має права: набір
// моделей і є вибір людини, а тихе дотягування зробило б із двох моделей
// половину рішення.
Deno.test("часткове вивантаження: чужа модель і файл поза нею — попередження", async () => {
  const { missing } = await partialPackage(["document/invoice"]);

  assertEquals(missing.map((reference) => `${reference.kind} ${reference.target}`).sort(), [
    "file shared/money.ts",
    "model catalog/bank",
  ]);
});

Deno.test("часткове вивантаження: одруківка в маршруті — відмова, а не порожній пакет", async () => {
  await assertRejects(() => partialPackage(["catalog/bnak"]), Error, "catalog/bnak");
});

Deno.test("часткове завантаження: нова модель додається, наявне не чіпається", async () => {
  const { outPath } = await partialPackage(["document/invoice"]);
  const target = await makeProject(V1);

  try {
    const result = await importSolution(outPath, target);

    assertEquals(result.mode, "merge");
    assertEquals(result.written, 3);
    // Те, що вже було, лишилося на місці...
    assertEquals(
      await Deno.readTextFile(join(target, "app", "catalog/bank/manifest.json")),
      '{"model":"bank"}',
    );
    // ...а модель дописана в список збірки SQL — інакше вона нікуди не поїде.
    const sql = JSON.parse(await Deno.readTextFile(join(target, "app", "sql.json")));
    assertEquals(sql.models, ["document/invoice"]);
    // Манифест поставки не пишеться: дерево поставці свідомо не дорівнює.
    assertEquals(
      await Deno.stat(join(target, "app", SOLUTION_MANIFEST_FILE)).then(() => true).catch(() => false),
      false,
    );
  } finally {
    await Deno.remove(target, { recursive: true }).catch(() => {});
  }
});

Deno.test("часткове завантаження: наявна модель без --force не затирається", async () => {
  const { outPath } = await partialPackage(["catalog/bank"]);
  const target = await makeProject({ ...V1, "catalog/bank/mine.ts": "export const x = 1;\n" });

  try {
    const skipped = await importSolution(outPath, target);
    assertEquals(skipped.written, 0);
    assertEquals(
      await Deno.readTextFile(join(target, "app", "catalog/bank/manifest.json")),
      '{"model":"bank"}',
    );

    // З --force каталог моделі заміняється ЦІЛКОМ: усередині своєї моделі пакет
    // вичерпний, тож прибраний у джерелі файл має зникнути й тут.
    const forced = await importSolution(outPath, target, { force: true });
    assertEquals(forced.written, 2);
    assertEquals(
      await Deno.readTextFile(join(target, "app", "catalog/bank/manifest.json")),
      '{"model":"bank","schema":"app"}',
    );
    assertEquals(
      await Deno.stat(join(target, "app", "catalog/bank/mine.ts")).then(() => true).catch(() => false),
      false,
    );
  } finally {
    await Deno.remove(target, { recursive: true }).catch(() => {});
  }
});

Deno.test("часткове завантаження: --check нічого не пише", async () => {
  const { outPath } = await partialPackage(["document/invoice"]);
  const target = await makeProject(V1);

  try {
    const result = await importSolution(outPath, target, { check: true });

    assertEquals(result.written, 0);
    assertEquals(
      await Deno.stat(join(target, "app", "document/invoice")).then(() => true).catch(() => false),
      false,
    );
    assertEquals(await Deno.readTextFile(join(target, "app", "sql.json")), '{"models":[]}');
  } finally {
    await Deno.remove(target, { recursive: true }).catch(() => {});
  }
});

// Головний запобіжник формату: інструмент, який про часткові пакети не знає,
// розпакував би цей як повний і викинув усе решта рішення.
Deno.test("частковий пакет: старий приймач відмовляється його читати", async () => {
  const { manifest } = await partialPackage(["catalog/bank"]);

  assertEquals(manifest.formatVersion, SOLUTION_FORMAT_PARTIAL);
  assertEquals(manifest.formatVersion === SOLUTION_FORMAT_FULL, false);
});

Deno.test("часткове завантаження: solution:update таким пакетом не працює", async () => {
  const { outPath } = await partialPackage(["catalog/bank"]);
  const target = await makeProject(V1);

  try {
    await assertRejects(() => updateSolution(outPath, target), Error, "частковий пакет");
  } finally {
    await Deno.remove(target, { recursive: true }).catch(() => {});
  }
});
