import { Module } from "@danet/core";

import { SolutionController } from "./solution.controller.ts";
import { SolutionService } from "./solution.service.ts";

@Module({
  controllers: [SolutionController],
  injectables: [SolutionService],
})
export class SolutionModule {}
