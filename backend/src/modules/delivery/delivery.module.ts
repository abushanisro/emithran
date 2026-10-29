import { Module } from '@nestjs/common';
import { SupabaseModule } from '@/common/supabase/supabase.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { InvoiceController } from './controllers/invoice.controller';
import { InvoiceService } from './services/invoice.service';

@Module({
  imports: [SupabaseModule],
  controllers: [DeliveryController, InvoiceController],
  providers: [DeliveryService, InvoiceService],
  exports: [DeliveryService, InvoiceService],
})
export class DeliveryModule {}
