import type { Metadata } from 'next'
import { Outfit, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { SpeedInsights } from "@vercel/speed-insights/next"

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600'], // Reduced weight variants to minimize preloads
  variable: '--font-sans',
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'arial'],
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400'], // Reduced to single weight to minimize preloads
  variable: '--font-mono',
  display: 'optional', // Changed from 'swap' to 'optional' for non-critical font
  preload: false,
  fallback: ['Monaco', 'Menlo', 'monospace'],
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
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Suppress browser extension runtime errors
              (function() {
                const originalConsoleError = console.error;
                const originalConsoleWarn = console.warn;
                const originalConsoleLog = console.log;
                
                // Enhanced pattern matching for extension errors
                function isExtensionError(message) {
                  if (!message || typeof message !== 'string') return false;
                  
                  // Don't suppress Supabase or application errors
                  if (message.includes('supabase.co') || 
                      message.includes('fetch') ||
                      message.includes('network') ||
                      message.includes('Failed to load') ||
                      message.includes('refused to connect')) {
                    return false;
                  }
                  
                  return message.includes('message port closed') || 
                         message.includes('Unchecked runtime.lastError') ||
                         message.includes('Extension context invalidated') ||
                         message.includes('runtime.lastError') ||
                         (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:\d+/.test(message) && 
                          (message.includes('runtime.lastError') || message.includes('message port closed')));
                }
                
                console.error = function(...args) {
                  const message = args.join(' ');
                  if (isExtensionError(message)) {
                    return;
                  }
                  originalConsoleError.apply(console, args);
                };
                
                console.warn = function(...args) {
                  const message = args.join(' ');
                  if (isExtensionError(message)) {
                    return;
                  }
                  originalConsoleWarn.apply(console, args);
                };
                
                console.log = function(...args) {
                  const message = args.join(' ');
                  if (isExtensionError(message)) {
                    return;
                  }
                  originalConsoleLog.apply(console, args);
                };
                
                // Handle unhandled promise rejections from extensions
                window.addEventListener('unhandledrejection', function(event) {
                  if (event.reason) {
                    const message = typeof event.reason === 'string' ? event.reason : 
                                  (event.reason.message || String(event.reason));
                    if (isExtensionError(message)) {
                      event.preventDefault();
                      return;
                    }
                  }
                });
                
                // Handle runtime errors from extensions
                window.addEventListener('error', function(event) {
                  if (event.message && isExtensionError(event.message)) {
                    event.preventDefault();
                    return;
                  }
                  
                  // Also check the source/filename for extension UUIDs
                  if (event.filename && isExtensionError(event.filename)) {
                    event.preventDefault();
                    return;
                  }
                });
                
                // Override console methods for extension scripts that might inject later
                setTimeout(function() {
                  window.console.error = console.error;
                  window.console.warn = console.warn;
                  window.console.log = console.log;
                }, 100);
              })();
            `,
          }}
        />
        <Providers>
          {children}
        </Providers>
        {process.env.NODE_ENV === 'production' && <SpeedInsights debug={false} />}
      </body>
    </html>
  )
}
