import { Module } from '@nestjs/common';
import { VaveController } from './vave.controller';
import { VaveService } from './vave.service';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [VaveController],
  providers: [VaveService],
  exports: [VaveService],
})
export class VaveModule {}
