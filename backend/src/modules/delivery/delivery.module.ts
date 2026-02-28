import { Module } from '@nestjs/common';
import { KnexModule } from 'nestjs-knex';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SupabaseModule } from '@/common/supabase/supabase.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { InvoiceController } from './controllers/invoice.controller';
import { InvoiceService } from './services/invoice.service';

@Module({
  imports: [
    SupabaseModule,
    KnexModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        config: {
          client: 'pg',
          connection: {
            host: config.get('SUPABASE_DB_HOST'),
            port: config.get('SUPABASE_DB_PORT', 6543),
            user: config.get('SUPABASE_DB_USER'),
            password: config.get('SUPABASE_DB_PASSWORD'),
            database: config.get('SUPABASE_DB_NAME', 'postgres'),
          },
          migrations: {
            directory: './migrations'
          }
        }
      })
    }),
  ],
  controllers: [
    DeliveryController,
    InvoiceController
  ],
  providers: [
    DeliveryService,
    InvoiceService
  ],
  exports: [
    DeliveryService,
    InvoiceService
  ]
})
export class DeliveryModule {}