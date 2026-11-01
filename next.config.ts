import type { NextConfig } from 'next'

import { PROXY_CLIENT_MAX_BODY_BYTES } from './lib/server/body-limits'


const nextConfig: NextConfig = {
  // Enable strict mode for better development experience
  reactStrictMode: true,

  // Standalone output is required for the Railway/Docker deployment (node .next/standalone/server.js).
  // Vercel's own build pipeline does its own serverless tracing/bundling and expects the default
  // (non-standalone) .next/ layout — forcing standalone there breaks onBuildComplete with
  // ENOENT on .next/next-server.js.nft.json.
  ...(process.env.VERCEL === '1' ? {} : { output: 'standalone' as const }),

  // Allow cross-origin requests from local network (for testing on other devices)

  // Image optimization configuration
  images: {
    remotePatterns: [],
    // Next.js 16 defaults (explicit for clarity):
    // - minimumCacheTTL: 14400 (4 hours, improved from 60s)
    // - imageSizes: [16, 32, 48, 64, 96, 128, 256, 384] → [32, 48, 64, 96, 128, 256, 384]
    // - qualities: [75] (quality prop coerced to closest value)
    // - maximumRedirects: 3 (was unlimited)
    // - dangerouslyAllowLocalIP: false (security improvement)
  },

  // Turbopack configuration (moved from experimental in Next.js 16)
  turbopack: {
    root: process.cwd(),
  },

  // Experimental features for better performance
  experimental: {
    // Next.js buffers a copy of every body that passes through proxy.ts and truncates it, silently, at this size; it has no
    // "refuse" mode. The limit is therefore set above every route's own limit (lib/server/body-limits.ts): a body a route would
    // accept is never truncated, and a larger one is refused with 413 by the route or the BFF (lib/server/read-body.ts).
    proxyClientMaxBodySize: PROXY_CLIENT_MAX_BODY_BYTES,
    // Enable optimizePackageImports for better bundle size
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-avatar',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-collapsible',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-label',
      '@radix-ui/react-popover',
      '@radix-ui/react-progress',
      '@radix-ui/react-select',
      '@radix-ui/react-separator',
      '@radix-ui/react-slot',
      '@radix-ui/react-switch',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
      '@tanstack/react-query',
      'framer-motion',
      'recharts',
      'date-fns'
    ]
  },

  // Webpack configuration
  webpack: (config) => {
    // Exclude backend directory from webpack compilation
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        '**/node_modules/**',
        '**/backend/**',
        '**/.next/**',
        '**/.git/**',
      ],
    };

    return config;
  },

  // Enable compression
  compress: true,

  // Force rebuild - updated CSP for Railway backend

  // Disable x-powered-by header for security
  poweredByHeader: false,

  async redirects() {
    return [
      { source: '/portal',             destination: '/settings?tab=portal',   permanent: false },
      { source: '/portal/api-keys',    destination: '/settings?tab=api-keys', permanent: false },
      { source: '/portal/logs',        destination: '/settings?tab=portal',   permanent: false },
      { source: '/developer/portal',   destination: '/settings?tab=portal',   permanent: false },
    ];
  },
  // The Content-Security-Policy is set per request in proxy.ts (one definition, every environment).

}

export default nextConfig
