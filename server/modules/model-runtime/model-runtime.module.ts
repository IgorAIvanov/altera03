import { Module } from "@danet/core";
import { RequestUserService } from "../../common/request-user.service.ts";
import { ModelRuntimeController } from "./model-runtime.controller.ts";
import { ModelRuntimeService } from "./model-runtime.service.ts";
import { JobService } from "./job.service.ts";

@Module({
  controllers: [ModelRuntimeController],
  injectables: [ModelRuntimeService, RequestUserService, JobService],
})
export class ModelRuntimeModule {}