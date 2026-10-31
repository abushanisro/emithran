import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/common/database/database.module';
import { VendorQuotesController } from './vendor-quotes.controller';
import { VendorQuotesService } from './vendor-quotes.service';

@Module({
  imports: [
    DatabaseModule,
  ],
  controllers: [VendorQuotesController],
  providers: [VendorQuotesService],
  exports: [VendorQuotesService],
})
export class VendorQuotesModule { }