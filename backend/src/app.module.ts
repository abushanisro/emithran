import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { HttpModule } from '@nestjs/axios';
import { APP_GUARD } from '@nestjs/core';

import { ProjectsModule } from './modules/projects/projects.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { BOMsModule } from './modules/boms/boms.module';
import { BOMItemsModule } from './modules/bom-items/bom-items.module';
import { ProcessesModule } from './modules/processes/processes.module';
import { ProcessRoutesModule } from './modules/process-routes/process-routes.module';
import { RawMaterialsModule } from './modules/raw-materials/raw-materials.module';
import { ChildPartsModule } from './modules/child-parts/child-parts.module';
import { PackagingLogisticsModule } from './modules/packaging-logistics/packaging-logistics.module';
import { ProcuredPartsModule } from './modules/procured-parts/procured-parts.module';
import { MHRModule } from './modules/mhr/mhr.module';
import { LSRModule } from './modules/lsr/lsr.module';
import { CalculatorsModule } from './modules/calculators/calculators.module';
import { HealthModule } from './modules/health/health.module';
import { SupplierEvaluationModule } from './modules/supplier-evaluation/supplier-evaluation.module';
import { SupplierEvaluationGroupsModule } from './modules/supplier-evaluation-groups/supplier-evaluation-groups.module';
import { RfqModule } from './modules/rfq/rfq.module';
import { SupplierNominationsModule } from './modules/supplier-nominations/supplier-nominations.module';
import { VendorQuotesModule } from './modules/vendor-quotes/vendor-quotes.module';
import { ProductionPlanningModule } from './modules/production-planning/production-planning.module';
import { ProcessPlanningModule } from './modules/process-planning/process-planning.module';
import { QualityControlModule } from './modules/quality-control/quality-control.module';
import { ProjectReportsModule } from './modules/project-reports/project-reports.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { LoggerModule } from './common/logger/logger.module';
import { SupabaseService } from './common/supabase/supabase.service';
import { SupabaseAuthGuard } from './common/guards/supabase-auth.guard';
import { validate } from './config/env.validation';
import { AppController } from './app.controller';

console.log('🔥 DEBUG: AppController imported:', AppController.name);

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate,
    }),

    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get('THROTTLE_TTL', 60000),
            limit: config.get('THROTTLE_LIMIT', 100),
          },
        ],
      }),
    }),

    HttpModule.register({
      timeout: 5000,
      maxRedirects: 5,
    }),

    LoggerModule,
    ProjectsModule,
    VendorsModule,
    BOMsModule,
    BOMItemsModule,
    ProcessesModule,
    ProcessRoutesModule,
    RawMaterialsModule,
    ChildPartsModule,
    PackagingLogisticsModule,
    ProcuredPartsModule,
    MHRModule,
    LSRModule,
    CalculatorsModule,
    HealthModule,
    SupplierEvaluationModule,
    SupplierEvaluationGroupsModule,
    RfqModule,
    SupplierNominationsModule,
    VendorQuotesModule,
    ProductionPlanningModule,
    ProcessPlanningModule,
    QualityControlModule,
    ProjectReportsModule,
    DeliveryModule,
  ],
  controllers: [AppController],
  providers: [
    SupabaseService,
    {
      provide: APP_GUARD,
      useClass: SupabaseAuthGuard,
    },
  ],
})
export class AppModule {}
