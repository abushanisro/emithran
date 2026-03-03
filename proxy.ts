import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Production-ready proxy with security, performance, and auth protection
 * - Security headers optimization
 * - Request tracing and rate limiting headers
 */

export function proxy(request: NextRequest) {
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

  const requestHeaders = new Headers(request.headers)

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })


  // Add comprehensive security headers
  addSecurityHeaders(response, request)

  // Add performance and monitoring headers
  addMonitoringHeaders(response, request, startTime)

  return response
}

function addSecurityHeaders(response: NextResponse, request: NextRequest) {
  const isProduction = process.env.NODE_ENV === 'production'

  // Generate nonce for CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64').slice(0, 16)
  response.headers.set('x-nonce', nonce)

  // CSP with QC module support for PDF viewing, iframes, and file uploads
  // NOTE: PDFs are now served from same-origin (/api/file-proxy) not Supabase directly.
  // object-src / frame-src / child-src must include 'self' blob: data: for Chrome's
  // built-in PDF plugin to work when the PDF is loaded through the proxy route.
  const csp = isProduction
    ? [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://vercel.live https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' 'unsafe-inline' data: blob: https://fonts.gstatic.com https://r2cdn.perplexity.ai",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://iuvtsvjpmovfymvnmqys.supabase.co wss://iuvtsvjpmovfymvnmqys.supabase.co https://emuski.jiobase.com https://*.jiobase.com wss://emuski.jiobase.com wss://*.jiobase.com https://vercel.live https://*.railway.app https://mithran-production.up.railway.app https://mithran-production-dc9d.up.railway.app",
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
      "connect-src 'self' ws://localhost:* http://localhost:* http://localhost:4000 http://localhost:5000 https://*.supabase.co wss://*.supabase.co https://iuvtsvjpmovfymvnmqys.supabase.co wss://iuvtsvjpmovfymvnmqys.supabase.co https://emuski.jiobase.com https://*.jiobase.com wss://emuski.jiobase.com wss://*.jiobase.com https://*.railway.app",
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

  // Core security headers - X-Frame-Options removed to allow Supabase auth iframe
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