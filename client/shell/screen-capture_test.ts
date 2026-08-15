import { assertEquals } from "@std/assert";
import { targetSize } from "./screen-capture.ts";

Deno.test("зменшення кадру: пропорції й поріг", async (t) => {
  await t.step("вужче за поріг — не чіпаємо", () => {
    // Заміряний кадр вкладки: 1438×1200 у JPEG це ~100 КБ, зменшувати нема чого.
    assertEquals(targetSize(1438, 1200), { width: 1438, height: 1200 });
  });

  await t.step("рівно поріг — теж не чіпаємо", () => {
    assertEquals(targetSize(1920, 1080), { width: 1920, height: 1080 });
  });

  await t.step("ширше — зменшуємо, пропорції зберігаються", () => {
    assertEquals(targetSize(3840, 2160), { width: 1920, height: 1080 });
  });

  await t.step("висота округлюється, а не обрізається", () => {
    // 2560×1441 → 1920×1080.75; ціле число тут обов'язкове — canvas дробів не
    // приймає, і мовчазне обрізання дало б зсув пропорцій на високих екранах.
    assertEquals(targetSize(2560, 1441), { width: 1920, height: 1081 });
  });

  await t.step("нульова ширина не ділиться на нуль", () => {
    // Відео без розмірів трапляється між play() і першим кадром.
    assertEquals(targetSize(0, 0), { width: 0, height: 0 });
  });
});
