import { NextResponse } from 'next/server'

import { getAuth0 } from '@/lib/auth0'

import type { NextRequest } from 'next/server'

/**
 * Production-ready proxy with security, performance, and auth protection
 * - Security headers optimization
 * - Request tracing and rate limiting headers
 */

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const startTime = Date.now()

  // Skip middleware for static assets and Next.js internals
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/robots') ||
    pathname.startsWith('/sitemap') ||
    pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2)$/)
  ) {
    return NextResponse.next()
  }

  // Auth0's handler serves /auth/login, /auth/callback, /auth/logout and /auth/profile, and keeps the session cookie rolling on every
  // other request. Our headers are then added to whatever it returns.
  const response = await getAuth0().middleware(request)
  if (pathname.startsWith('/auth/') && !pathname.startsWith('/auth/callback/')) return response

  addSecurityHeaders(response, request)
  addMonitoringHeaders(response, request, startTime)
  return response
}

/**
 * Hosts of the file store, which the browser's 3D viewer downloads models from with signed links (TRUSTED_STORAGE_HOSTS, the same list
 * the file proxy accepts). HTTPS only in production; any port on those hosts in development.
 */
function fileStoreSources(isProduction: boolean): string {
  return (process.env.TRUSTED_STORAGE_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)
    .map((host) => (isProduction ? `https://${host}` : `http://${host}:* https://${host}`))
    .join(' ')
}

function addSecurityHeaders(response: NextResponse, request: NextRequest) {
  const isProduction = process.env.NODE_ENV === 'production'

  // Generate nonce for CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64').slice(0, 16)
  response.headers.set('x-nonce', nonce)

  // CSP with QC module support for PDF viewing, iframes, and file uploads
  // NOTE: PDFs are served from same-origin (/api/file-proxy), not from the file store directly.
  // object-src / frame-src / child-src must include 'self' blob: data: for Chrome's
  // built-in PDF plugin to work when the PDF is loaded through the proxy route.
  const fileStore = fileStoreSources(isProduction)
  const csp = isProduction
    ? [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://vercel.live https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' 'unsafe-inline' data: blob: https://fonts.gstatic.com https://r2cdn.perplexity.ai",
      "img-src 'self' data: blob: https:",
      `connect-src 'self' ${fileStore} https://vercel.live https://*.railway.app https://backend.emithran.com https://cad.emithran.com https://router.project-osrm.org https://maps.googleapis.com https://*.googleapis.com`,
      // 'self' covers /api/file-proxy; blob: covers Chrome PDF plugin internals
      "object-src 'self' blob: data:",
      // frame-src: only 'self' needed — PDF iframe src is now always localhost/api/file-proxy
      "frame-src 'self' blob: data: https://vercel.live https://*.vercel.live https://*.railway.app",
      "media-src 'self' data: blob: https:",
      // child-src is the fallback for frame-src/worker-src in older Chrome
      "child-src 'self' blob: data:",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
    : [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      `connect-src 'self' ws://localhost:* http://localhost:* http://localhost:4000 http://localhost:5055 ${fileStore} https://*.railway.app https://backend.emithran.com https://cad.emithran.com https://router.project-osrm.org`,
      "font-src 'self' 'unsafe-inline' data: blob: https://fonts.gstatic.com",
      // 'self' covers /api/file-proxy; blob: covers Chrome PDF plugin internals
      "object-src 'self' blob: data:",
      // frame-src: 'self' is sufficient — iframe src is always localhost/api/file-proxy
      "frame-src 'self' blob: data:",
      "media-src 'self' data: blob: https:",
      // child-src is the fallback for frame-src/worker-src in older Chrome
      "child-src 'self' blob: data:",
    ].join('; ')

  response.headers.set('Content-Security-Policy', csp)

  // Core security headers
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-DNS-Prefetch-Control', 'on')

  // Special permissions for QC module (PDF viewing, file uploads, etc.)
  const isQCRoute = request.nextUrl.pathname.includes('/quality-control')
  const permissionsPolicy = isQCRoute
    ? 'camera=(), microphone=(), geolocation=(), fullscreen=(self), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), clipboard-read=(self), clipboard-write=(self)'
    : 'camera=(), microphone=(), geolocation=(), fullscreen=(self), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()'

  response.headers.set('Permissions-Policy', permissionsPolicy)

  // Remove server fingerprinting
  response.headers.delete('X-Powered-By')
  response.headers.set('Server', '')

  // NOTE: Cross-Origin-Embedder-Policy: credentialless was removed from QC routes.
  // It prevented Chrome's PDF plugin from loading its internal sub-resources when
  // rendering a proxied PDF (the plugin needs to make credentialed sub-requests).
  // COOP is kept as it only affects pop-up/window relationships.
  if (isQCRoute) {
    response.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  }

  // HSTS in production only
  if (isProduction) {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }

  // Cache control for dynamic content
  response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate')
}

function addMonitoringHeaders(response: NextResponse, request: NextRequest, startTime: number) {
  // Request tracing - Use standard Web API crypto.randomUUID()
  const requestId = crypto.randomUUID()
  response.headers.set('X-Request-ID', requestId)

  // Client IP (respecting proxy headers)
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  response.headers.set('X-Client-IP', clientIp)

  // Basic rate limiting info (headers only - actual limiting should be done at CDN/proxy level)
  response.headers.set('X-RateLimit-Limit', '1000')
  response.headers.set('X-RateLimit-Window', '3600')

  // Response timing
  response.headers.set('X-Response-Time', (Date.now() - startTime).toString())
}

/**
 * Apply middleware to all routes except static assets
 */
export const config = {
  matcher: [
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|favicon.svg|.*\\.(?:jpg|jpeg|gif|png|svg|ico|webp|woff2|woff)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}