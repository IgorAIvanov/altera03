/// <reference lib="deno.ns" />
/**
 * Проби геометрії плавучого вікна: `deno task test:unit`.
 *
 * Директива вгорі — те саме, що в решті проб `client/`: пакет браузерний, і
 * `deno.ns` у його `lib` немає навмисно, щоб `Deno.*` не став дозволеним у
 * самому ui-kit.
 *
 * Перевіряти тут є що саме тому, що помилка в цих числах НЕ падає: вікно
 * тихо з'їжджає за край або відкривається на весь екран, і побачить це лише
 * той, хто відкриє його на іншому моніторі.
 */
import { assertEquals } from "@std/assert";
import {
  clampWindow,
  defaultWindow,
  KEEP_VISIBLE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  restoreWindow,
} from "./window-geometry.ts";

const LAPTOP = { width: 1440, height: 900 };

Deno.test("вікно перегляду: умовчання — права половина, форма лишається видною", () => {
  const geometry = defaultWindow(LAPTOP);

  // Ліва половина вільна: саме там форма, яку звіряють із файлом.
  assertEquals(geometry.x >= LAPTOP.width / 2 - 24, true);
  assertEquals(geometry.x + geometry.w <= LAPTOP.width, true);
  assertEquals(geometry.h <= LAPTOP.height, true);
});

Deno.test("вікно перегляду: збережене з іншого монітора не лишається за краєм", () => {
  // Так виглядає геометрія, розставлена на 2560×1440 і прочитана на ноутбуці.
  const geometry = clampWindow({ x: 1900, y: 1200, w: 1200, h: 1000 }, LAPTOP);

  assertEquals(geometry.w <= LAPTOP.width, true);
  assertEquals(geometry.h <= LAPTOP.height, true);
  // Головне: за вікно є чим ухопитися.
  assertEquals(geometry.x <= LAPTOP.width - KEEP_VISIBLE, true);
  assertEquals(geometry.y <= LAPTOP.height - 40, true);
});

Deno.test("вікно перегляду: за край його пускають, але не цілком", () => {
  const left = clampWindow({ x: -5000, y: 100, w: 600, h: 400 }, LAPTOP);
  const right = clampWindow({ x: 5000, y: 100, w: 600, h: 400 }, LAPTOP);

  // Ліворуч видно смугу заголовка, праворуч — теж: вікно, затягнуте за екран
  // цілком, лишалося б відкритим і недосяжним.
  assertEquals(left.x, KEEP_VISIBLE - 600);
  assertEquals(left.x + left.w, KEEP_VISIBLE);
  assertEquals(right.x, LAPTOP.width - KEEP_VISIBLE);
  assertEquals(right.y >= 0, true);
});

Deno.test("вікно перегляду: менше за мінімум не стискається", () => {
  const geometry = clampWindow({ x: 10, y: 10, w: 40, h: 20 }, LAPTOP);
  assertEquals(geometry.w, MIN_WINDOW_WIDTH);
  assertEquals(geometry.h, MIN_WINDOW_HEIGHT);
});

Deno.test("вікно перегляду: зіпсоване сховище дає умовчання, а не діру", () => {
  const expected = defaultWindow(LAPTOP);

  for (const stored of [null, {}, { x: 1, y: 2 }, { x: 1, y: 2, w: "800", h: 600 }, "junk"]) {
    assertEquals(restoreWindow(stored, LAPTOP), expected);
  }

  // А ціле значення переживає перезавантаження — заради цього все й робилося.
  assertEquals(
    restoreWindow({ x: 100, y: 50, w: 700, h: 500 }, LAPTOP),
    { x: 100, y: 50, w: 700, h: 500 },
  );
});
