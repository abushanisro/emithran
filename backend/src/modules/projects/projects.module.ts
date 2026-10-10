import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectsRepository } from './projects.repository';
import { LoggerModule } from '../../common/logger/logger.module';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ExchangeRateModule } from '../../common/exchange-rate/exchange-rate.module';

@Module({
  imports: [
    LoggerModule,
    ExchangeRateModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository, SupabaseService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
