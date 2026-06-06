import { Injectable } from "@danet/core";
import postgres from "postgres";

@Injectable()
export class DatabaseService {
  private _sql!: postgres.Sql<Record<string, never>>;

  get sql(): postgres.Sql<Record<string, never>> {
    return this._sql;
  }

  onAppBootstrap() {
    this._sql = postgres({
      host: Deno.env.get("DB_HOST") || "localhost",
      port: Number(Deno.env.get("DB_PORT") || 5432),
      database: Deno.env.get("DB_NAME") || "altera",
      username: Deno.env.get("DB_USERNAME") || "altera",
      password: Deno.env.get("DB_PASSWORD") || "",
      max: 10,
    });
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
