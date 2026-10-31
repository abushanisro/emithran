import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MulterModule } from '@nestjs/platform-express';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';
import { LoggerModule } from '../../common/logger/logger.module';
import { DatabaseModule } from '../../common/database/database.module';

@Module({
  imports: [
    HttpModule,
    LoggerModule,
    DatabaseModule,
    MulterModule.register({
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB for large CSV files
        files: 1,
      },
    }),
  ],
  controllers: [VendorsController],
  providers: [VendorsService],
  exports: [VendorsService],
})
export class VendorsModule { }
