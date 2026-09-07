/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// scripts/ не входить у workspace, тож бере compilerOptions кореня — там
// бібліотеки DOM немає. Директиви вмикають її для цих файлів, щоб
// `deno task check` (він перевіряє й ./scripts) проходив.
/**
 * Стенд табличної частини: скільки коштує документ на N рядків.
 *
 * Що міряємо і чому саме це:
 *  - **build** — від «дані прийшли» до намальованої таблиці. Це те, що бачить
 *    користувач як «документ відкривається»;
 *  - **правка** — один `patch()` десяткової комірки в середині таблиці. Головне
 *    число: саме воно відчувається руками при заповненні документа;
 *  - **вибір** — клік по рядку (перемальовування заради класу `current`);
 *  - **вставка** — копія рядка на початку: зсуває весь хвіст;
 *  - **DOM-вузли / кастомні елементи** — звідки береться вартість;
 *  - **heap** — приріст пам'яті на змонтованій таблиці.
 *
 * Міряється те, що у фреймворку зараз. Прототипів тут більше немає: обидві
 * ідеї, які стенд перевіряв (кеш записів і контроли лише в поточному рядку),
 * у фреймворк переїхали, і копія компонента, яку не можна перезібрати з
 * оригіналу, гнила б мовчки.
 *
 * **Кожен сценарій дає ДВА числа, і без обох замір оманливий.**
 *  - `js` — до `updateComplete`: рендер Lit і зміна DOM, без квантування;
 *  - `total` — плюс кадр (`requestAnimationFrame`): стиль, розкладка, малювання.
 *
 * `total` знизу обмежений частотою кадрів (два кадри ≈ 33 мс на 60 Гц), тож на
 * сотні рядків він показує рівно цю стелю й нічого більше — перший прогін
 * стенда саме на це й наштовхнувся: різні реалізації дали однакові 33.4 мс, і
 * виглядало це як «різниці немає». Порівнювати треба по `js`, а `total`
 * читати як «скільки кадрів це коштує».
 */
// Стилі — справжні, збірка застосунку: тема фреймворку задає `.table-tabular`
// і `.cell-control`, а без них розкладка й малювання були б іншими, тобто
// заміряли б ми не ту таблицю.
import "../../../app/styles/app-styles.ts";
import { setLocale } from "@client/locale.ts";
import { BenchHost } from "./bench-host.ts";
import { makeLines } from "./bench-data.ts";

// ── Дрібниці ─────────────────────────────────────────────────────────────────

const nextFrame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Stats {
  median: number;
  p95: number;
  max: number;
  n: number;
}

/** Пара «чистий JS» / «з кадром» — див. шапку файлу. */
interface Pair {
  js: Stats;
  total: Stats;
}

function stats(samples: number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { median: at(0.5), p95: at(0.95), max: s[s.length - 1], n: s.length };
}

const one = (v: number): Stats => ({ median: v, p95: v, max: v, n: 1 });

/** Обхід зі спуском у shadow root — звичайний querySelectorAll туди не бачить. */
function countNodes(root: Node): { nodes: number; custom: number; shadows: number } {
  let nodes = 0, custom = 0, shadows = 0;
  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      nodes++;
      const el = node as Element;
      if (el.tagName.includes("-")) custom++;
      const shadow = el.shadowRoot;
      if (shadow) {
        shadows++;
        for (const child of Array.from(shadow.children)) walk(child);
      }
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(root);
  return { nodes, custom, shadows };
}

type MemoryApi = {
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
  memory?: { usedJSHeapSize: number };
};

/**
 * Пам'ять. `measureUserAgentSpecificMemory()` точний, і конфіг стенда віддає
 * заради нього COOP/COEP — але навіть у crossOriginIsolated-контексті браузер
 * має право відмовити (`SecurityError: not available`; вбудовані вікна так і
 * роблять). Фолбек — нестандартний `performance.memory`: він грубий і збірку
 * сміття не форсує, тому джерело завжди їде в результат поруч із числом.
 */
async function heapBytes(): Promise<{ bytes: number; source: string } | null> {
  const perf = performance as unknown as MemoryApi;
  if (crossOriginIsolated && perf.measureUserAgentSpecificMemory) {
    try {
      const result = await Promise.race([
        perf.measureUserAgentSpecificMemory(),
        sleep(30_000).then(() => null),
      ]);
      if (result) return { bytes: result.bytes, source: "measureUserAgentSpecificMemory" };
    } catch { /* нижче фолбек */ }
  }
  if (perf.memory) return { bytes: perf.memory.usedJSHeapSize, source: "performance.memory" };
  return null;
}

// ── Сценарії ─────────────────────────────────────────────────────────────────

export interface SuiteResult {
  rows: number;
  build: Pair;
  keystroke: Pair;
  select: Pair;
  insert: Pair;
  nodes: number;
  custom: number;
  shadows: number;
  heapMb: number | null;
  heapSource: string | null;
}

async function timed(
  count: number,
  warmup: number,
  step: (i: number) => void,
  settle: () => Promise<unknown>,
): Promise<Pair> {
  const js: number[] = [];
  const total: number[] = [];
  for (let i = 0; i < count + warmup; i++) {
    const t0 = performance.now();
    step(i);
    await settle();
    const t1 = performance.now();
    await nextFrame();
    const t2 = performance.now();
    if (i >= warmup) {
      js.push(t1 - t0);
      total.push(t2 - t0);
    }
  }
  return { js: stats(js), total: stats(total) };
}

async function runSuite(rows: number, log: (s: string) => void): Promise<SuiteResult> {
  log(`${rows} рядків: монтування…`);

  const before = await heapBytes();

  const host = new BenchHost();
  const stage = document.getElementById("stage")!;
  stage.replaceChildren(host);
  await host.updateComplete;
  await nextFrame();

  const table = host.table!;
  const settle = () => table.updateComplete;

  // build: від «дані прийшли» до намальованої таблиці
  const t0 = performance.now();
  host.setLines(makeLines(rows));
  await settle();
  const t1 = performance.now();
  await nextFrame();
  const t2 = performance.now();
  const build: Pair = { js: one(t1 - t0), total: one(t2 - t0) };

  const after = await heapBytes();

  // Рахуємо ПІСЛЯ вибору рядка: контроли існують лише в поточному записі, і
  // без цього кроку число вийшло б красивішим, ніж є насправді.
  const middle = Math.floor(rows / 2);
  host.section.select(middle);
  await settle();
  await nextFrame();
  const counts = countNodes(host);

  log(`${rows} рядків: правка комірки…`);
  const keystroke = await timed(25, 5, (i) => {
    host.section.patch(middle, { qtyFact: `${10 + i}.5` });
  }, settle);

  log(`${rows} рядків: вибір рядка…`);
  const select = await timed(20, 4, (i) => {
    host.section.select(middle + (i % 2 === 0 ? 1 : 0));
  }, settle);

  log(`${rows} рядків: вставка рядка…`);
  const insert = await timed(10, 2, () => {
    host.section.copyLine(0);
  }, settle);

  stage.replaceChildren();

  const heap = after && before ? (after.bytes - before.bytes) / 1024 / 1024 : null;

  return {
    rows,
    build,
    keystroke,
    select,
    insert,
    nodes: counts.nodes,
    custom: counts.custom,
    shadows: counts.shadows,
    heapMb: heap === null ? null : Math.round(heap * 10) / 10,
    heapSource: after?.source ?? null,
  };
}

// ── Запуск і вивід ───────────────────────────────────────────────────────────

const n1 = (v: number) => v.toFixed(1);

function renderResults(results: SuiteResult[]) {
  const head = [
    "рядків",
    "build js / кадр",
    "правка js med / p95",
    "правка з кадром",
    "вибір js",
    "вставка js",
    "DOM-вузлів",
    "кастомних",
    "heap, МБ",
  ];
  const rows = results.map((r) => [
    String(r.rows),
    `${n1(r.build.js.median)} / ${n1(r.build.total.median)}`,
    `${n1(r.keystroke.js.median)} / ${n1(r.keystroke.js.p95)}`,
    n1(r.keystroke.total.median),
    n1(r.select.js.median),
    n1(r.insert.js.median),
    String(r.nodes),
    String(r.custom),
    r.heapMb === null ? "—" : String(r.heapMb),
  ]);
  const table = document.getElementById("results")!;
  table.innerHTML = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
  document.getElementById("json")!.textContent = JSON.stringify(results, null, 1);
}

async function main() {
  await setLocale("uk");

  const params = new URLSearchParams(location.search);
  const rowCounts = (params.get("rows") ?? "100,1000")
    .split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
  const status = document.getElementById("status")!;
  const log = (s: string) => { status.textContent = s; };

  const results: SuiteResult[] = [];
  for (const rows of rowCounts) {
    results.push(await runSuite(rows, log));
    renderResults(results);
    await sleep(300);
  }

  log(`Готово. crossOriginIsolated=${crossOriginIsolated}`);
  (globalThis as unknown as { __bench: SuiteResult[] }).__bench = results;
  console.table(results.map((r) => ({
    rows: r.rows,
    buildJs: Number(r.build.js.median.toFixed(1)),
    keystrokeJs: Number(r.keystroke.js.median.toFixed(1)),
    custom: r.custom,
    heapMb: r.heapMb,
  })));
}

document.getElementById("run")!.addEventListener("click", () => {
  document.getElementById("run")!.setAttribute("disabled", "");
  main();
});

if (new URLSearchParams(location.search).get("auto") === "1") main();
