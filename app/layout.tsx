import type { Metadata } from 'next'
import { Outfit, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { SpeedInsights } from "@vercel/speed-insights/next"

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'mithran - Manufacturing One-Stop Solution',
    template: '%s | mithran',
  },
  description: 'Enterprise manufacturing One-Stop Solution for should-cost analysis, vendor management, and cost optimization.',
  authors: [{ name: 'mithran' }],
  keywords: ['manufacturing', 'cost modeling', 'should-cost analysis', 'vendor management', 'BOM processing'],
  openGraph: {
    title: 'mithran - Manufacturing One-Stop Solution',
    description: 'Enterprise manufacturing One-Stop Solution for should-cost analysis, vendor management, and cost optimization.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@mithran',
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico' },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${outfit.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_SUPABASE_URL || ""} />
      </head>
      <body className="antialiased font-sans">
        <Providers>
          {children}
        </Providers>
        <SpeedInsights />
      </body>
    </html>
  )
}
