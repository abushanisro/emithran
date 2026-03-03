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
              // Complete browser extension error suppression
              (function() {
                // Store original console methods
                const originalConsoleError = console.error;
                const originalConsoleWarn = console.warn;
                const originalConsoleLog = console.log;
                
                // Comprehensive extension error detection
                function isExtensionError(message) {
                  if (!message || typeof message !== 'string') return false;
                  
                  // Never suppress these critical application errors
                  const criticalPatterns = [
                    'supabase.co', 'fetch failed', 'network error', 'Failed to load',
                    'refused to connect', 'CORS', 'TypeError:', 'ReferenceError:',
                    'SyntaxError:', 'RangeError:', 'URIError:'
                  ];
                  
                  if (criticalPatterns.some(pattern => message.includes(pattern))) {
                    return false;
                  }
                  
                  // Extension error patterns to suppress
                  const extensionPatterns = [
                    'message port closed',
                    'Unchecked runtime.lastError',
                    'Extension context invalidated',
                    'runtime.lastError',
                    'The message port closed before a response was received',
                    'chrome-extension://',
                    'moz-extension://'
                  ];
                  
                  // Check for extension patterns
                  if (extensionPatterns.some(pattern => message.includes(pattern))) {
                    return true;
                  }
                  
                  // Check for UUID-prefixed extension errors
                  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:\d+/.test(message)) {
                    return extensionPatterns.some(pattern => message.includes(pattern));
                  }
                  
                  return false;
                }
                
                // Override console methods with filtering
                console.error = function(...args) {
                  const message = args.join(' ');
                  if (!isExtensionError(message)) {
                    originalConsoleError.apply(console, args);
                  }
                };
                
                console.warn = function(...args) {
                  const message = args.join(' ');
                  if (!isExtensionError(message)) {
                    originalConsoleWarn.apply(console, args);
                  }
                };
                
                console.log = function(...args) {
                  const message = args.join(' ');
                  if (!isExtensionError(message)) {
                    originalConsoleLog.apply(console, args);
                  }
                };
                
                // Suppress extension promise rejections
                window.addEventListener('unhandledrejection', function(event) {
                  if (event.reason) {
                    const message = typeof event.reason === 'string' ? event.reason : 
                                  (event.reason.message || event.reason.toString());
                    if (isExtensionError(message)) {
                      event.preventDefault();
                      event.stopPropagation();
                      return false;
                    }
                  }
                });
                
                // Suppress extension runtime errors
                window.addEventListener('error', function(event) {
                  const message = event.message || '';
                  const filename = event.filename || '';
                  
                  if (isExtensionError(message) || isExtensionError(filename)) {
                    event.preventDefault();
                    event.stopPropagation();
                    return false;
                  }
                });
                
                // Handle dynamically injected extension scripts
                const observer = new MutationObserver(function(mutations) {
                  mutations.forEach(function(mutation) {
                    if (mutation.type === 'childList') {
                      mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1 && node.tagName === 'SCRIPT') {
                          const src = node.src || '';
                          if (src.includes('chrome-extension://') || src.includes('moz-extension://')) {
                            // Extension script detected - ensure our overrides persist
                            setTimeout(function() {
                              if (typeof window.console !== 'undefined') {
                                window.console.error = console.error;
                                window.console.warn = console.warn;
                                window.console.log = console.log;
                              }
                            }, 50);
                          }
                        }
                      });
                    }
                  });
                });
                
                // Observe the document for extension script injection
                observer.observe(document.documentElement, {
                  childList: true,
                  subtree: true
                });
                
                // Ensure overrides persist
                setInterval(function() {
                  if (window.console.error !== console.error) {
                    window.console.error = console.error;
                    window.console.warn = console.warn;
                    window.console.log = console.log;
                  }
                }, 1000);
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
