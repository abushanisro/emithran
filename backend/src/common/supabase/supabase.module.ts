import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseService } from './supabase.service';
import { UserDirectory } from './user-directory';

/** Global so any module can inject the UserDirectory (and the shared SupabaseService) without re-declaring providers. */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [SupabaseService, UserDirectory],
  exports: [SupabaseService, UserDirectory],
})
export class SupabaseModule {}
