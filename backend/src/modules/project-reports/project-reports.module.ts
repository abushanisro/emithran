import { Module } from '@nestjs/common';
import { ProjectReportsController } from './project-reports.controller';
import { ProjectReportsService } from './project-reports.service';
import { DatabaseModule } from '@/common/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ProjectReportsController],
  providers: [ProjectReportsService],
  exports: [ProjectReportsService],
})
export class ProjectReportsModule {}