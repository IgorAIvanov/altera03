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
import { findProductionMarker, isLocalDatabaseHost } from "@altera/server";

export class UnsafeEnvironmentError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnsafeEnvironmentError";
  }
}

function findRemoteDatabase(): string | null {
  // Ті самі два джерела, що й у configFromEnv, і в тому самому порядку:
  // запобіжник мусить дивитися на ту базу, куди справді піде інструмент.
  // Зіпсований DATABASE_URL тут не діагностують — його розбере сервер;
  // важливо лише, що невідомий хост не рахується локальним.
  // Ті самі два джерела й у тому самому порядку, що в configFromEnv: компоненти
  // сильніші за рядок. Запобіжник мусить дивитися на ту базу, куди справді піде
  // інструмент. Зіпсований DATABASE_URL тут не діагностують — його розбере
  // сервер; важливо лише, що невідомий хост не рахується локальним.
  const pgHost = Deno.env.get("PGHOST")?.trim();
  const url = Deno.env.get("DATABASE_URL")?.trim();

  if (url && !(pgHost && Deno.env.get("PGDATABASE")?.trim())) {
    const host = URL.parse(url)?.hostname ?? "";
    return isLocalDatabaseHost(host) ? null : `DATABASE_URL → ${host || "нерозбірливий хост"}`;
  }

  const host = pgHost || "localhost";
  return isLocalDatabaseHost(host) ? null : `PGHOST=${host}`;
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
