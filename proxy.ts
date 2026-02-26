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
  addSecurityHeaders(response)

  // Add performance and monitoring headers
  addMonitoringHeaders(response, request, startTime)

  return response
}

function addSecurityHeaders(response: NextResponse) {
  const isProduction = process.env.NODE_ENV === 'production'
  
  // Generate nonce for CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64').slice(0, 16)
  response.headers.set('x-nonce', nonce)

  // CSP with CAD engine support and PDF viewing (includes Railway CAD engine domain)
  const csp = isProduction 
    ? `default-src 'self'; script-src 'self' 'unsafe-inline' https://vercel.live https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vercel.live https://*.railway.app https://mithran-production.up.railway.app https://mithran-production-dc9d.up.railway.app; object-src 'self' data: https://*.supabase.co; frame-src 'self' https://vercel.live https://*.vercel.live https://*.supabase.co; base-uri 'self'; form-action 'self'`
    : `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' ws://localhost:* http://localhost:* http://localhost:5000 https://*.supabase.co wss://*.supabase.co https://*.railway.app; font-src 'self' https://fonts.gstatic.com; frame-src 'self' https://*.supabase.co; object-src 'self' data: blob: https://*.supabase.co`
  
  response.headers.set('Content-Security-Policy', csp)

  // Core security headers - X-Frame-Options removed to allow Supabase auth iframe
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-DNS-Prefetch-Control', 'on')
  response.headers.set('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), fullscreen=(self), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()')

  // Remove server fingerprinting
  response.headers.delete('X-Powered-By')
  response.headers.set('Server', '')

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