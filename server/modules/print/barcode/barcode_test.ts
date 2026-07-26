/**
 * Проби генераторів штрих-кодів: `deno task test:unit`.
 *
 * Штрих-код — рідкісний випадок, коли помилку не видно взагалі: покручений код
 * виглядає як нормальний, і виявляється аж сканером на складі. Тому перевіряємо
 * не «щось намалювалося», а **інваріанти символік**: суми модулів, унікальність
 * шаблонів, контрольні суми й відомі вектори.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { BarcodeValueError, CODE128_PATTERNS_FOR_TEST, encodeCode128 } from "./code128.ts";
import { EAN13_CODES_FOR_TEST, ean13Checksum, encodeEan13 } from "./ean13.ts";
import { buildBarcode } from "./barcode.ts";

function moduleString(modules: boolean[]): string {
  return modules.map((module) => (module ? "1" : "0")).join("");
}

Deno.test("Code 128: таблиця шаблонів ціла", async (t) => {
  const patterns = CODE128_PATTERNS_FOR_TEST;

  await t.step("рівно 107 значень", () => {
    assertEquals(patterns.length, 107);
  });

  // Головний захист від одруківки: у Code 128 кожен символ — рівно 11 модулів.
  // Змінена цифра майже завжди ламає суму, і тест ловить її тут, а не на папері.
  await t.step("кожен символ 0–105 має 11 модулів", () => {
    patterns.slice(0, 106).forEach((pattern, index) => {
      const sum = [...pattern].reduce((total, width) => total + Number(width), 0);
      assertEquals(sum, 11, `шаблон ${index} (${pattern}) має ${sum} модулів замість 11`);
      assertEquals(pattern.length, 6, `шаблон ${index} має ${pattern.length} елементів замість 6`);
    });
  });

  await t.step("стоп-символ — 13 модулів у семи елементах", () => {
    const stop = patterns[106]!;
    assertEquals(stop, "2331112");
    assertEquals([...stop].reduce((total, width) => total + Number(width), 0), 13);
  });

  // Транспозицію цифр сума не ловить, а от збіг двох шаблонів — ловить:
  // у справжній таблиці всі 107 різні.
  await t.step("усі шаблони різні", () => {
    assertEquals(new Set(patterns).size, patterns.length);
  });

  // Службові значення стоять на своїх місцях — отже, таблиця не зсунута.
  await t.step("службові символи на своїх індексах", () => {
    assertEquals(patterns[103], "211412", "Start A");
    assertEquals(patterns[104], "211214", "Start B");
    assertEquals(patterns[105], "211232", "Start C");
  });
});

Deno.test("Code 128: кодування", async (t) => {
  // Порахований вручну вектор: Start B(104) + 'A'(33) + 'B'(34), контрольна сума
  // (104·1 + 33·1 + 34·2) mod 103 = 205 mod 103 = 102, далі стоп.
  await t.step("«AB» дає очікувані модулі", () => {
    const expected = ["211214", "111323", "131123", "411131", "2331112"]
      .map((pattern) => {
        let isBar = true;
        let bits = "";
        for (const width of pattern) {
          bits += (isBar ? "1" : "0").repeat(Number(width));
          isBar = !isBar;
        }
        return bits;
      })
      .join("");

    assertEquals(moduleString(encodeCode128("AB").modules), expected);
  });

  await t.step("довжина кратна 11 плюс стоп", () => {
    for (const value of ["A", "AB", "12345", "Накладна".slice(0, 0) + "INV-000123"]) {
      const { modules } = encodeCode128(value);
      assertEquals((modules.length - 13) % 11, 0, `«${value}» дає ${modules.length} модулів`);
    }
  });

  // Code C стискає пари цифр — довгий номер має вийти коротшим за той самий
  // номер, набраний посимвольно. Якщо перехід зламається, код лишиться
  // читабельним, але роздутим, і помітити це інакше майже неможливо.
  await t.step("довгий цифровий номер іде в Code C", () => {
    const digits = encodeCode128("1234567890").modules.length;
    const letters = encodeCode128("ABCDEFGHIJ").modules.length;
    assert(digits < letters, `цифри ${digits} модулів, літери ${letters} — стиснення не спрацювало`);
  });

  await t.step("код починається і закінчується штрихом", () => {
    const { modules } = encodeCode128("INV-000123");
    assertEquals(modules[0], true);
    assertEquals(modules[modules.length - 1], true);
  });

  await t.step("порожнє значення й не-ASCII відхиляються", () => {
    assertThrows(() => encodeCode128(""), BarcodeValueError);
    assertThrows(() => encodeCode128("Накладна"), BarcodeValueError);
  });
});

Deno.test("EAN-13", async (t) => {
  await t.step("набори G і R похідні від L", () => {
    const { L_CODES, G_CODES, R_CODES } = EAN13_CODES_FOR_TEST;

    L_CODES.forEach((left, digit) => {
      // R — побітове доповнення L, G — R навпаки.
      const complement = [...left].map((bit) => (bit === "0" ? "1" : "0")).join("");
      assertEquals(R_CODES[digit], complement, `R для ${digit}`);
      assertEquals(G_CODES[digit], [...complement].reverse().join(""), `G для ${digit}`);
      // Кожна цифра — рівно два штрихи й два пропуски в семи модулях.
      assertEquals(left.length, 7);
    });
  });

  await t.step("контрольна цифра рахується як у стандарті", () => {
    // Класичний вектор: 4006381333931 — остання цифра контрольна.
    assertEquals(ean13Checksum("400638133393"), 1);
    assertEquals(ean13Checksum("590123412345"), 7);
  });

  await t.step("довжина коду — 95 модулів", () => {
    assertEquals(encodeEan13("4006381333931").modules.length, 95);
    assertEquals(encodeEan13("400638133393").modules.length, 95);
  });

  await t.step("12 цифр доповнюються контрольною", () => {
    assertEquals(encodeEan13("400638133393").text, "4006381333931");
  });

  await t.step("охоронні шаблони на місці", () => {
    const bits = moduleString(encodeEan13("4006381333931").modules);
    assertEquals(bits.slice(0, 3), "101", "лівий охоронний");
    assertEquals(bits.slice(45, 50), "01010", "центральний охоронний");
    assertEquals(bits.slice(92), "101", "правий охоронний");
  });

  // Чужу контрольну цифру не виправляємо мовчки: розбіжність означає помилку в
  // довіднику, і друк не має її ховати.
  await t.step("невірна контрольна цифра відхиляється", () => {
    assertThrows(() => encodeEan13("4006381333930"), BarcodeValueError);
    assertThrows(() => encodeEan13("12345"), BarcodeValueError);
    assertThrows(() => encodeEan13("40063813339ab"), BarcodeValueError);
  });
});

Deno.test("buildBarcode", async (t) => {
  await t.step("QR тримає кирилицю й має тиху зону", () => {
    const result = buildBarcode("qr", "Накладна №123");
    assert(result.ok);
    assert(result.shape.kind === "matrix");

    const { size, modules } = result.shape;
    assertEquals(modules.length, size * size);

    // Чотири модулі тихої зони з кожного боку: перший і останній рядки порожні.
    for (let column = 0; column < size; column += 1) {
      assertEquals(modules[column], false, "верхній рядок тихої зони");
      assertEquals(modules[(size - 1) * size + column], false, "нижній рядок тихої зони");
    }

    // Кутовий шукач стоїть одразу за тихою зоною.
    assertEquals(modules[4 * size + 4], true);
  });

  await t.step("невірне значення повертається повідомленням, а не винятком", () => {
    const result = buildBarcode("ean13", "не-цифри");
    assert(!result.ok);
    assert(result.message.includes("EAN-13"));
  });

  await t.step("порожнє значення теж не валить друк", () => {
    const result = buildBarcode("code128", "   ");
    assert(!result.ok);
  });
});
