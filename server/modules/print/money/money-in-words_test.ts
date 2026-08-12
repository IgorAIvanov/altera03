/**
 * Таблиця випадків і є вся цінність цього модуля.
 *
 * Кожен рядок нижче — не «ще один приклад», а місце, де реалізації розходяться:
 * рід розряду, форма за двома останніми цифрами, порожній розряд, округлення
 * копійок. На 1234,56 працює будь-яка реалізація, включно з неправильною.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { amountInWords } from "./money-in-words.ts";

Deno.test("сума прописом: рід належить розряду, а не числу", () => {
  // «дві тисячі», але «два мільйони» — тисяча жіночого роду, мільйон чоловічого.
  assertEquals(amountInWords(2000), "Дві тисячі гривень 00 коп.");
  assertEquals(amountInWords(2_000_000), "Два мільйони гривень 00 коп.");
  assertEquals(amountInWords(1000), "Одна тисяча гривень 00 коп.");
  assertEquals(amountInWords(1_000_000), "Один мільйон гривень 00 коп.");
  // Сама одиниця бере рід валюти: гривня жіночого роду.
  assertEquals(amountInWords(1), "Одна гривня 00 коп.");
  assertEquals(amountInWords(2), "Дві гривні 00 коп.");
  assertEquals(amountInWords(21), "Двадцять одна гривня 00 коп.");
});

Deno.test("сума прописом: форму вибирають ДВІ останні цифри", () => {
  // 11-14 поводяться як «багато», хоч і закінчуються на 1-4.
  assertEquals(amountInWords(11), "Одинадцять гривень 00 коп.");
  assertEquals(amountInWords(111), "Сто одинадцять гривень 00 коп.");
  assertEquals(amountInWords(112), "Сто дванадцять гривень 00 коп.");
  assertEquals(amountInWords(5), "П'ять гривень 00 коп.");
  assertEquals(amountInWords(22), "Двадцять дві гривні 00 коп.");
  assertEquals(amountInWords(101), "Сто одна гривня 00 коп.");
});

Deno.test("сума прописом: порожній розряд гривень усе одно названий", () => {
  // 1000 — це «одна тисяча ГРИВЕНЬ», а не «одна тисяча».
  assertEquals(amountInWords(1000), "Одна тисяча гривень 00 коп.");
  assertEquals(amountInWords(1_000_000), "Один мільйон гривень 00 коп.");
  // Порожня трійка посередині не лишає діри.
  assertEquals(amountInWords(1_000_001), "Один мільйон одна гривня 00 коп.");
});

Deno.test("сума прописом: копійки цифрами, дві позиції", () => {
  assertEquals(amountInWords(1234.56), "Одна тисяча двісті тридцять чотири гривні 56 коп.");
  assertEquals(amountInWords(0.01), "Нуль гривень 01 коп.");
  assertEquals(amountInWords(0), "Нуль гривень 00 коп.");
  assertEquals(amountInWords(5.5), "П'ять гривень 50 коп.");
});

Deno.test("сума прописом: з бази число приходить рядком", () => {
  // Перегін numeric через number — те місце, де 1234.56 стає 1234.5599999999.
  assertEquals(amountInWords("1234.56"), "Одна тисяча двісті тридцять чотири гривні 56 коп.");
  assertEquals(amountInWords("0.10"), "Нуль гривень 10 коп.");
  assertEquals(amountInWords("-5"), "Мінус п'ять гривень 00 коп.");
});

Deno.test("сума прописом: округлення половини вгору, з переносом у гривні", () => {
  assertEquals(amountInWords("1.005"), "Одна гривня 01 коп.");
  assertEquals(amountInWords("1.004"), "Одна гривня 00 коп.");
  // 0.999 округлюється в 100 копійок — це вже гривня, а не «00 коп.».
  assertEquals(amountInWords("0.999"), "Одна гривня 00 коп.");
});

Deno.test("сума прописом: незнайоме відхиляється, а не вгадується", () => {
  assertThrows(() => amountInWords(1, { currency: "USD" }), Error, "USD");
  assertThrows(() => amountInWords(1, { locale: "pl" }), Error, "pl");
  assertThrows(() => amountInWords("1 000,00"), Error, "не число");
  assertThrows(() => amountInWords(1_000_000_000_000), Error, "межу");
});

Deno.test("сума прописом: російська — форма 2-4 інша, ніж українська", () => {
  const ru = { locale: "ru" };
  // «два мільйони» проти «два миллионА»: у формі 2-4 тут родовий однини, і
  // саме тому мови розведені словниками, а не заміною літер.
  assertEquals(amountInWords(2_000_000, ru), "Два миллиона гривен 00 коп.");
  assertEquals(amountInWords(2000, ru), "Две тысячи гривен 00 коп.");
  assertEquals(amountInWords(1, ru), "Одна гривна 00 коп.");
  assertEquals(amountInWords(2, ru), "Две гривны 00 коп.");
  assertEquals(amountInWords(111, ru), "Сто одиннадцать гривен 00 коп.");
  assertEquals(amountInWords(21, ru), "Двадцать одна гривна 00 коп.");
  assertEquals(amountInWords(0, ru), "Ноль гривен 00 коп.");
  assertEquals(
    amountInWords("1234.56", ru),
    "Одна тысяча двести тридцать четыре гривны 56 коп.",
  );
});

Deno.test("сума прописом: англійська — дефіс, однина розряду, дві форми валюти", () => {
  const en = { locale: "en" };
  assertEquals(amountInWords(21, en), "Twenty-one hryvnias 00 kop.");
  assertEquals(amountInWords(1, en), "One hryvnia 00 kop.");
  // Розряд у множину не ставиться: «two thousand», не «two thousands».
  assertEquals(amountInWords(2000, en), "Two thousand hryvnias 00 kop.");
  assertEquals(amountInWords(111, en), "One hundred eleven hryvnias 00 kop.");
  assertEquals(amountInWords(0, en), "Zero hryvnias 00 kop.");
  assertEquals(
    amountInWords("1234.56", en),
    "One thousand two hundred thirty-four hryvnias 56 kop.",
  );
  assertEquals(amountInWords("-5", en), "Minus five hryvnias 00 kop.");
});

Deno.test("сума прописом: довге число цілком", () => {
  assertEquals(
    amountInWords("987654321.12"),
    "Дев'ятсот вісімдесят сім мільйонів шістсот п'ятдесят чотири тисячі " +
      "триста двадцять одна гривня 12 коп.",
  );
});
