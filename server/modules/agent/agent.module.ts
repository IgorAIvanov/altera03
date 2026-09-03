import { Module } from "@danet/core";
import { ModelRuntimeModule } from "../model-runtime/model-runtime.module.ts";
import { AgentController } from "./agent.controller.ts";
import { AgentToolsService } from "./agent-tools.service.ts";
import { AgentService } from "./agent.service.ts";
import { AgentNoteService } from "./agent-note.service.ts";

@Module({
  imports: [ModelRuntimeModule],
  controllers: [AgentController],
  injectables: [AgentService, AgentToolsService, AgentNoteService],
})
export class AgentModule {}
