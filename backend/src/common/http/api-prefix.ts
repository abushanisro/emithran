import { RequestMethod, type INestApplication, VersioningType } from '@nestjs/common';

/**
 * Every route is /api/v1/<resource> (docs/API.md): the global prefix is `api`, the version is `v1`, and a controller names only
 * its resource (path 'projects', version '1'). The health checks are /api/health/* (no version), and the
 * liveness routes GET / and GET /ping stay at the root, outside the prefix, for the probes that call them.
 * A breaking change ships as `v2` beside `v1`; there is no second spelling of a path.
 */
export function configureApiPrefix(app: INestApplication): void {
  app.setGlobalPrefix('api', {
    exclude: [{ path: '/', method: RequestMethod.GET }, { path: 'ping', method: RequestMethod.GET }],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
}
