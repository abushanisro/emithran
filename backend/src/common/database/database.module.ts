import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseService } from './database.service';
import { UserDirectory } from './user-directory';

/** Global so any module can inject the UserDirectory (and the shared DatabaseService) without re-declaring providers. */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [DatabaseService, UserDirectory],
  exports: [DatabaseService, UserDirectory],
})
export class DatabaseModule {}
