/**
 * Запобіжник для інструментів розробника (`deno task smoke`, `deno task api`,
 * `deno task passwd`, `deno task sql:publish`).
 *
 * Усі вони ходять у ту саму базу, що й `deno task dev:server` — тобто беруть БД
 * із `.env`. Промах у `.env` не має коштувати продуктивних даних, тому
 * інструменти самі відмовляються стартувати будь-де, крім локальної розробки.
 * Обходу немає свідомо: якщо запобіжник спрацював, треба виправити оточення,
 * а не вимкнути перевірку. Легальний шлях для продуктивної бази — виконати
 * зібраний `_sqlpackage/*.sql` звичайним `psql` (docs/deployment.md, розділ 8).
 */
import { findProductionMarker } from "@altera/server";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"];

export class UnsafeEnvironmentError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnsafeEnvironmentError";
  }
}

function findRemoteDatabase(): string | null {
  const host = (Deno.env.get("DB_HOST") || "localhost").trim().toLowerCase();
  return LOCAL_HOSTS.includes(host) ? null : `DB_HOST=${host}`;
}

/**
 * Кидає {@link UnsafeEnvironmentError}, якщо оточення не схоже на локальну
 * розробку. Викликати першим рядком інструмента, ДО підняття застосунку.
 */
export function assertDevEnvironment(tool: string): void {
  const productionMarker = findProductionMarker();
  if (productionMarker) {
    throw new UnsafeEnvironmentError(
      `${tool}: оточення позначене як не-девелоперське (${productionMarker}). Інструменти розробника тут не працюють.`,
    );
  }

  const remoteDatabase = findRemoteDatabase();
  if (remoteDatabase) {
    throw new UnsafeEnvironmentError(
      `${tool}: база не локальна (${remoteDatabase}). Інструменти розробника ходять у БД із .env — проти віддаленої вони не запускаються.`,
    );
  }
}

/** Те саме, але з друком причини і виходом — для CLI-точок входу. */
export function assertDevEnvironmentOrExit(tool: string): void {
  try {
    assertDevEnvironment(tool);
  } catch (error) {
    console.error(`⛔ ${error instanceof Error ? error.message : error}`);
    Deno.exit(2);
  }
}
