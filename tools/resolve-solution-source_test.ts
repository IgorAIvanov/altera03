/**
 * Проби розбору специфікатора джерела.
 *
 * Мережі тут немає навмисно (`test:unit` у неї не ходить): перевіряється рівно
 * те, що ламається мовчки, — межа між локальним шляхом і `власник/репозиторій@тег`.
 * Помилка в цю сторону не падає, а тихо йде не туди: шлях, прийнятий за реліз,
 * дає «404», а реліз, прийнятий за шлях, — «файл не знайдено».
 */
import { assertEquals, assertThrows } from "@std/assert";

import { parseSolutionSource } from "./resolve-solution-source.ts";

Deno.test("локальні шляхи лишаються шляхами", () => {
  for (
    const spec of [
      "./erp-1.2.0.tar.gz",
      "erp-1.2.0.tar.gz",
      "../packages/erp.tar.gz",
      "/srv/deliveries/erp.tar.gz",
      "C:\\deliveries\\erp.tar.gz",
      // Два сегменти й `@` у ІМЕНІ ФАЙЛУ — найнебезпечніший випадок: саме він
      // за формою збігається з релізом, і рятує його лише `.tar.gz`.
      "dist/erp@1.2.0.tar.gz",
    ]
  ) {
    assertEquals(parseSolutionSource(spec), { kind: "file", path: spec }, spec);
  }
});

Deno.test("URL впізнається за схемою", () => {
  assertEquals(parseSolutionSource("https://example.org/erp-1.2.0.tar.gz"), {
    kind: "url",
    url: "https://example.org/erp-1.2.0.tar.gz",
  });
});

Deno.test("реліз GitHub: власник/репозиторій@тег", () => {
  assertEquals(parseSolutionSource("IgorAIvanov/altera-buh@1.2.0"), {
    kind: "github",
    owner: "IgorAIvanov",
    repo: "altera-buh",
    tag: "1.2.0",
  });
  assertEquals(parseSolutionSource("IgorAIvanov/altera-buh@latest"), {
    kind: "github",
    owner: "IgorAIvanov",
    repo: "altera-buh",
    tag: "latest",
  });
  // Тег із префіксом `v` — звичайна практика, і він мусить доїхати як є:
  // GitHub шукає реліз за точним іменем тега.
  assertEquals(parseSolutionSource("IgorAIvanov/altera-buh@v1.2.0"), {
    kind: "github",
    owner: "IgorAIvanov",
    repo: "altera-buh",
    tag: "v1.2.0",
  });
});

Deno.test("префікс github: знімає двозначність із шляхом", () => {
  assertEquals(parseSolutionSource("github:acme/erp@1.2.0"), {
    kind: "github",
    owner: "acme",
    repo: "erp",
    tag: "1.2.0",
  });
  // З явним префіксом мовчазного відкату до шляху бути не може: користувач
  // сказав, чого хоче, і невірна форма мусить відмовити, а не піти шукати файл.
  assertThrows(() => parseSolutionSource("github:acme/erp"), Error, "Не розумію джерело");
});

Deno.test("без тега це шлях, а не реліз", () => {
  assertEquals(parseSolutionSource("acme/erp"), { kind: "file", path: "acme/erp" });
});
