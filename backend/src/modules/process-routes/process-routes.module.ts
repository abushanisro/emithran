import { Module } from '@nestjs/common';
import { ProcessRoutesController } from './process-routes.controller';
import { ProcessRoutesService } from './process-routes.service';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [ProcessRoutesController],
  providers: [ProcessRoutesService],
  exports: [ProcessRoutesService],
})
export class ProcessRoutesModule {}
