/**
 * Маркер, що доїхав до агента нерозгорнутим, — це не косметика: агент читає
 * `@[monthClose.productionMethod]` як текст і переказує його людині. Тому
 * розбір під пробою: він чистий, а помилка в ньому не падає.
 */
import { assertEquals } from "@std/assert";
import {
  mergeMessageDictionaries,
  type MessagesConfig,
  resolveMarker,
  resolveMessages,
} from "./messages.ts";

const config: MessagesConfig = {
  dictionaries: {
    uk: {
      "core.lookupUnknownFilter": "Підбір «{model}» не знає відбору «{filter}»",
      "core.onlyUk": "Тільки українською",
    },
    en: {
      "core.lookupUnknownFilter": "The «{model}» picker knows no filter named «{filter}»",
      "core.onlyEn": "English only",
    },
  },
  locale: "uk",
  fallback: "en",
};

Deno.test("маркер із параметрами стає реченням", () => {
  const resolved = resolveMarker(
    '@[core.lookupUnknownFilter]{"model": "report_form_version", "filter": "bogus"}',
    config,
  );
  assertEquals(resolved.text, "Підбір «report_form_version» не знає відбору «bogus»");
  assertEquals(resolved.key, "core.lookupUnknownFilter");
});

Deno.test("ключ їде поруч із текстом — за нього чіпляється питання «де це правило»", () => {
  assertEquals(resolveMarker("@[core.onlyUk]", config).key, "core.onlyUk");
});

Deno.test("текст без маркера не чіпається — це діагностика, а не мова", () => {
  const raw = "duplicate key value violates unique constraint \"uq_bank_code\"";
  assertEquals(resolveMarker(raw, config), { text: raw });
});

Deno.test("невідомий ключ лишає МАРКЕР, а не голий ключ", () => {
  // Клієнт у цьому місці показує ключ, і на екрані це видно людині. Агент же
  // прочитав би `core.nope` як текст і переказав його далі; маркер видно як
  // несправність — до того ж разом із параметрами, які інакше зникли б.
  const raw = '@[core.nope]{"id": 7}';
  const resolved = resolveMarker(raw, config);
  assertEquals(resolved.text, raw);
  assertEquals(resolved.key, "core.nope");
});

Deno.test("обрана мова сильніша за запасну, але запасна рятує відсутній ключ", () => {
  assertEquals(resolveMarker("@[core.lookupUnknownFilter]", config).text, "Підбір «{model}» не знає відбору «{filter}»");
  assertEquals(resolveMarker("@[core.onlyEn]", config).text, "English only");
  assertEquals(
    resolveMarker("@[core.onlyUk]", { ...config, locale: "en", fallback: "uk" }).text,
    "Тільки українською",
  );
});

Deno.test("значення, якого не передали, лишається видимим", () => {
  assertEquals(
    resolveMarker('@[core.lookupUnknownFilter]{"model": "bank"}', config).text,
    "Підбір «bank» не знає відбору «{filter}»",
  );
});

Deno.test("хвіст не JSON — беремо хоч переклад ключа", () => {
  assertEquals(resolveMarker("@[core.onlyUk] щось не те", config).text, "Тільки українською");
});

Deno.test("форма повідомлення зберігається: рядок лишається рядком, об'єкт об'єктом", () => {
  const resolved = resolveMessages(
    [
      "@[core.onlyUk]",
      { type: "error", text: "@[core.onlyUk]", field: "code" },
      { type: "error", text: "звичайний текст" },
    ],
    config,
  );
  assertEquals(resolved[0], "Тільки українською");
  assertEquals(resolved[1], {
    type: "error",
    text: "Тільки українською",
    field: "code",
    key: "core.onlyUk",
  });
  assertEquals(resolved[2], { type: "error", text: "звичайний текст" });
});

Deno.test("порожній словник лишає все як було — це і є запасний варіант", () => {
  const raw = '@[core.lookupUnknownFilter]{"model": "bank", "filter": "x"}';
  const empty: MessagesConfig = { dictionaries: {}, locale: "uk", fallback: "en" };
  assertEquals(resolveMarker(raw, empty).text, raw);
});

Deno.test("злиття словників: застосунок перекриває ядро, мови не змішуються", () => {
  const merged = mergeMessageDictionaries(
    { uk: { "core.a": "ядро", "core.b": "ядро b" }, en: { "core.a": "core" } },
    { uk: { "core.a": "застосунок" } },
  );
  assertEquals(merged.uk["core.a"], "застосунок");
  assertEquals(merged.uk["core.b"], "ядро b");
  assertEquals(merged.en["core.a"], "core");
});
