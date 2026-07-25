/**
 * Встановлення пароля користувача з консолі: `deno task passwd <логін> [пароль]`.
 *
 * Навіщо це окремий інструмент. Пароль ніде, крім TS, не хешується — SQL його
 * не торкається свідомо, щоб схема хешування (PBKDF2-SHA256) жила в одному
 * місці. Тому `app.user_save` пароля не приймає, а новий користувач створюється
 * з порожнім хешем і увійти не може, доки пароль не поставлять.
 *
 * Звідси два реальні випадки:
 *   · користувача завели командою моделі — треба видати йому перший пароль;
 *   · у базі лишився користувач із «сирим» hash-ем (напр. `dev` із ранньої
 *     розробки) — увійти під ним неможливо взагалі, бо перевірка вимагає
 *     префікс `pbkdf2_sha256$`.
 *
 * У продуктиві це робить адмін-екран застосунку — тут запобіжник оточення.
 *
 *   deno task passwd admin                 # згенерує надійний пароль і покаже
 *   deno task passwd admin 'МійПароль123'  # поставить заданий
 */
import postgres from "postgres";
import { configFromEnv, hashPassword } from "@scope/server";
import { assertDevEnvironmentOrExit } from "./dev-guard.ts";

const USAGE = `Використання:
  deno task passwd <логін> [пароль]

Без пароля — згенерує надійний і надрукує його один раз.`;

// Без схожих символів (0/O, 1/l/I): пароль читатимуть з екрана й передиктовуватимуть.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generatePassword(length = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

function fail(message: string): never {
  console.error(`⛔ ${message}\n\n${USAGE}`);
  Deno.exit(2);
}

const [login, providedPassword] = Deno.args.filter((arg) => !arg.startsWith("--"));
if (!login) {
  fail("треба вказати логін");
}

assertDevEnvironmentOrExit("passwd");

const password = providedPassword || generatePassword();
const passwordHash = await hashPassword(password);

const { host, port, database, username, password: dbPassword } = configFromEnv().database;
const sql = postgres({ host, port, database, username, password: dbPassword });

let exitCode = 0;
try {
  const rows = await sql<{ id: string; login: string; full_name: string }[]>`
    UPDATE app.users
    SET password_hash = ${passwordHash}, updated_at = NOW()
    WHERE login = ${login}
    RETURNING id, login, full_name
  `;

  const user = rows[0];
  if (!user) {
    console.error(`⛔ Користувача «${login}» не знайдено`);
    exitCode = 1;
  } else {
    console.log(`\n✅ Пароль встановлено: ${user.login} (id=${user.id}, ${user.full_name})`);
    if (!providedPassword) {
      console.log(`\n   Пароль: ${password}\n`);
      console.log("   Показано один раз — у базі лежить лише хеш.");
    }
  }
} finally {
  await sql.end();
}

Deno.exit(exitCode);
