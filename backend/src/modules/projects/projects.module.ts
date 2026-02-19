import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { LoggerModule } from '../../common/logger/logger.module';
import { SupabaseService } from '../../common/supabase/supabase.service';

@Module({
  imports: [
    LoggerModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, SupabaseService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
