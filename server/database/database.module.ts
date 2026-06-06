import { Module } from "@danet/core";
import { DatabaseService } from "./database.service.ts";

@Module({
  injectables: [DatabaseService],
})
export class DatabaseModule {}
