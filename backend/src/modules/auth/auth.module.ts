import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DatabaseModule } from '../../common/database/database.module';
import { DatabaseService } from '../../common/database/database.service';
import { Auth0TokenVerifier } from './auth0-token-verifier';
import { AuthController } from './auth.controller';
import { IdentityService } from './identity.service';

/** Global so the app-wide guard can use IdentityService: Auth0 is the only sign-in. */
@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    {
      provide: IdentityService,
      inject: [ConfigService, DatabaseService],
      useFactory: (config: ConfigService, db: DatabaseService): IdentityService => {
        const verifier = Auth0TokenVerifier.forTenant(
          config.getOrThrow<string>('AUTH0_DOMAIN'),
          config.getOrThrow<string>('AUTH0_AUDIENCE'),
          config.getOrThrow<string>('AUTH0_CLAIM_NAMESPACE'),
        );
        return new IdentityService(verifier, db, {
          trustedConnections: config.getOrThrow<string>('AUTH0_TRUSTED_CONNECTIONS').split(','),
          decisionTtlMs: config.getOrThrow<number>('AUTH_DECISION_CACHE_SECONDS') * 1000,
        });
      },
    },
  ],
  exports: [IdentityService],
})
export class AuthModule {}
