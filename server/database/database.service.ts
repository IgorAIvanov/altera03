import { Injectable } from "@danet/core";
import postgres from "postgres";
import { getServerConfig } from "../config/server-config.ts";

@Injectable()
export class DatabaseService {
  private _sql!: postgres.Sql<Record<string, never>>;

  get sql(): postgres.Sql<Record<string, never>> {
    return this._sql;
  }

  onAppBootstrap() {
    const { host, port, database, username, password, poolSize } = getServerConfig().database;
    this._sql = postgres({ host, port, database, username, password, max: poolSize });
    console.log("✅ Database connection pool created");
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
