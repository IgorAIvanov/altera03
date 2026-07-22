import { Module } from "@danet/core";
import { RequestUserService } from "../../common/request-user.service.ts";
import { BlobController } from "./blob.controller.ts";
import { BlobService } from "./blob.service.ts";

@Module({
  controllers: [BlobController],
  injectables: [BlobService, RequestUserService],
})
export class BlobModule {}
