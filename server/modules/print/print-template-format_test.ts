/**
 * Формат значення поля — шов між шаблоном і перетворенням тексту.
 *
 * Перевіряється саме шов: що формат доходить із комірки, що мова й валюта
 * беруться з шаблону, і що помилкове значення не валить документ. Сама
 * граматика чисел живе в `money/money-in-words_test.ts`.
 */
import { assertEquals } from "@std/assert";
import {
  normalizePrintTemplateSchema,
  stringifyPrintTemplateValue,
} from "./print-template.ts";
import { buildPrintTemplateRenderPlan } from "./print-render-plan.ts";

Deno.test("формат: без нього значення йде як є", () => {
  assertEquals(stringifyPrintTemplateValue(1234.56), "1234.56");
  assertEquals(stringifyPrintTemplateValue(null), "-");
  assertEquals(stringifyPrintTemplateValue(""), "-");
});

Deno.test("формат: сума прописом бере мову й валюту з оточення", () => {
  assertEquals(
    stringifyPrintTemplateValue("1234.56", "amountInWords"),
    "Одна тисяча двісті тридцять чотири гривні 56 коп.",
  );
  assertEquals(
    stringifyPrintTemplateValue("1234.56", "amountInWords", { locale: "en" }),
    "One thousand two hundred thirty-four hryvnias 56 kop.",
  );
});

Deno.test("формат: помилкове значення друкується текстом, а не валить документ", () => {
  // Те саме рішення, що в штрих-кода: друк — остання ланка, і людина, яка
  // натиснула «Друк», не полагодить ані валюту, ані число.
  assertEquals(stringifyPrintTemplateValue("не число", "amountInWords"), "не число");
  assertEquals(
    stringifyPrintTemplateValue("10", "amountInWords", { currency: "XXX" }),
    "10",
  );
});

Deno.test("шаблон: мова й валюта мають умовчання, невідомий формат — це «як є»", () => {
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [{
      key: "b1",
      type: "field-list",
      items: [{ key: "i1", label: "Сума", path: "total", format: "усно" }],
    }],
  });

  assertEquals(schema?.locale, "uk");
  assertEquals(schema?.currency, "UAH");
  // Шаблон міг приїхати з новішої версії — це не привід відмовитися друкувати.
  assertEquals(
    schema?.blocks[0].type === "field-list" ? schema.blocks[0].items[0].format : "?",
    "",
  );
});

Deno.test("план рендеру: формат доходить із шаблону до значення", () => {
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    locale: "ru",
    currency: "UAH",
    blocks: [{
      key: "b1",
      type: "field-list",
      items: [
        { key: "i1", label: "Сумма", path: "total", format: "amountInWords" },
        { key: "i2", label: "Цифрами", path: "total" },
      ],
    }],
  });

  const plan = buildPrintTemplateRenderPlan(schema!, { total: "2000.00" });
  const block = plan[0];
  assertEquals(block.type, "field-list");
  if (block.type !== "field-list") return;

  assertEquals(block.items[0].value, "Две тысячи гривен 00 коп.");
  // Те саме число поруч цифрами: команда даних про подання не знає.
  assertEquals(block.items[1].value, "2000.00");
});
