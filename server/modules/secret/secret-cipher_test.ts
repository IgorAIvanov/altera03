import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { importSecretKey, openSecret, sealSecret } from "./secret-cipher.ts";
import { extractSecrets } from "./secret-store.ts";

const keyA = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const keyB = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const owner = { model: "bank_channel", id: "12", field: "token" };

Deno.test("секрет: туди й назад, IV щоразу новий, відбиток ключа сталий", async () => {
  const key = await importSecretKey(keyA);
  const first = await sealSecret(key, "privat-token-123", owner);
  const second = await sealSecret(key, "privat-token-123", owner);
  assertNotEquals(first.iv, second.iv);
  assertEquals(first.keyId, (await importSecretKey(keyA)).id);
  assertEquals(await openSecret([key], first, owner), "privat-token-123");
});

Deno.test("секрет: перенесений в інший рядок не розшифровується", async () => {
  const key = await importSecretKey(keyA);
  const sealed = await sealSecret(key, "privat-token-123", owner);
  await assertRejects(() => openSecret([key], sealed, { ...owner, id: "13" }));
  await assertRejects(() => openSecret([key], sealed, { ...owner, field: "id" }));
});

Deno.test("секрет: старий ключ читає, невідомий — помилка з відбитком", async () => {
  const oldKey = await importSecretKey(keyA);
  const newKey = await importSecretKey(keyB);
  const sealed = await sealSecret(oldKey, "x", owner);
  assertEquals(await openSecret([newKey, oldKey], sealed, owner), "x");
  await assertRejects(() => openSecret([newKey], sealed, owner), Error, sealed.keyId);
});

Deno.test("секрет: ключ не тієї довжини не приймається", async () => {
  await assertRejects(() => importSecretKey(btoa("short")), Error, "32");
  await assertRejects(() => importSecretKey("not base64 at all!"), Error, "32");
});

Deno.test("секрет: save — порожнє не змінює, null стирає, супутні поля прибрано", () => {
  const { payload, changes } = extractSecrets(
    { item: { id: "1", name: "Приват", token: "abc", tokenSet: true, tokenChangedAt: "x", login: "", loginSet: true } },
    ["token", "login", "absent"],
  );
  assertEquals(payload, { item: { id: "1", name: "Приват" } });
  assertEquals(changes, [{ field: "token", value: "abc" }]);
  assertEquals(extractSecrets({ item: { token: null } }, ["token"]).changes, [{ field: "token", clear: true }]);
});
