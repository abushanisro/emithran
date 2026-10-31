// Which browser origins may call the API with credentials.
//
// The local frontend (localhost / 127.0.0.1 on port 3000) is allowed only outside production: in production a page served from
// a visitor's own machine must not be able to make credentialed requests. CORS_ORIGIN, the Railway domain and the hosted
// frontends are allowed everywhere. Matching is exact; a prefix match would also let "http://localhost:3000.attacker.example".

export interface CorsSettings {
  nodeEnv?: string;
  corsOrigin?: string;
  railwayPublicDomain?: string;
}

const LOCAL_FRONTENDS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

export function isAllowedCorsOrigin(requestOrigin: string | undefined, settings: CorsSettings): boolean {
  // No Origin header: not a cross-origin browser request (server-to-server, curl, same-origin navigation).
  if (!requestOrigin) return true;

  const allowed = [
    settings.corsOrigin,
    settings.railwayPublicDomain ? `https://${settings.railwayPublicDomain}` : undefined,
    ...(settings.nodeEnv === 'production' ? [] : LOCAL_FRONTENDS),
  ].filter((origin): origin is string => Boolean(origin));

  return (
    allowed.includes(requestOrigin) ||
    /^https:\/\/mithran(-[a-z0-9]+)?\.vercel\.app$/.test(requestOrigin) ||
    /^https:\/\/([a-z0-9-]+\.)?emithran\.com$/.test(requestOrigin)
  );
}
