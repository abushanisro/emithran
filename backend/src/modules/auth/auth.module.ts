import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SupabaseModule } from '../../common/supabase/supabase.module';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { Auth0TokenVerifier } from './auth0-token-verifier';
import { AuthController } from './auth.controller';
import { IdentityService } from './identity.service';

/** Global so the app-wide guard can use IdentityService; provided only when AUTH_BACKEND=auth0, so the default build is unchanged. */
@Global()
@Module({
  imports: [SupabaseModule],
  controllers: [AuthController],
  providers: [
    {
      provide: IdentityService,
      inject: [ConfigService, SupabaseService],
      useFactory: (config: ConfigService, db: SupabaseService): IdentityService | undefined => {
        if (config.get<string>('AUTH_BACKEND') !== 'auth0') return undefined;
        const verifier = Auth0TokenVerifier.forTenant(
          config.getOrThrow<string>('AUTH0_DOMAIN'),
          config.getOrThrow<string>('AUTH0_AUDIENCE'),
          config.getOrThrow<string>('AUTH0_CLAIM_NAMESPACE'),
        );
        return new IdentityService(verifier, db);
      },
    },
  ],
  exports: [IdentityService],
})
export class AuthModule {}
