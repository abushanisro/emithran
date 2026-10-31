import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SupabaseModule } from '../../common/supabase/supabase.module';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { Auth0TokenVerifier } from './auth0-token-verifier';
import { AuthController } from './auth.controller';
import { IdentityService } from './identity.service';

/** Global so the app-wide guard can use IdentityService: Auth0 is the only sign-in. */
@Global()
@Module({
  imports: [SupabaseModule],
  controllers: [AuthController],
  providers: [
    {
      provide: IdentityService,
      inject: [ConfigService, SupabaseService],
      useFactory: (config: ConfigService, db: SupabaseService): IdentityService => {
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
