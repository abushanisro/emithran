import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'EMITHRAN - Manufacturing Platform',
    short_name: 'EMITHRAN',
    description: 'Enterprise manufacturing platform for should-cost analysis, vendor management, and cost optimization.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0d9e8a',
    icons: [
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/favicon.ico',
        sizes: '32x32',
        type: 'image/x-icon',
      }
    ],
  }
}