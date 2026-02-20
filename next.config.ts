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
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com https://vercel.live; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vercel.live wss://ws-us3.pusher.app https://*.railway.app https://mithran-production.up.railway.app https://mithran-production-dc9d.up.railway.app; font-src 'self' https://fonts.gstatic.com https://r2cdn.perplexity.ai; img-src 'self' data: blob: https:; object-src 'none'; frame-src 'self' https://vercel.live https://*.vercel.live; base-uri 'self';"
          }
        ]
      }
    ];
  },
}

export default nextConfig
