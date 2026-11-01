import { Global, Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/** Global, so any feature can record an event by injecting AuditService without importing this module. */
@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
