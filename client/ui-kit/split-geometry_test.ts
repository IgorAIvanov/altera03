/// <reference lib="deno.ns" />
/**
 * Проби розкладки розділеного вікна: `deno task test:unit`.
 *
 * Директива вгорі — те саме, що в решті проб `client/`: пакет браузерний, і
 * `deno.ns` у його `lib` немає навмисно.
 *
 * Перевіряти тут є що саме тому, що помилка в цих числах НЕ падає: смуга
 * перестає рухатися, панель стискається в нуль або їде в протилежний бік — і
 * дізнаються про це, вже сидячи за звіркою.
 */
import { assertEquals } from "@std/assert";
import {
  clampRatio,
  DEFAULT_RATIO,
  MIN_PANE,
  ratioAfterDrag,
  restoreSplit,
} from "./split-geometry.ts";

const TALL = 900;

Deno.test("розділення: жодна панель не стискається нижче мінімуму", () => {
  const top = clampRatio(0.001, TALL);
  const bottom = clampRatio(0.999, TALL);

  assertEquals(Math.round(top * TALL), MIN_PANE);
  assertEquals(Math.round((1 - bottom) * TALL), MIN_PANE);
});

Deno.test("розділення: у низькому вікні ділимо навпіл, а не в нуль", () => {
  // Дві мінімальні панелі не влазять — краще дві однаково тісні, ніж одна в нуль.
  assertEquals(clampRatio(0.9, MIN_PANE), 0.5);
  assertEquals(clampRatio(0.1, MIN_PANE * 2 - 1), 0.5);
});

Deno.test("розділення: смуга йде за мишею — і в перевернутій розкладці теж", () => {
  // Файл угорі: тягнемо вниз — файлу більше.
  const down = ratioAfterDrag(0.5, 90, TALL, true);
  assertEquals(down > 0.5, true);
  assertEquals(Math.round(down * TALL), 540);

  // Файл унизу: той самий рух вниз ЗМЕНШУЄ його частку. Без цього знаку
  // роздільник їхав би проти миші, і помітно це аж за звіркою.
  const flipped = ratioAfterDrag(0.5, 90, TALL, false);
  assertEquals(flipped < 0.5, true);
  assertEquals(Math.round(flipped * TALL), 360);
});

Deno.test("розділення: перетяг за край упирається, а не перекидає панелі", () => {
  const far = ratioAfterDrag(0.5, 10_000, TALL, true);
  assertEquals(Math.round((1 - far) * TALL), MIN_PANE);
});

Deno.test("розділення: зіпсоване сховище дає умовчання, а не порожнє вікно", () => {
  for (const stored of [null, {}, "junk", { ratio: Number.NaN }]) {
    // Умовчання саме `split`: плавуче вікно вмикають свідомо, а не діставши
    // його від зіпсованого запису.
    assertEquals(restoreSplit(stored), { ratio: DEFAULT_RATIO, fileFirst: true, mode: "split" });
  }

  assertEquals(
    restoreSplit({ ratio: 0.7, fileFirst: false, mode: "float" }),
    { ratio: 0.7, fileFirst: false, mode: "float" },
  );
  // Невідомий режим — не привід ламатися: лишається розділення.
  assertEquals(restoreSplit({ mode: "windowed" }).mode, "split");
  // Частка з чужого світу все одно лишається часткою.
  assertEquals(restoreSplit({ ratio: 4 }).ratio, 0.95);
});
