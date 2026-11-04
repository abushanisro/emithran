import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../common/database/database.module";
import { CastingAnalysisRunner } from "./casting-analysis-runner";
import { SandCastingController } from "./sand-casting.controller";
import { SandCastingService } from "./sand-casting.service";

@Module({
  imports: [DatabaseModule],
  controllers: [SandCastingController],
  providers: [SandCastingService, CastingAnalysisRunner],
  exports: [SandCastingService],
})
export class SandCastingModule {}
