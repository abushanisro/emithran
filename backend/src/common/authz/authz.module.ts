import { Global, Module } from '@nestjs/common';

import { AccessService } from './access.service';

/** Global so the app-wide AuthzGuard and the identity endpoint (auth/me) share one AccessService. */
@Global()
@Module({
  providers: [AccessService],
  exports: [AccessService],
})
export class AuthzModule {}
