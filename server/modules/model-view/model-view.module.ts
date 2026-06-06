import { Module } from "@danet/core";
import { ModelViewController } from "./model-view.controller.ts";
import { ModelViewService } from "./model-view.service.ts";

@Module({
  controllers: [ModelViewController],
  injectables: [ModelViewService],
})
export class ModelViewModule {}
