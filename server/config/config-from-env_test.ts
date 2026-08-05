// Розбір підключення до бази. Проби саме тут, а не через `configFromEnv()`:
// той читає оточення, а `deno task test:unit` ганяється без --allow-env —
// і це правильно, бо перевіряти треба чистий розбір, а не читання змінних.
import { assertEquals, assertThrows } from "@std/assert";
import { parseDatabaseUrl, parseSslMode } from "./config-from-env.ts";

Deno.test("parseSslMode: режими libpq", async (t) => {
  await t.step("порожнє й disable — без TLS", () => {
    assertEquals(parseSslMode(null), false);
    assertEquals(parseSslMode(""), false);
    assertEquals(parseSslMode("  "), false);
    assertEquals(parseSslMode("disable"), false);
  });

  await t.step("проміжні режими проходять як є", () => {
    assertEquals(parseSslMode("allow"), "allow");
    assertEquals(parseSslMode("prefer"), "prefer");
    assertEquals(parseSslMode("require"), "require");
  });

  await t.step("verify-ca зводиться до verify-full — у бік суворішого", () => {
    assertEquals(parseSslMode("verify-ca"), "verify-full");
    assertEquals(parseSslMode("verify-full"), "verify-full");
  });

  await t.step("регістр і пробіли не рахуються", () => {
    assertEquals(parseSslMode(" REQUIRE "), "require");
  });

  // Мовчазний фолбэк на «без TLS» означав би відкрите з'єднання з керованою
  // базою при впевненості, що воно шифроване.
  await t.step("невідомий режим — помилка, а не типове значення", () => {
    assertThrows(() => parseSslMode("ssl"), Error, "Невідомий sslmode");
  });
});

Deno.test("parseDatabaseUrl", async (t) => {
  await t.step("повний рядок керованої бази", () => {
    assertEquals(
      parseDatabaseUrl("postgres://user:secret@db.example.com:6543/altera?sslmode=require"),
      {
        host: "db.example.com",
        port: 6543,
        database: "altera",
        username: "user",
        password: "secret",
        ssl: "require",
      },
    );
  });

  await t.step("порт необов'язковий; локальний хост без sslmode — без TLS", () => {
    assertEquals(parseDatabaseUrl("postgresql://u:p@localhost/altera"), {
      host: "localhost",
      port: 5432,
      database: "altera",
      username: "u",
      password: "p",
      ssl: false,
    });
  });

  // Забути sslmode для керованої бази легко, і наслідок — відкрите з'єднання
  // за впевненості, що воно шифроване. Дефолт закриває саме цей випадок.
  await t.step("віддалений хост без sslmode — TLS увімкнено", () => {
    assertEquals(parseDatabaseUrl("postgres://u:p@db.example.com/altera").ssl, "require");
  });

  await t.step("явний sslmode сильніший за дефолт", () => {
    assertEquals(parseDatabaseUrl("postgres://u:p@db.example.com/altera?sslmode=disable").ssl, false);
  });

  // Так виглядає рядок Prisma Postgres на Deno Deploy: ім'я бази мається на
  // увазі обліковкою. За libpq базою в такому разі є ім'я користувача.
  await t.step("порожній шлях — база за іменем користувача", () => {
    const config = parseDatabaseUrl("postgres://tenant:p@db.prisma.io:5432/?sslmode=require");
    assertEquals(config.database, "tenant");
    assertEquals(config.username, "tenant");
  });

  // У згенерованому паролі трапляється @ або /, і в URL вони екрануються.
  await t.step("логін і пароль декодуються", () => {
    const config = parseDatabaseUrl("postgres://a%40b:p%2Fss%40word@localhost:5432/altera");
    assertEquals(config.username, "a@b");
    assertEquals(config.password, "p/ss@word");
  });

  await t.step("чужа схема не приймається", () => {
    assertThrows(
      () => parseDatabaseUrl("mysql://u:p@localhost/altera"),
      Error,
      "очікувалася схема postgres://",
    );
  });

  await t.step("ані бази, ані користувача — помилка", () => {
    assertThrows(
      () => parseDatabaseUrl("postgres://localhost:5432/"),
      Error,
      "ані імені бази, ані користувача",
    );
  });

  // «host:port» — теж URL з погляду розбирача (схема `localhost:`), тож ловить
  // його перевірка схеми, а не розбір. Повідомлення в обох випадках називає
  // причину, і це головне.
  await t.step("рядок без схеми впирається у перевірку схеми", () => {
    assertThrows(
      () => parseDatabaseUrl("localhost:5432"),
      Error,
      "очікувалася схема postgres://",
    );
  });

  await t.step("не URL узагалі", () => {
    assertThrows(() => parseDatabaseUrl("не url"), Error, "коректним URL");
  });
});
