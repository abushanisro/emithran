import { Module } from '@nestjs/common';
import { ProjectReportsController } from './project-reports.controller';
import { ProjectReportsService } from './project-reports.service';
import { SupabaseModule } from '@/common/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [ProjectReportsController],
  providers: [ProjectReportsService],
  exports: [ProjectReportsService],
})
export class ProjectReportsModule {}