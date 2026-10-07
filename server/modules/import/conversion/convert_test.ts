/**
 * Інтерпретатор і шлюз на синтетичних рядках. Справжню сировину перевіряє
 * сухий прогін застосунку; рушій (`engine.ts`) — проба з базою
 * `scripts/import-engine_test.ts`.
 */
import { assertEquals, assertMatch } from "@std/assert";
import { Type } from "@sinclair/typebox";
import { convert } from "./convert.ts";
import { collectRefs, schemaErrors, staticCheck } from "./gate.ts";
import { analytics, calc, constant, enumMap, lineNumber, lookup, ref, rule } from "./rule.ts";

/** Тип субконто джерела → наш вимір: дані набору, тут — один рядок на пробу. */
const DIMENSION_BY_TYPE = { "CatalogRef.СтатьиНалоговыхДеклараций": "declaration_item" };

const Target = Type.Object({
  id: Type.Union([Type.String(), Type.Null()]),
  name: Type.String({ minLength: 1 }),
  kind: Type.String(),
  groupId: Type.Union([Type.String(), Type.Null()]),
  label: Type.Optional(Type.String()),
  life: Type.Optional(Type.Number()),
});

const refOf = (key: string, presentation = key) => ({ ref: key, type: "CatalogRef.X", presentation });

const rows = [
  { Ссылка: refOf("a"), ЭтоГруппа: false, Имя: "Альфа", Вид: { enum: "Юр", type: "EnumRef.В", presentation: "юр" }, Родитель: refOf("g"), Код: "1" },
  { Ссылка: refOf("b"), ЭтоГруппа: false, Имя: "Бета", Вид: { enum: "Фіз", type: "EnumRef.В", presentation: "фіз" }, Родитель: null, Код: "2" },
  { Ссылка: refOf("g"), ЭтоГруппа: true, Имя: "Група", Вид: null, Родитель: null, Код: "" },
];

const declarative = rule({
  source: "Справочник.X",
  refType: "CatalogRef.X",
  query: "x",
  when: { ЭтоГруппа: false },
  key: "Ссылка",
  target: { model: "catalog/x", schema: Target },
  fields: {
    id: constant(null),
    name: "Имя",
    kind: enumMap("Вид", { Юр: "legal", Фіз: "individual" }),
    groupId: ref("Родитель"),
    label: calc(["Имя", "Код"], (name, code) => `${code}: ${name}`),
  },
});

Deno.test("декларація: поля, when, перелічення, маркер посилання", () => {
  const result = convert(declarative, { rows });
  assertEquals(result.errors, []);
  assertEquals(result.filtered, 1);
  assertEquals(result.objects.map((o) => o.key), ["a", "b"]);
  assertEquals(result.objects[0].payload, {
    id: null, name: "Альфа", kind: "legal", groupId: { $ref: refOf("g") }, label: "1: Альфа",
  });
  assertEquals(result.objects[1].payload.groupId, null);
  assertEquals(schemaErrors(Target, result.objects[0].payload), []);
  assertEquals([...collectRefs(result.objects[0].payload)], [["CatalogRef.X", 1]]);
});

Deno.test("перелічення поза картою й дубль ключа — помилки рядків, не мовчанка", () => {
  const broken = [...rows, { ...rows[0], Вид: { enum: "Інше", type: "EnumRef.В", presentation: "?" } }];
  const result = convert(declarative, { rows: broken });
  assertEquals(result.errors.length, 1);
  assertEquals(result.errors[0].message, "@[core.conversion.duplicateKey]");
  const unknown = convert(declarative, { rows: [{ ...rows[1], Ссылка: refOf("c"), Вид: { enum: "Інше", type: "EnumRef.В", presentation: "?" } }] });
  assertMatch(unknown.errors[0].message, /^@\[core\.conversion\.enumUnmapped\]/);
});

Deno.test("шлюз: обов'язкове поле без виразу й чуже поле", () => {
  const partial = rule({
    source: "Справочник.X", query: "x", key: "Ссылка",
    target: { model: "catalog/x", schema: Target },
    fields: { id: constant(null), name: "Имя" },
  });
  assertEquals(staticCheck(partial).map((i) => i.message), [
    '@[core.conversion.gateRequiredField]{"field":"kind"}',
    '@[core.conversion.gateRequiredField]{"field":"groupId"}',
  ]);
});

Deno.test("join: приєднаний рядок під псевдонімом", () => {
  const withJoin = rule({
    source: "Справочник.X", query: "x", key: "Ссылка",
    join: { params: { query: "p", on: "Ссылка", by: "Объект" } },
    target: { model: "catalog/x", schema: Target },
    fields: { id: constant(null), name: "Имя", kind: constant("legal"), groupId: constant(null), life: "params.Срок" },
  });
  const result = convert(withJoin, {
    rows: rows.slice(0, 2),
    joined: { p: [{ Объект: refOf("a"), Срок: 60 }] },
  });
  assertEquals(result.objects.map((o) => o.payload.life), [60, null]);
});

Deno.test("transform: читання поза reads — помилка, пропуск — зі звітом", () => {
  const good = rule({
    source: "Регистр.Y", query: "y",
    target: { model: "document/y", schema: Target },
    transform: {
      why: "тест",
      reads: ["Имя", "Родитель"],
      groupBy: ["Родитель"],
      fn(group, lib) {
        return group.flatMap((row) => {
          if (!row.Родитель) {
            lib.skip(row, "без батька");
            return [];
          }
          return [{ key: String(row.Имя), payload: { id: null, name: String(row.Имя), kind: "k", groupId: lib.ref(row.Родитель) } }];
        });
      },
    },
  });
  const result = convert(good, { rows });
  assertEquals(result.errors, []);
  assertEquals(result.objects.length, 1);
  assertEquals(result.skipped.map((s) => [s.reason, s.count]), [["без батька", 2]]);

  const sneaky = rule({
    ...good,
    transform: { ...good.transform, reads: ["Имя"], groupBy: [], fn: (group) => group.map((row) => ({ key: String(row.Код), payload: {} })) },
  });
  const blocked = convert(sneaky, { rows });
  assertEquals(blocked.errors[0].message, '@[core.conversion.undeclaredRead]{"path":"Код"}');
});

Deno.test("transform: два поля одного join і join без пари — законне читання", () => {
  const withJoin = rule({
    source: "Регистр.Y", query: "y",
    join: { extra: { query: "e", on: "Имя", by: "Имя" } },
    target: { model: "document/y", schema: Target },
    transform: {
      why: "тест",
      reads: ["Имя", "extra.a", "extra.b"],
      fn(group, lib) {
        return group.map((row) => {
          const extra = row.extra as Record<string, unknown> | null;
          lib.warn(row, "перегляд рядка");
          return { key: String(row.Имя), payload: { id: null, name: String(row.Имя), kind: String(extra?.a ?? "-"), groupId: null } };
        });
      },
    },
  });
  const result = convert(withJoin, { rows: rows.slice(0, 2), joined: { e: [{ Имя: "Альфа", a: "x", b: "y" }] } });
  assertEquals(result.errors, []);
  assertEquals(result.objects.map((o) => o.payload.kind), ["x", "-"]);
  assertEquals(result.warnings[0].count, 2);
});

Deno.test("requires: порожнє обов'язкове поле — пропуск із причиною; чуже поле — помилка шлюзу", () => {
  const withRequires = rule({
    source: "Справочник.X",
    refType: "CatalogRef.X",
    query: "x",
    key: "Ref",
    target: { model: "catalog/x", schema: Target },
    fields: { id: constant(null), name: "Name", kind: constant("k"), groupId: constant(null), label: "Label" },
    requires: { label: "без позначки не переноситься" },
  });
  assertEquals(staticCheck(withRequires), []);
  const result = convert(withRequires, {
    rows: [
      { Ref: refOf("a"), Name: "A", Label: "x" },
      { Ref: refOf("b"), Name: "B", Label: "" },
      { Ref: refOf("c"), Name: "C", Label: null },
    ],
  });
  assertEquals(result.objects.map((o) => o.key), ["a"]);
  assertEquals(result.skipped.map((s) => [s.reason, s.count]), [["без позначки не переноситься", 2]]);
  assertEquals(result.errors, []);

  const stray = rule({ ...withRequires, requires: { life: "не заповнюється" } });
  assertEquals(staticCheck(stray).map((i) => i.check), [1]);
});

Deno.test("tables: рядки частини до власника за посиланням, прочитане — з ім'ям частини", () => {
  const Line = Type.Object({ id: Type.Union([Type.String(), Type.Null()]), lineNo: Type.Number(), what: Type.String() });
  const WithLines = Type.Object({ id: Type.Union([Type.String(), Type.Null()]), name: Type.String(), lines: Type.Array(Line) });
  const withLines = rule({
    source: "Справочник.X",
    refType: "CatalogRef.X",
    query: "x",
    key: "Ref",
    target: { model: "catalog/x", schema: WithLines },
    fields: { id: constant(null), name: "Name" },
    tables: {
      lines: { query: "x_lines", section: "Part", by: "Ref", order: "N", fields: { id: constant(null), lineNo: "N", what: "What" } },
    },
  });
  assertEquals(staticCheck(withLines), []);
  const result = convert(withLines, {
    rows: [{ Ref: refOf("a"), Name: "A" }, { Ref: refOf("b"), Name: "B" }],
    joined: { x_lines: [{ Ref: refOf("a"), N: 2, What: "y" }, { Ref: refOf("a"), N: 1, What: "x" }] },
  });
  assertEquals(result.objects.map((o) => (o.payload.lines as Array<{ what: string }>).map((l) => l.what)), [["x", "y"], []]);
  assertEquals(result.read.filter((path) => path.startsWith("Part.")), ["Part.N", "Part.Ref", "Part.What"]);
  assertEquals(result.unread, []);

  const missing = convert(withLines, { rows: [{ Ref: refOf("a"), Name: "A" }] });
  assertEquals(missing.errors.map((e) => e.at), ["table:lines"]);

  const stray = rule({ ...withLines, tables: { lines: { query: "x_lines", section: "Part", by: "Ref", order: "N", fields: { id: constant(null), what: "What" } } } });
  assertEquals(staticCheck(stray).map((i) => i.check), [2]);
});

Deno.test("analytics: порожній рахунок — порожньо, стаття декларації — своїм виміром", () => {
  const Line = Type.Object({ id: Type.Union([Type.String(), Type.Null()]), name: Type.String(), analytics: Type.Record(Type.String(), Type.Unknown()) });
  const withAnalytics = rule({
    source: "Справочник.X",
    refType: "CatalogRef.X",
    query: "x",
    key: "Ref",
    target: { model: "catalog/x", schema: Line },
    fields: { id: constant(null), name: "Name", analytics: analytics("Acc", ["S1", "S2"], DIMENSION_BY_TYPE) },
  });
  const accounts = { "6413": { code: "6413", type: "passive", offBalance: false, dimensions: ["declaration_item"] } };
  const item = { ref: "d1", type: "CatalogRef.СтатьиНалоговыхДеклараций", presentation: "00601" };
  const result = convert(withAnalytics, {
    rows: [
      { Ref: refOf("a"), Name: "A", Acc: { ref: "acc", type: "ChartOfAccountsRef.Хозрасчетный", presentation: "6413" }, S1: item, S2: null },
      { Ref: refOf("b"), Name: "B", Acc: null, S1: item, S2: null },
    ],
    accounts,
  });
  assertEquals(result.objects.map((o) => o.payload.analytics), [{ declaration_item: { $ref: item } }, {}]);
  assertEquals(result.unread, []);
});

Deno.test("tables: колонки власника й порядку — з умовчань набору; не названо ніде — помилка частини", () => {
  const Line = Type.Object({ lineNo: Type.Number(), what: Type.String() });
  const WithLines = Type.Object({ id: Type.Union([Type.String(), Type.Null()]), lines: Type.Array(Line) });
  const withLines = rule({
    source: "Справочник.X",
    query: "x",
    key: "Ref",
    target: { model: "catalog/x", schema: WithLines },
    fields: { id: constant(null) },
    tables: { lines: { query: "x_lines", section: "Part", fields: { lineNo: lineNumber(), what: "What" } } },
  });
  const input = {
    rows: [{ Ref: refOf("a") }],
    joined: { x_lines: [{ Owner: refOf("a"), Pos: 2, What: "y" }, { Owner: refOf("a"), Pos: 1, What: "x" }] },
  };
  const result = convert(withLines, { ...input, defaults: { tableOwner: "Owner", tableOrder: "Pos" } });
  assertEquals(result.errors, []);
  assertEquals(result.objects[0].payload.lines, [{ lineNo: 1, what: "x" }, { lineNo: 2, what: "y" }]);
  assertEquals(result.unread, []);

  const undeclared = convert(withLines, input);
  assertEquals(undeclared.errors.map((e) => e.message), ['@[core.conversion.tableOwnerUndeclared]{"field":"lines"}']);
});

Deno.test("lookup: значення ключів з рядка, порожній ключ відкинуто, посилання — помилка рядка", () => {
  const Payment = Type.Object({
    id: Type.Union([Type.String(), Type.Null()]),
    counterpartyId: Type.Union([Type.String(), Type.Null()]),
  });
  const statement = rule({
    source: "bank-statement",
    query: "lines",
    key: "OpId",
    target: { model: "document/bank_receipt", schema: Payment },
    fields: {
      id: constant(null),
      counterpartyId: lookup("catalog/counterparty", [
        { edrpou: "PartyCode" },
        { via: "catalog/bank_account", where: { iban: "PartyIban" }, pick: "counterpartyId" },
      ], { orEmpty: "контрагента заводить людина" }),
    },
  });
  const result = convert(statement, {
    rows: [
      { OpId: "1", PartyCode: " 12345678 ", PartyIban: "UA01" },
      { OpId: "2", PartyCode: "", PartyIban: "UA02" },
      { OpId: "3", PartyCode: null, PartyIban: null },
      { OpId: "4", PartyCode: refOf("x"), PartyIban: null },
    ],
  });
  assertEquals(result.objects.map((o) => o.payload.counterpartyId), [
    {
      $lookup: {
        model: "catalog/counterparty",
        keys: [
          { where: { edrpou: "12345678" } },
          { via: "catalog/bank_account", where: { iban: "UA01" }, pick: "counterpartyId" },
        ],
        label: "12345678",
        orEmpty: "контрагента заводить людина",
      },
    },
    {
      $lookup: {
        model: "catalog/counterparty",
        keys: [{ via: "catalog/bank_account", where: { iban: "UA02" }, pick: "counterpartyId" }],
        label: "UA02",
        orEmpty: "контрагента заводить людина",
      },
    },
    { $lookup: { model: "catalog/counterparty", keys: [], label: "", orEmpty: "контрагента заводить людина" } },
  ]);
  assertEquals(result.errors.map((e) => [e.at, e.message]), [["4", '@[core.conversion.lookupNotScalar]{"path":"PartyCode"}']]);
  assertEquals(result.read, ["OpId", "PartyCode", "PartyIban"]);
  assertEquals(schemaErrors(Payment, result.objects[0].payload), []);
  assertEquals(staticCheck(statement), []);
});
