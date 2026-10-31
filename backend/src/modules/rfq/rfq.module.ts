import { Module } from '@nestjs/common';
import { RfqController } from './rfq.controller';
import { RfqService } from './rfq.service';
import { RfqEmailService } from './services/rfq-email.service';
import { RfqTrackingService } from './services/rfq-tracking.service';
import { VendorsModule } from '../vendors/vendors.module';
import { BOMItemsModule } from '../bom-items/bom-items.module';
import { DatabaseModule } from '../../common/database/database.module';

@Module({
  imports: [DatabaseModule, VendorsModule, BOMItemsModule],
  controllers: [RfqController],
  providers: [RfqService, RfqEmailService, RfqTrackingService],
  exports: [RfqService],
})
export class RfqModule { }