import { dirname, fromFileUrl, resolve } from "jsr:@std/path@^1.1.2";
import { assembleSqlPackage } from "../../../scripts/assemble-sql-package.ts";
import { publishAppSql } from "./publish-app-sql.ts";

async function migrate() {
  console.log("🔄 Backend file migrations are deprecated. Publishing app SQL package instead...");
  const databaseDir = dirname(fromFileUrl(import.meta.url));
  const appDir = resolve(databaseDir, "../../../app");
  await assembleSqlPackage(appDir, { verbose: true });
  await publishAppSql({ verbose: true });
  console.log("✅ SQL package publication complete");
}

if (import.meta.main) {
  migrate().catch((err) => {
    console.error("❌ Migration failed:", err);
    Deno.exit(1);
  });
}
