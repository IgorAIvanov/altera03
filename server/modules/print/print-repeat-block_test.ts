/**
 * Блок, що ПОВТОРЮЄТЬСЯ по записах.
 *
 * Перевіряється те, заради чого він є: бланк «по одному аркушу на людину»
 * друкується на всіх, а не на одну. Тому проби дивляться на дві речі — на план
 * рендеру (скільки блоків вийшло і що в них підставлено) і на звіт про
 * розкладку (на якому АРКУШІ кожен запис опинився). Готовий PDF не
 * розбирається навмисно: обидві відповіді ядро знає саме, доти просто не
 * віддаючи їх.
 */
import { assert, assertEquals } from "@std/assert";
import { normalizePrintTemplateSchema } from "./print-template.ts";
import { buildPrintTemplateRenderPlan } from "./print-render-plan.ts";
import { type PrintPdfLayoutEntry, renderPrintPdfWithLayout } from "./print-pdf.renderer.ts";

function textOptions(fontSize = "10") {
  return { fontSize, align: "left", fontWeight: "normal", color: "#000000" };
}

function place(patch: Record<string, string> = {}) {
  return { mode: "flow", xPercent: "0", yPercent: "0", widthPercent: "100", heightPercent: "0", gapPt: "6", ...patch };
}

function text(key: string, patch: Record<string, unknown> = {}) {
  return { key, type: "text", value: key, placement: place(), text: textOptions(), ...patch };
}

/** Повторювач із дефолтами проби: рамка тут ні на що не впливає, і це навмисно. */
function repeat(key: string, source: string, blocks: unknown[], patch: Record<string, unknown> = {}) {
  return { key, type: "repeat", source, blocks, placement: place(), text: textOptions(), ...patch };
}

function planOf(blocks: unknown[], data: unknown) {
  const schema = normalizePrintTemplateSchema({ schemaVersion: 2, blocks });
  assert(schema, "шаблон не пройшов нормалізацію");
  return buildPrintTemplateRenderPlan(schema, data);
}

async function layoutOf(blocks: unknown[], data: unknown): Promise<PrintPdfLayoutEntry[]> {
  const schema = normalizePrintTemplateSchema({ schemaVersion: 2, blocks });
  assert(schema, "шаблон не пройшов нормалізацію");

  const { layout } = await renderPrintPdfWithLayout({
    code: "probe",
    name: "проба",
    targetModel: "probe",
    dataCommand: "print",
    orientation: "portrait",
    schema,
  }, data);

  return layout;
}

const SHEETS = {
  sheets: [
    { personName: "Іваненко І. І.", toPay: "1200.00" },
    { personName: "Петренко П. П.", toPay: "980.50" },
    { personName: "Сидоренко С. С.", toPay: "1540.00" },
  ],
};

Deno.test("повторювач: свої блоки на КОЖЕН запис, а не на перший", () => {
  const plan = planOf([
    repeat("sheet", "sheets", [
      text("title", { value: "", path: "personName" }),
      text("pay", { value: "", path: "toPay" }),
    ]),
  ], SHEETS);

  assertEquals(plan.length, 6);
  assertEquals(
    plan.map((block) => (block.type === "text" ? block.text : "")),
    ["Іваненко І. І.", "1200.00", "Петренко П. П.", "980.50", "Сидоренко С. С.", "1540.00"],
  );
});

Deno.test("повторювач: шлях усередині рахується від ЗАПИСУ, а не від даних бланка", () => {
  // Те саме правило, що в комірці секції `row`. Якби корінь лишався спільним,
  // `personName` не знайшовся б узагалі — і бланк надрукувався б із «-».
  const plan = planOf([
    repeat("sheet", "sheets", [text("title", { value: "", path: "personName" })]),
  ], { personName: "НЕ ВОНО", ...SHEETS });

  assertEquals(plan.map((block) => (block.type === "text" ? block.text : "")), [
    "Іваненко І. І.",
    "Петренко П. П.",
    "Сидоренко С. С.",
  ]);
});

Deno.test("повторювач: ключ у плані несе номер запису", () => {
  // Ключ — те, за чим застосунок шукає свій блок у звіті про розкладку.
  // Тридцять однакових ключів зробили б звіт непридатним рівно там, де він
  // потрібен найбільше.
  const plan = planOf([
    repeat("sheet", "sheets", [text("title"), text("pay")]),
  ], SHEETS);

  assertEquals(plan.map((block) => block.key), [
    "sheet#0.title",
    "sheet#0.pay",
    "sheet#1.title",
    "sheet#1.pay",
    "sheet#2.title",
    "sheet#2.pay",
  ]);
});

Deno.test("повторювач: джерело не масив — бланк друкується без цієї частини", () => {
  assertEquals(planOf([repeat("sheet", "sheets", [text("title")])], {}).length, 0);
  assertEquals(planOf([repeat("sheet", "", [text("title")])], SHEETS).length, 0);
  assertEquals(planOf([repeat("sheet", "sheets", [text("title")])], { sheets: {} }).length, 0);
  assertEquals(planOf([repeat("sheet", "sheets", [])], SHEETS).length, 0);
});

Deno.test("повторювач: умова дочірнього блока читає запис, а умова самого блока — дані бланка", () => {
  const plan = planOf([
    repeat("sheet", "sheets", [
      text("title", { value: "", path: "personName" }),
      text("bonus", { visibleWhen: "hasBonus" }),
    ], { visibleWhen: "printSheets" }),
  ], {
    printSheets: true,
    sheets: [
      { personName: "А", hasBonus: true },
      { personName: "Б", hasBonus: false },
    ],
  });

  assertEquals(plan.map((block) => block.key), ["sheet#0.title", "sheet#0.bonus", "sheet#1.title"]);

  const hidden = planOf([
    repeat("sheet", "sheets", [text("title")], { visibleWhen: "printSheets" }),
  ], { printSheets: false, ...SHEETS });
  assertEquals(hidden.length, 0);
});

Deno.test("повторювач: pageBreakBetween дає по аркушу на запис", async () => {
  const layout = await layoutOf([
    repeat("sheet", "sheets", [
      text("title", { value: "", path: "personName" }),
      text("pay", { value: "", path: "toPay" }),
    ], { pageBreakBetween: true }),
  ], SHEETS);

  assertEquals(layout.map((item) => item.page), [1, 1, 2, 2, 3, 3]);
});

Deno.test("повторювач: без pageBreakBetween записи йдуть стосом на одному аркуші", async () => {
  const layout = await layoutOf([
    repeat("sheet", "sheets", [text("title"), text("pay")], {}),
  ], SHEETS);

  assertEquals(layout.map((item) => item.page), [1, 1, 1, 1, 1, 1]);
  // І саме стосом: кожен наступний нижче попереднього.
  for (let index = 1; index < layout.length; index += 1) {
    assert(layout[index]!.topPt < layout[index - 1]!.topPt, "блоки мусять іти згори вниз");
  }
});

Deno.test("повторювач: pageBreakBefore — про ПЕРШИЙ запис, pageBreakBetween — про наступні", async () => {
  const layout = await layoutOf([
    text("head"),
    repeat("sheet", "sheets", [text("title")], { pageBreakBefore: true, pageBreakBetween: true }),
  ], SHEETS);

  // Шапка бланка лишається на першому аркуші, перший листок починає другий.
  assertEquals(layout.map((item) => item.page), [1, 2, 3, 4]);
});

Deno.test("повторювач: розрив лягає на перший блок, що СПРАВДІ малюється", async () => {
  // Перший за списком блок запису сховано умовою. Якби розрив лишався на ньому,
  // він поїхав би разом із ним — і другий листок надрукувався б під першим.
  const layout = await layoutOf([
    repeat("sheet", "sheets", [
      text("cover", { visibleWhen: "isFirst" }),
      text("title", { value: "", path: "personName" }),
    ], { pageBreakBetween: true }),
  ], {
    sheets: [
      { personName: "А", isFirst: true },
      { personName: "Б", isFirst: false },
    ],
  });

  assertEquals(layout.map((item) => item.key), ["sheet#0.cover", "sheet#0.title", "sheet#1.title"]);
  assertEquals(layout.map((item) => item.page), [1, 1, 2]);
});

Deno.test("повторювач: keepTogether наприкінці запису не з'їдає розрив", async () => {
  // «Не відривати» і «з нового аркуша» — обидва наміри, але другий про АРКУШ.
  // Доти група затягувала в себе початок наступного запису, і розрив зникав
  // мовчки: перевіряється він лише на першому блоці групи.
  const layout = await layoutOf([
    repeat("sheet", "sheets", [
      text("title", { value: "", path: "personName" }),
      text("signature", { keepTogether: true }),
    ], { pageBreakBetween: true }),
  ], SHEETS);

  assertEquals(layout.map((item) => item.page), [1, 1, 2, 2, 3, 3]);
});

Deno.test("повторювач: аркуш на запис можна зверстати КООРДИНАТАМИ", async () => {
  // Затверджена форма верстає шапку координатами — до міліметра. Доти розрив на
  // абсолютному блоці не робив нічого, тож усі записи лягали один поверх одного
  // на єдиному аркуші, і бланк виглядав як зіпсований друк.
  const absolute = (key: string, patch: Record<string, unknown> = {}) => ({
    key,
    type: "text",
    value: key,
    placement: place({ mode: "absolute", yPercent: "10" }),
    text: textOptions(),
    ...patch,
  });

  const layout = await layoutOf([
    repeat("sheet", "sheets", [absolute("title", { value: "", path: "personName" })], { pageBreakBetween: true }),
  ], SHEETS);

  assertEquals(layout.map((item) => item.page), [1, 2, 3]);
  // Координата при цьому лишається координатою: та сама висота на кожному аркуші.
  assertEquals(new Set(layout.map((item) => Math.round(item.topPt))).size, 1);
});

Deno.test("повторювач: таблиця всередині бере джерело від запису", () => {
  const plan = planOf([
    repeat("sheet", "sheets", [
      {
        key: "accruals",
        type: "table",
        source: "lines",
        columns: [{ key: "c1", widthPercent: "100" }],
        sections: {
          header: [{ key: "h", cells: [{ key: "hc", text: "Нарахування" }] }],
          row: [{ key: "r", cells: [{ key: "rc", path: "name" }] }],
          footer: [],
        },
        placement: place(),
        text: textOptions(),
      },
    ]),
  ], {
    sheets: [
      { lines: [{ name: "Оклад" }, { name: "Премія" }] },
      { lines: [{ name: "Оклад" }] },
    ],
  });

  assertEquals(plan.length, 2);
  assert(plan[0]!.type === "table" && plan[1]!.type === "table");
  assertEquals(plan[0]!.body.length, 2);
  assertEquals(plan[1]!.body.length, 1);
});

Deno.test("повторювач: повторювач усередині повторювача зсуває корінь ще раз", () => {
  const plan = planOf([
    repeat("year", "years", [
      text("yearTitle", { value: "", path: "label" }),
      repeat("month", "months", [text("monthTitle", { value: "", path: "label" })]),
    ]),
  ], {
    years: [
      { label: "2026", months: [{ label: "Січень" }, { label: "Лютий" }] },
      { label: "2027", months: [{ label: "Березень" }] },
    ],
  });

  assertEquals(plan.map((block) => block.key), [
    "year#0.yearTitle",
    "year#0.month#0.monthTitle",
    "year#0.month#1.monthTitle",
    "year#1.yearTitle",
    "year#1.month#0.monthTitle",
  ]);
  assertEquals(plan.map((block) => (block.type === "text" ? block.text : "")), [
    "2026",
    "Січень",
    "Лютий",
    "2027",
    "Березень",
  ]);
});

Deno.test("повторювач: нормалізація приймає його з дефолтами й не втрачає дітей", () => {
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [{ key: "sheet", type: "repeat", source: "sheets", blocks: [{ key: "t", type: "text", value: "x" }] }],
  });

  assert(schema);
  const block = schema.blocks[0]!;
  assert(block.type === "repeat");
  assertEquals(block.pageBreakBetween, false);
  assertEquals(block.blocks.length, 1);
  // Дочірній блок проходить ту саму нормалізацію, що й верхній: дефолти на місці.
  assertEquals(block.blocks[0]!.placement.mode, "absolute");
});
