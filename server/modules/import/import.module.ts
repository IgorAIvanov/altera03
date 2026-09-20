import { Module } from "@danet/core";
import { RequestUserService } from "../../common/request-user.service.ts";
import { ImportController } from "./import.controller.ts";
import { ImportService } from "./import.service.ts";

@Module({
  controllers: [ImportController],
  injectables: [ImportService, RequestUserService],
})
export class ImportModule {}
