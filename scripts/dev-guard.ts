/**
 * Запобіжник для інструментів розробника (`deno task smoke`, `deno task api`).
 *
 * Обидва піднімають застосунок у процесі й ходять у ту саму базу, що й
 * `deno task dev:server` — тобто беруть БД із `.env`. Промах у `.env` не має
 * коштувати продуктивних даних, тому інструменти самі відмовляються стартувати
 * будь-де, крім локальної розробки. Обходу немає свідомо: якщо запобіжник
 * спрацював, треба виправити оточення, а не вимкнути перевірку.
 */

const PRODUCTION_MARKERS = ["production", "prod", "staging"];
const ENVIRONMENT_VARIABLES = ["NODE_ENV", "APP_ENV", "DENO_ENV"];
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"];

export class UnsafeEnvironmentError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnsafeEnvironmentError";
  }
}

function findProductionMarker(): string | null {
  for (const name of ENVIRONMENT_VARIABLES) {
    const value = Deno.env.get(name)?.trim().toLowerCase();
    if (value && PRODUCTION_MARKERS.includes(value)) {
      return `${name}=${value}`;
    }
  }

  return null;
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
