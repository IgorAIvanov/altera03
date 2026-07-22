import { Module } from "@danet/core";
import { DatabaseModule } from "./database/database.module.ts";
import { AuthModule } from "./modules/auth/auth.module.ts";
import { BlobModule } from "./modules/blob/blob.module.ts";
import { ModelRuntimeModule } from "./modules/model-runtime/model-runtime.module.ts";
import { ModelViewModule } from "./modules/model-view/model-view.module.ts";
import { AgentModule } from "./modules/agent/agent.module.ts";

@Module({
  imports: [
    DatabaseModule,
    ModelRuntimeModule,
    ModelViewModule,
    AuthModule,
    BlobModule,
    AgentModule,
  ],
})
export class AppModule {}
