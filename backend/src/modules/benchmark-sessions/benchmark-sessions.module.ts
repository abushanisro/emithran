import { Module } from '@nestjs/common';
import { BenchmarkSessionsController } from './benchmark-sessions.controller';
import { BenchmarkSessionsService } from './benchmark-sessions.service';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [BenchmarkSessionsController],
  providers: [BenchmarkSessionsService],
  exports: [BenchmarkSessionsService],
})
export class BenchmarkSessionsModule {}
