import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Enable strict mode for better development experience
  reactStrictMode: true,

  // Enable standalone output for Docker deployment
  output: 'standalone',

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

  // TypeScript configuration for production
  typescript: {
    ignoreBuildErrors: process.env.NODE_ENV === 'production',
  },

  // Experimental features for better performance
  experimental: {
    // Enable optimizePackageImports for better bundle size
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-accordion',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-avatar',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-collapsible',
      '@radix-ui/react-context-menu',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-hover-card',
      '@radix-ui/react-label',
      '@radix-ui/react-menubar',
      '@radix-ui/react-navigation-menu',
      '@radix-ui/react-popover',
      '@radix-ui/react-progress',
      '@radix-ui/react-radio-group',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-select',
      '@radix-ui/react-separator',
      '@radix-ui/react-slider',
      '@radix-ui/react-slot',
      '@radix-ui/react-switch',
      '@radix-ui/react-tabs',
      '@radix-ui/react-toast',
      '@radix-ui/react-toggle',
      '@radix-ui/react-toggle-group',
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

  async headers() {
    // Development: permissive CSP — explicitly covers worker-src because
    // Chrome does NOT inherit default-src wildcards into worker-src.
    // @react-three/fiber (Three.js) creates blob: workers for WebGL shader
    // compilation, which Chrome blocks without an explicit worker-src blob:.
    const devCSP = [
      "default-src *",
      "script-src * 'unsafe-inline' 'unsafe-eval'",
      "style-src * 'unsafe-inline'",
      "connect-src *",
      "font-src *",
      "img-src * data: blob:",
      "object-src * data: blob:",
      "frame-src * data: blob:",
      "media-src * data: blob:",
      // Critical: wildcard does NOT cover worker-src in Chrome — must be explicit
      "worker-src * blob: 'self'",
      "child-src * blob: 'self'",
      "base-uri 'self'",
    ].join('; ');

    // Production: strict CSP — covers all Three.js/R3F/WebGL requirements
    const prodConnectSrc = [
      "'self'",
      "https://*.supabase.co", "wss://*.supabase.co",
      "https://iuvtsvjpmovfymvnmqys.supabase.co", "wss://iuvtsvjpmovfymvnmqys.supabase.co",
      "https://vercel.live", "wss://ws-us3.pusher.app",
      "https://*.railway.app",
      "https://mithran-production.up.railway.app",
      "https://mithran-production-dc9d.up.railway.app",
      "https://router.project-osrm.org",
    ].join(' ');

    const prodCSP = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com https://vercel.live`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      `connect-src ${prodConnectSrc}`,
      "font-src 'self' 'unsafe-inline' data: blob: https://fonts.gstatic.com https://r2cdn.perplexity.ai",
      "img-src 'self' data: blob: https: https://*.supabase.co https://iuvtsvjpmovfymvnmqys.supabase.co",
      "object-src 'self' blob: data: https://*.supabase.co https://iuvtsvjpmovfymvnmqys.supabase.co",
      "frame-src 'self' https://vercel.live https://*.vercel.live https://*.supabase.co https://iuvtsvjpmovfymvnmqys.supabase.co data: blob:",
      "media-src 'self' blob: data: https://*.supabase.co https://iuvtsvjpmovfymvnmqys.supabase.co",
      // Three.js/R3F WebGL: shader workers are spawned as blob: URLs
      "worker-src 'self' blob:",
      "child-src 'self' blob: https://*.supabase.co https://iuvtsvjpmovfymvnmqys.supabase.co",
      "base-uri 'self'",
    ].join('; ');

    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: process.env.NODE_ENV === 'development' ? devCSP : prodCSP,
          },
        ],
      },
    ];
  },
}

export default nextConfig
