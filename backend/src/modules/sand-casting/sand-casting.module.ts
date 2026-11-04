import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../common/database/database.module";
import { BomItemDrawDirectionController } from "./bom-item-draw-direction.controller";
import { CastingAnalysisRunner } from "./casting-analysis-runner";
import { SandCastingController } from "./sand-casting.controller";
import { SandCastingService } from "./sand-casting.service";

@Module({
  imports: [DatabaseModule],
  controllers: [SandCastingController, BomItemDrawDirectionController],
  providers: [SandCastingService, CastingAnalysisRunner],
  exports: [SandCastingService],
})
export class SandCastingModule {}
