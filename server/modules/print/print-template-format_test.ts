/**
 * Формат значення поля — шов між шаблоном і перетворенням тексту.
 *
 * Перевіряється саме шов: що формат доходить із комірки, що мова й валюта
 * беруться з шаблону, і що помилкове значення не валить документ. Сама
 * граматика чисел живе в `money/money-in-words_test.ts`.
 */
import { assertEquals } from "@std/assert";
import {
  isPrintTemplateElementVisible,
  normalizePrintTemplateSchema,
  stringifyPrintTemplateValue,
} from "./print-template.ts";
import { buildPrintTemplateRenderPlan } from "./print-render-plan.ts";

Deno.test("формат: без нього значення йде як є", () => {
  assertEquals(stringifyPrintTemplateValue(1234.56), "1234.56");
});

Deno.test("порожнє друкується порожнім — прочерк вирішує розробник бланка", () => {
  // Ядро в це не втручається: «нічого» на регламентованій формі виглядає
  // по-різному, і вибір належить тому, хто форму робить.
  assertEquals(stringifyPrintTemplateValue(null), "");
  assertEquals(stringifyPrintTemplateValue(undefined), "");
  assertEquals(stringifyPrintTemplateValue(""), "");
  // Непридатне значення — теж порожнє: позначкою прочерк однаково не був.
  assertEquals(stringifyPrintTemplateValue({ a: 1 }), "");
  assertEquals(stringifyPrintTemplateValue([1, 2]), "");
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

/**
 * Прив'язка текстового блока. Перевіряється і те, що вона доходить, і те, що
 * її не викидає нормалізація: саме мовчазне викидання й було дефектом — шаблон
 * писав `path`, а на бланку лишався «-», і виглядало це як заповнена форма.
 */
Deno.test("текстовий блок: значення береться за прив'язкою", () => {
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [{ key: "b1", type: "text", path: "title", format: "" }],
  });

  assertEquals(schema?.blocks[0].type === "text" ? schema.blocks[0].path : "?", "title");

  const plan = buildPrintTemplateRenderPlan(schema!, { title: "Рахунок на оплату № 12" });
  assertEquals(plan[0].type === "text" ? plan[0].text : "?", "Рахунок на оплату № 12");
});

Deno.test("текстовий блок: статичний текст перекриває прив'язку", () => {
  // Одне правило на весь формат — те саме, що в комірці таблиці й штрих-коді.
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [{ key: "b1", type: "text", value: "Рахунок", path: "title" }],
  });

  const plan = buildPrintTemplateRenderPlan(schema!, { title: "з даних" });
  assertEquals(plan[0].type === "text" ? plan[0].text : "?", "Рахунок");
});

Deno.test("текстовий блок: формат діє й тут", () => {
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [{ key: "b1", type: "text", path: "total", format: "amountInWords" }],
  });

  const plan = buildPrintTemplateRenderPlan(schema!, { total: "2000.00" });
  assertEquals(plan[0].type === "text" ? plan[0].text : "?", "Дві тисячі гривень 00 коп.");
});

// ── Умовна видимість ───────────────────────────────────────────────────────

Deno.test("умова: порожня означає «видно завжди»", () => {
  assertEquals(isPrintTemplateElementVisible({}, ""), true);
  assertEquals(isPrintTemplateElementVisible(null, "  "), true);
});

Deno.test("умова: що вважається хибою", () => {
  const data = {
    yes: true,
    no: false,
    zero: 0,
    one: 1,
    empty: "",
    list: [] as unknown[],
    filled: [1],
    text: "так",
    // Команда даних, що віддає все рядками, — саме той випадок, заради якого
    // текстові написання рахуються хибою (fail-closed).
    textFalse: "false",
    textZero: "0",
    object: { a: 1 },
  };

  assertEquals(isPrintTemplateElementVisible(data, "yes"), true);
  assertEquals(isPrintTemplateElementVisible(data, "one"), true);
  assertEquals(isPrintTemplateElementVisible(data, "filled"), true);
  assertEquals(isPrintTemplateElementVisible(data, "text"), true);
  assertEquals(isPrintTemplateElementVisible(data, "object"), true);

  assertEquals(isPrintTemplateElementVisible(data, "no"), false);
  assertEquals(isPrintTemplateElementVisible(data, "zero"), false);
  assertEquals(isPrintTemplateElementVisible(data, "empty"), false);
  assertEquals(isPrintTemplateElementVisible(data, "list"), false);
  assertEquals(isPrintTemplateElementVisible(data, "textFalse"), false);
  assertEquals(isPrintTemplateElementVisible(data, "textZero"), false);
  // Немає поля взагалі — теж «ні»: помилятися тут безпечніше в бік «сховано».
  assertEquals(isPrintTemplateElementVisible(data, "missing"), false);
});

Deno.test("умова: діє на блоці будь-якого типу, лінію включно", () => {
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [
      { key: "always", type: "text", value: "видно" },
      { key: "stamp", type: "image", path: "org.stamp", visibleWhen: "hasStamp" },
      { key: "rule", type: "horizontal-line", visibleWhen: "hasStamp" },
      { key: "code", type: "barcode", value: "ABC", visibleWhen: "hasStamp" },
    ],
  });

  const shown = buildPrintTemplateRenderPlan(schema!, { hasStamp: true, org: { stamp: "data:," } });
  assertEquals(shown.map((block) => block.key), ["always", "stamp", "rule", "code"]);

  // Підвал із факсиміле — це картинка ПЛЮС риска: сховати частину означало б
  // лишити на бланку висячу лінію.
  const hidden = buildPrintTemplateRenderPlan(schema!, { hasStamp: false });
  assertEquals(hidden.map((block) => block.key), ["always"]);
});

Deno.test("умова: рядок списку полів зникає окремо від блока", () => {
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [{
      key: "b1",
      type: "field-list",
      items: [
        { key: "i1", label: "Разом", path: "total" },
        { key: "i2", label: "У т.ч. ПДВ", path: "vat", visibleWhen: "hasVat" },
      ],
    }],
  });

  const plan = buildPrintTemplateRenderPlan(schema!, { total: "100", vat: "20", hasVat: false });
  const block = plan[0];
  assertEquals(block.type, "field-list");
  if (block.type !== "field-list") return;
  assertEquals(block.items.map((item) => item.key), ["i1"]);
});

Deno.test("умова: схована колонка забирає свої комірки й віддає ширину сусідам", () => {
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [{
      key: "t1",
      type: "table",
      source: "lines",
      columns: [
        { key: "c_name", widthPercent: "50" },
        { key: "c_vat", widthPercent: "25", visibleWhen: "hasVat" },
        { key: "c_total", widthPercent: "25" },
      ],
      sections: {
        header: [{ key: "h1", cells: [{ text: "Назва" }, { text: "ПДВ" }, { text: "Сума" }] }],
        row: [{ key: "r1", cells: [{ path: "name" }, { path: "vat" }, { path: "total" }] }],
        footer: [],
      },
    }],
  });

  const plan = buildPrintTemplateRenderPlan(schema!, {
    hasVat: false,
    lines: [{ name: "Товар", vat: "20", total: "120" }],
  });

  const block = plan[0];
  assertEquals(block.type, "table");
  if (block.type !== "table") return;

  assertEquals(block.columns.map((column) => column.key), ["c_name", "c_total"]);
  // Ваги лишилися 50 і 25 — рендерер ділить за їхньою СУМОЮ, тож 2:1 замість
  // 2:1:1. Окремої арифметики перерозподілу немає й не треба.
  assertEquals(block.columns.map((column) => column.widthWeight), [50, 25]);
  assertEquals(block.header[0].cells.map((cell) => cell.value), ["Назва", "Сума"]);
  assertEquals(block.body[0][0].cells.map((cell) => cell.value), ["Товар", "120"]);
});

Deno.test("умова: об'єднана комірка звужується, а не зникає", () => {
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [{
      key: "t1",
      type: "table",
      source: "lines",
      columns: [
        { key: "c_name", widthPercent: "50" },
        { key: "c_vat", widthPercent: "25", visibleWhen: "hasVat" },
        { key: "c_total", widthPercent: "25" },
      ],
      sections: {
        header: [{ key: "h1", cells: [{ text: "Разом", colSpan: 3 }] }],
        row: [],
        footer: [{ key: "f1", cells: [{ text: "Х", colSpan: 2 }, { text: "Y" }] }],
      },
    }],
  });

  const plan = buildPrintTemplateRenderPlan(schema!, { hasVat: false, lines: [] });
  const block = plan[0];
  if (block.type !== "table") throw new Error("очікувалась таблиця");

  assertEquals(block.header[0].cells[0].colSpan, 2);
  assertEquals(block.footer[0].cells.map((cell) => cell.colSpan), [1, 1]);
});

Deno.test("умова: рядок секції рахується від свого кореня", () => {
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [{
      key: "t1",
      type: "table",
      source: "lines",
      columns: [{ key: "c1", widthPercent: "100" }],
      sections: {
        // Рядок ТІЛА бачить запис…
        row: [
          { key: "r_main", cells: [{ path: "name" }] },
          { key: "r_note", cells: [{ path: "note" }], visibleWhen: "note" },
        ],
        // …а рядок підвалу — дані друку.
        footer: [{ key: "f_vat", cells: [{ text: "Разом ПДВ" }], visibleWhen: "hasVat" }],
        header: [],
      },
    }],
  });

  const plan = buildPrintTemplateRenderPlan(schema!, {
    hasVat: false,
    lines: [{ name: "З приміткою", note: "гарантія 12 міс." }, { name: "Без примітки", note: "" }],
  });

  const block = plan[0];
  if (block.type !== "table") throw new Error("очікувалась таблиця");

  assertEquals(block.body[0].map((row) => row.key), ["r_main", "r_note"]);
  assertEquals(block.body[1].map((row) => row.key), ["r_main"]);
  assertEquals(block.footer.length, 0);
});

Deno.test("умова: таблиця без жодної видимої колонки не друкується зовсім", () => {
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [{
      key: "t1",
      type: "table",
      source: "lines",
      columns: [{ key: "c1", widthPercent: "100", visibleWhen: "never" }],
      sections: { header: [{ key: "h1", cells: [{ text: "Назва" }] }], row: [], footer: [] },
    }],
  });

  assertEquals(buildPrintTemplateRenderPlan(schema!, { lines: [] }).length, 0);
});

Deno.test("умова: наявні шаблони без неї лишаються чинними", () => {
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [{ key: "b1", type: "text", value: "Бланк" }],
  });

  assertEquals(schema?.blocks[0].visibleWhen, "");
  assertEquals(buildPrintTemplateRenderPlan(schema!, {}).length, 1);
});

Deno.test("картинка: береться за прив'язкою, статичний src сильніший", () => {
  const png = "data:image/png;base64,AAAA";
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [
      { key: "b1", type: "image", path: "org.stamp" },
      { key: "b2", type: "image", src: png, path: "org.stamp" },
    ],
  });

  const plan = buildPrintTemplateRenderPlan(schema!, { org: { stamp: "data:image/png;base64,BBBB" } });
  assertEquals(plan[0].type === "image" ? plan[0].src : "?", "data:image/png;base64,BBBB");
  assertEquals(plan[1].type === "image" ? plan[1].src : "?", png);
});

Deno.test("картинка: порожня прив'язка дає порожній src, а не «-»", () => {
  // Через stringifyPrintTemplateValue це не проходить навмисно: його прочерк
  // став би `src="-"`, тобто зламаною картинкою замість відсутньої.
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [{ key: "b1", type: "image", path: "org.stamp" }],
  });

  const plan = buildPrintTemplateRenderPlan(schema!, { org: {} });
  assertEquals(plan[0].type === "image" ? plan[0].src : "?", "");
});

Deno.test("текстовий блок: без значення й прив'язки друкується порожнім", () => {
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [{ key: "b1", type: "text" }],
  });

  const plan = buildPrintTemplateRenderPlan(schema!, {});
  assertEquals(plan[0].type === "text" ? plan[0].text : "?", "");
});
