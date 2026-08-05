import { Injectable } from "@danet/core";
import postgres from "postgres";
import { getServerConfig } from "../config/server-config.ts";
import { isDatabaseUnavailable } from "./database-error.ts";

/**
 * Скільки чекати на з'єднання. Дефолт драйвера — 30 секунд, і це рівно той час,
 * який браузер висить на білому екрані, коли БД просто не піднята. Для живої бази
 * 10 секунд із запасом достатньо: з'єднання або встановлюється за мілісекунди,
 * або не встановиться взагалі.
 */
const CONNECT_TIMEOUT_SECONDS = 10;

@Injectable()
export class DatabaseService {
  private _sql!: postgres.Sql<Record<string, never>>;

  get sql(): postgres.Sql<Record<string, never>> {
    return this._sql;
  }

  onAppBootstrap() {
    const { host, port, database, username, password, poolSize, ssl } = getServerConfig().database;
    this._sql = postgres({
      host,
      port,
      database,
      username,
      password,
      max: poolSize,
      connect_timeout: CONNECT_TIMEOUT_SECONDS,
      // Керований PostgreSQL (Deno Deploy, Neon, RDS) без TLS не пустить, а
      // локальний контейнер його не пропонує — тому режим приходить з
      // конфігурації, а не зашитий. `false` за замовчуванням: без цього поля
      // розклад лишається таким, як був.
      ssl: ssl ?? false,
    });
    console.log("✅ Database connection pool created");

    // Проба навздогін і без `await`: сервер має підніматися й без БД — інакше
    // під `--watch` вийшов би цикл падінь, а розробник не побачив би навіть
    // причини. Але мовчати теж не можна: без цього рядка перша ознака проблеми —
    // 500 у браузері, з якого не видно, що PostgreSQL просто не запущений.
    void this.probeConnection(host, port, database);
  }

  private async probeConnection(host: string, port: number, database: string) {
    try {
      await this._sql`select 1`;
      console.log(`✅ PostgreSQL ${host}:${port}/${database} відповідає`);
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        console.error(
          `❌ PostgreSQL ${host}:${port}/${database} недоступний. ` +
            `Перевірте, що сервер БД запущений, а PGHOST/PGPORT вказують на нього. ` +
            `Запити до API відповідатимуть 503, доки він не з'явиться.`,
        );
        return;
      }

      console.error(`❌ Не вдалося перевірити з'єднання з ${host}:${port}/${database}:`, error);
    }
  }

  async onAppClose() {
    await this._sql.end();
    console.log("🔌 Database connection pool closed");
  }

  /** Begin a transaction */
  async transaction<T>(
    fn: (sql: postgres.TransactionSql<Record<string, never>>) => Promise<T>,
  ): Promise<T> {
    return await this._sql.begin(async (sql) => {
      return await fn(sql);
    }) as T;
  }
}
