import { Module } from '@nestjs/common';
import { VaveController } from './vave.controller';
import { VaveService } from './vave.service';
import { VaveAiController } from './ai/vave-ai.controller';
import { VaveAiService } from './ai/vave-ai.service';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [VaveController, VaveAiController],
  providers: [VaveService, VaveAiService],
  exports: [VaveService],
})
export class VaveModule {}
