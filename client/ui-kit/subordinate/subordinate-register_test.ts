/**
 * Підпорядкований регістр — правила, у яких помиляються тихо.
 *
 * Проба не чіпає ані шину, ані DOM: перевіряються рівно ті три рішення, ціна
 * помилки в яких — не падіння, а неправильний екран. Відбір за іменем ПОЛЯ
 * замість імені ссылки дає «невідомий фільтр» або (гірше) рядки всіх власників;
 * панель, увімкнена на незбереженій картці, чіпляє рядки нема до чого; правка
 * рядка, поставленого документом, зникає при першому ж перепроведенні.
 */
import { assertEquals } from "@std/assert";
import type { ReactiveControllerHost } from "lit";
import {
  dateLanding,
  ownerFilterKeyOf,
  refNameOf,
  rowLockedByDocument,
  subordinateFilters,
  SubordinateRegister,
} from "./subordinate-register.ts";

/** Мінімальний хост: контролеру від нього потрібен лише requestUpdate. */
const host = { requestUpdate: () => {} } as unknown as ReactiveControllerHost;

interface Row extends Record<string, unknown> {
  id: string;
  period: string;
  rate: number;
  documentId?: string | null;
}

function register(ownerId: () => string | null, extra: Record<string, unknown> = {}) {
  return new SubordinateRegister<Row>(host, {
    model: "currency_rate",
    ownerField: "currencyId",
    ownerId,
    columns: [
      { kind: "date", key: "period", title: "period", required: true },
      { kind: "decimal", key: "rate", title: "rate" },
      { key: "documentId", title: "document", readonly: true },
    ],
    createRow: () => ({ id: "", period: "", rate: 0 }),
    ...extra,
  });
}

/**
 * Ключ відбору — ІМ'Я ССЫЛКИ, а не поля. Згенерований `_list` читає саме його
 * (`v_filters->'currency'->>'id'`), і промах тут не падає: підбір відповідає
 * «невідомий фільтр», а список моделі без відбору мовчки показує чужі рядки.
 */
Deno.test("ключ відбору виводиться з імені поля", () => {
  assertEquals(ownerFilterKeyOf("currencyId"), "currency");
  assertEquals(ownerFilterKeyOf("organizationId"), "organization");
  assertEquals(ownerFilterKeyOf("nomenclatureId"), "nomenclature");
  // Поле без суфікса лишається собою — конвенція не вгадується, а застосовується.
  assertEquals(ownerFilterKeyOf("owner"), "owner");
  // Явне значення сильніше за виведення: `x-ref.as` могли назвати інакше.
  assertEquals(ownerFilterKeyOf("currencyId", "rateCurrency"), "rateCurrency");
});

/**
 * Та сама конвенція працює й у колонці-пікері: комірка пише id у `key`, а
 * об'єкт `{id, name}` — у ссылку. Функція одна на обидва випадки навмисно —
 * розписана двічі, вона розійшлася б на першому ж винятку.
 */
Deno.test("ім'я ссылки колонки — та сама конвенція", () => {
  assertEquals(refNameOf("counterpartyId"), "counterparty");
  assertEquals(refNameOf("counterpartyId", "payer"), "payer");
  assertEquals(ownerFilterKeyOf("currencyId"), refNameOf("currencyId"));
});

/**
 * Рядок, поставлений документом, не правиться з картки: документ переписує свої
 * рядки начисто при перепроведенні, тож правка зникла б МОВЧКИ.
 */
Deno.test("реєстратор блокує рядок", () => {
  assertEquals(rowLockedByDocument({ documentId: "42" }), true);
  assertEquals(rowLockedByDocument({ documentId: "" }), false);
  assertEquals(rowLockedByDocument({ documentId: null }), false);
  assertEquals(rowLockedByDocument({}), false);
});

Deno.test("власне правило блокування перекриває умовчання", () => {
  const reg = register(() => "7", { lockedWhen: (row: Row) => row.rate > 100 });
  assertEquals(reg.locked({ id: "1", period: "", rate: 5 }), false);
  assertEquals(reg.locked({ id: "1", period: "", rate: 500 }), true);
  // Реєстратор при цьому більше ні на що не впливає — правило одне, задане.
  assertEquals(reg.locked({ id: "1", period: "", rate: 5, documentId: "9" }), false);
});

/**
 * У нової картки немає id, і чіпляти до неї рядки нема за що. Панель у такому
 * разі не просто порожня — вона ВИМКНЕНА, і каже про це словами.
 */
Deno.test("незбережена картка: панель не готова, редактор не відкривається", () => {
  const reg = register(() => null);
  assertEquals(reg.ready, false);

  reg.startAdd();
  assertEquals(reg.draft, null, "редактор не має відкриватися без власника");
});

Deno.test("збережена картка: редактор відкривається порожнім рядком", () => {
  const reg = register(() => "7");
  assertEquals(reg.ready, true);

  reg.startAdd();
  assertEquals(reg.draft, { id: "", period: "", rate: 0 });
  assertEquals(reg.editingId, null, "новий рядок не має id");

  reg.cancel();
  assertEquals(reg.draft, null);
});

Deno.test("режим перегляду не дає ані додати, ані правити", () => {
  const reg = register(() => "7", { readonly: () => true });

  reg.startAdd();
  assertEquals(reg.draft, null);

  reg.startEdit({ id: "1", period: "2026-01-01", rate: 41 });
  assertEquals(reg.draft, null);
});

Deno.test("заблокований рядок не відкривається на правку", () => {
  const reg = register(() => "7");

  reg.startEdit({ id: "1", period: "2026-01-01", rate: 41, documentId: "9" });
  assertEquals(reg.draft, null);

  reg.startEdit({ id: "2", period: "2026-01-01", rate: 41 });
  assertEquals(reg.editingId, "2");
});

/**
 * Правка йде в сітці, тож рядок мусить знати, чи накрила його чернетка: без
 * цього в'ю або малювало б контроли в усіх рядках одразу, або в жодному.
 */
Deno.test("правиться рівно той рядок, який відкрили", () => {
  const reg = register(() => "7");
  const row = { id: "2", period: "2026-01-01", rate: 41 };
  reg.rows = [{ id: "1", period: "2025-12-31", rate: 40 }, row];

  reg.startEdit(row);
  assertEquals(reg.editing(row), true);
  assertEquals(reg.editing(reg.rows[0]), false);
  // Рядок став поточним сам: дії панелі дивляться саме на нього.
  assertEquals(reg.currentIndex, 1);

  reg.cancel();
  assertEquals(reg.editing(row), false);
});

/**
 * Дії смуги працюють з поточним рядком, а не з переданим: інакше кожен
 * застосунок тримав би свій «вибраний рядок» поруч із тим, що тримає панель.
 */
Deno.test("дії панелі беруть поточний рядок", () => {
  const reg = register(() => "7");
  reg.rows = [{ id: "1", period: "2026-01-01", rate: 40 }];

  // Нічого не вибрано — правити нема чого, і це не падіння.
  reg.startEdit();
  assertEquals(reg.draft, null);

  reg.select(0);
  assertEquals(reg.current?.id, "1");
  reg.startEdit();
  assertEquals(reg.editingId, "1");
});

/**
 * Новий рядок знімає виділення: два підсвічені рядки означали б два місця,
 * куди дивиться Enter.
 */
Deno.test("новий рядок стає єдиним виділеним", () => {
  const reg = register(() => "7");
  reg.rows = [{ id: "1", period: "2026-01-01", rate: 40 }];
  reg.select(0);

  reg.startAdd();
  assertEquals(reg.currentIndex, -1);
  assertEquals(reg.current, null);
});

/** Фокус ставиться раз на відкриття — в'ю розрізняє відкриття за лічильником. */
Deno.test("кожне відкриття правки має свій номер", () => {
  const reg = register(() => "7");
  reg.rows = [{ id: "1", period: "2026-01-01", rate: 40 }];

  reg.startAdd();
  const first = reg.draftSeq;
  // Набір тексту чернетку пересобирає — але це те саме відкриття.
  reg.patch("period", "2026-06-01");
  assertEquals(reg.draftSeq, first, "правка поля не є новим відкриттям");

  reg.cancel();
  reg.startAdd();
  assertEquals(reg.draftSeq > first, true, "друге «Додати» — інше відкриття");
});

/**
 * Сторінка мала навмисно: курсів валюти за десять років тисячі, і картка, яка
 * вивалює їх усі, перестає бути карткою.
 */
Deno.test("перелік у картці гортається сторінками", () => {
  const reg = register(() => "7");
  assertEquals(reg.pageSize, 10, "умовчання — сторінка картки, а не списку");
  assertEquals(reg.page, 1);

  reg.total = 128;
  assertEquals(reg.pageCount, 13);

  // Порожній перелік — це теж одна сторінка: нуля сторінок не буває, і
  // пагінація на ньому просто не показується.
  reg.total = 0;
  assertEquals(reg.pageCount, 1);
});

/**
 * Перехід до дати — це номер СТОРІНКИ, а не відбір. Помилка на одиницю тут не
 * падає, а тихо показує сусідню сторінку: виглядає як «трохи не туди», і
 * причину в такому вигляді не шукають.
 */
Deno.test("перехід до дати рахує сторінку й рядок на ній", () => {
  // 128 рядків по 10; 100 із них не пізніші за дату → шуканий рядок 28-й.
  assertEquals(dateLanding(128, 100, 10), { page: 3, row: 8 });

  // Дата новіша за весь регістр: перший рядок першої сторінки.
  assertEquals(dateLanding(128, 128, 10), { page: 1, row: 0 });

  // Дата старша за весь регістр — записів «на цю дату» немає взагалі, тож
  // найближчий заповнений це найстаріший рядок, а не порожня сторінка за ним.
  assertEquals(dateLanding(20, 0, 10), { page: 2, row: 9 });
  assertEquals(dateLanding(21, 0, 10), { page: 3, row: 0 });

  // Порожній регістр нікуди не веде й нічого не ламає.
  assertEquals(dateLanding(0, 0, 10), { page: 1, row: 0 });
});

/**
 * Позиція дати рахується ОДНИМ краєм діапазону, і який саме — залежить від
 * напряму перегляду: названа дата мусить лягти на початок сторінки, а не
 * опинитися десь у її середині.
 */
Deno.test("якір дати бере той край діапазону, що відповідає напряму", () => {
  const desc = register(() => "7", { dateField: "period" });
  assertEquals(desc.descending, true, "умовчання — від найсвіжішого");
  assertEquals(desc.anchorFilterKey, "periodTo");

  const asc = register(() => "7", { dateField: "period", sortDir: "asc" });
  assertEquals(asc.anchorFilterKey, "periodFrom");
});

/**
 * Ім'я відбору можна перейменувати в схемі (`x-filter: { op: "range", key:
 * "date" }`), і саме так робить `DocumentHeaderSchema` фреймворку. Панель
 * мусить брати оголошену основу, а не ім'я поля: промах тут не падає, а
 * повертає ВСІ рядки, тобто перехід стає на першу сторінку так, ніби він
 * відпрацював.
 */
Deno.test("перейменований відбір за датою називається явно", () => {
  const desc = register(() => "7", { dateField: "period", dateFilterKey: "date" });
  assertEquals(desc.anchorFilterKey, "dateTo");

  const asc = register(() => "7", {
    dateField: "period",
    dateFilterKey: "date",
    sortDir: "asc",
  });
  assertEquals(asc.anchorFilterKey, "dateFrom");

  // Без перейменування основою лишається саме поле — стара форма не змінилася.
  assertEquals(register(() => "7", { dateField: "period" }).anchorFilterKey, "periodTo");
});

/** Без оголошеного поля дати переходу немає взагалі — fail-closed. */
Deno.test("без dateField перехід до дати не працює", async () => {
  const reg = register(() => "7");
  await reg.goToDate("2026-06-01");
  assertEquals(reg.anchorDate, "", "поля дати немає — якір не ставиться");
});

Deno.test("розмір сторінки задає застосунок", () => {
  const reg = register(() => "7", { pageSize: 25 });
  assertEquals(reg.pageSize, 25);
  reg.total = 26;
  assertEquals(reg.pageCount, 2);
});

Deno.test("обов'язкові комірки чернетки називаються поіменно", () => {
  const reg = register(() => "7");
  reg.startAdd();

  assertEquals(reg.missingFields(), ["period"]);

  reg.patch("period", "2026-06-01");
  assertEquals(reg.missingFields(), []);
});


/**
 * Розріз панелі — другий вимір ключа.
 *
 * Ключ регістру відомостей рідко буває одновимірним: «організація × основний
 * засіб × дата». Панель, яка знає лише власника, показує рядки ВСІХ
 * організацій — і не падає при цьому, а мовчки видає чужі дані за свої.
 */
Deno.test("розріз їде у відбір поруч із власником", () => {
  const filters = subordinateFilters("fixedAsset", "17", { organizationId: "3" });

  assertEquals(filters, {
    fixedAsset: { id: "17" },
    // Ключ — ІМ'Я ССЫЛКИ, значення — `{ id }`: те саме, що читає згенерований
    // `_list` (`v_filters->'organization'->>'id'`).
    organization: { id: "3" },
  });
});

Deno.test("скаляр у розрізі лишається скаляром", () => {
  // Поле без суфікса `Id` — не ссылка: обгортати його в `{ id }` означало б
  // відбір, якого модель не знає.
  assertEquals(
    subordinateFilters("owner", "1", { isActive: true }),
    { owner: { id: "1" }, isActive: true },
  );
});

Deno.test("порожнє значення розрізу робить панель не готовою", () => {
  const reg = register(() => "17", { scope: () => ({ organizationId: "" }) });
  assertEquals(reg.scopeReady, false);
  // Не «без цього відбору», а саме не готова: інакше в цей момент показалися б
  // рядки всіх організацій — рівно те, від чого розріз рятує.
  assertEquals(reg.ready, false);

  const ready = register(() => "17", { scope: () => ({ organizationId: "3" }) });
  assertEquals(ready.ready, true);
});

Deno.test("новий рядок дістає розріз, а не лише власника", () => {
  const reg = register(() => "17", { scope: () => ({ organizationId: "3" }) });
  reg.startAdd();
  // Без цього рядок не записується взагалі: другий вимір ключа порожній, а
  // заповнити його панель не пропонує ніде.
  assertEquals((reg.draft as Record<string, unknown>).organizationId, "3");
});
