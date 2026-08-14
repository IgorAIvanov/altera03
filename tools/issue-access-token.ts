/**
 * Видача персонального токена з консолі: `deno task token <назва> [--write]`.
 *
 * Навіщо це окремий інструмент. Токени видає `POST /api/auth/tokens`, і тільки
 * по СЕСІЇ — агент, який тримає токен, не має карбувати собі нові. Сесія
 * народжується у браузері, а екрана «Мої токени» в застосунку ще немає, тож
 * поза браузером узяти токен нізвідки: обгортку MCP не підключити, скрипт не
 * написати, пробу проти живої бази не зробити.
 *
 * Той самий клас, що `deno task passwd`: пряма робота з локальною базою під
 * запобіжником оточення. У продуктиві це робить застосунок — тут дев-інструмент.
 *
 *   deno task token claude-code            # тільки читання (умовчання)
 *   deno task token claude-code --write    # з правом запису
 *   deno task token нічна-звірка --days 30 # з протермінуванням
 *
 * Умовчання — «тільки читання», і це не перестраховка: токен успадковує ВСІ
 * права свого користувача, а видають його звичайно для роботи, де запис не
 * потрібен. Помилитися тут можна лише в один бік, і дефолт закриває саме його.
 */
import postgres from "postgres";
import { configFromEnv } from "@altera/server";
import { assertDevEnvironmentOrExit } from "./dev-guard.ts";

const USAGE = `Використання:
  deno task token <назва> [--write] [--days N] [--user <логін>]

Без --write токен тільки на читання. Значення показується ОДИН раз.`;

function fail(message: string): never {
  console.error(`⛔ ${message}\n\n${USAGE}`);
  Deno.exit(2);
}

function flagValue(name: string): string | null {
  const index = Deno.args.indexOf(`--${name}`);
  return index >= 0 ? Deno.args[index + 1] ?? null : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Значення токена — ті самі випадкові байти, що для сесії, і в base64url: у
 * заголовок `Authorization` воно потрапляє як є, тож алфавіт має бути
 * безпечним для HTTP.
 */
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const positional = Deno.args.filter((arg, index) =>
  !arg.startsWith("--") && Deno.args[index - 1] !== "--days" && Deno.args[index - 1] !== "--user"
);
const name = positional[0];
if (!name) {
  fail("треба вказати назву токена — її видно в переліку, і саме за нею його відкликають");
}

assertDevEnvironmentOrExit("token");

const readOnly = !Deno.args.includes("--write");
const days = Number.parseInt(flagValue("days") ?? "", 10);
const login = flagValue("user");

const token = generateToken();
const { host, port, database, username, password, ssl } = configFromEnv().database;
const sql = postgres({ host, port, database, username, password, ssl: ssl ?? false });

let exitCode = 0;
try {
  const owners = login
    ? await sql<{ id: string; login: string }[]>`
        select id::text as id, login from app.users where login = ${login} and is_active = true`
    : await sql<{ id: string; login: string }[]>`
        select id::text as id, login from app.users where is_active = true order by id limit 1`;

  const owner = owners[0];
  if (!owner) {
    console.error(`⛔ Користувача ${login ? `«${login}»` : "у базі"} не знайдено`);
    exitCode = 1;
  } else {
    const [row] = await sql<{ id: string }[]>`
      insert into app.access_token (user_id, name, token_hash, is_read_only, expires_at)
      values (
        ${owner.id}::bigint,
        ${name},
        ${await sha256Hex(token)},
        ${readOnly},
        ${Number.isFinite(days) && days > 0 ? sql`now() + make_interval(days => ${days})` : null}
      )
      returning id::text as id
    `;

    console.log(`\n✅ Токен «${name}» видано: id=${row.id}, власник ${owner.login} (id=${owner.id})`);
    console.log(`   Права: ${readOnly ? "ТІЛЬКИ ЧИТАННЯ" : "читання і запис"}` +
      `${Number.isFinite(days) && days > 0 ? `, діє ${days} дн.` : ", безстроковий"}`);
    console.log(`\n   ${token}\n`);
    console.log("   Показано один раз — у базі лежить лише хеш.");
    console.log(`   Відкликати: delete from app.access_token where id = ${row.id};`);
  }
} finally {
  await sql.end();
}

Deno.exit(exitCode);
