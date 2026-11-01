import { Module } from '@nestjs/common';
import { CostEngineeringController } from './cost-engineering.controller';
import { CostEngineeringService } from './cost-engineering.service';
import { DatabaseModule } from '../../common/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [CostEngineeringController],
  providers: [CostEngineeringService],
  exports: [CostEngineeringService],
})
export class CostEngineeringModule {}
