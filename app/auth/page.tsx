'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { MarketingNavbar } from '@/components/layout/MarketingNavbar'
import { Button, type ButtonProps } from '@/components/ui/button'
import { ChevronDown, KeyRound, Loader2 } from '@/components/ui/icons'
import { consumeInactivitySignOutNotice } from '@/lib/auth/session-idle/browser'
import { SIGN_IN_PATH, ssoSignInPath } from '@/lib/auth/sign-in'
import { marketingUrl, REQUEST_DEMO_URL } from '@/lib/marketing-site'
import { useAuth } from '@/lib/providers/auth'

/**
 * A sign-in button is a plain link to Auth0 (it works without JavaScript). Each one shows its own spinner while the browser leaves,
 * and clears it when the browser restores this page from its back/forward cache (the Back button on Auth0's page).
 */
function SignInLink({ href, variant, className, children }: { href: string; variant?: ButtonProps['variant']; className: string; children: React.ReactNode }) {
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => { if (e.persisted) setLeaving(false) }
    window.addEventListener('pageshow', reset)
    return () => { window.removeEventListener('pageshow', reset) }
  }, [])
  return (
    <Button asChild variant={variant} className={className}>
      <a href={href} onClick={() => { setLeaving(true) }} aria-busy={leaving}>
        {leaving ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Signing in" /> : children}
      </a>
    </Button>
  )
}

const WHY_CHOOSE_US = [
  'Comprehensive manufacturing cost analysis',
  'Real-time data insights and analytics',
  'Seamless integration with existing systems',
  'Expert support and consultation',
  'Scalable solutions for all business sizes',
]

const FAQS = [
  { q: 'What is EMITHRAN?', a: 'EMITHRAN is a comprehensive manufacturing solution platform that provides cost modeling, process optimization, and data analytics tools for engineering teams across all manufacturing segments.' },
  { q: 'How do I get started?', a: 'You can get started by requesting a demo. Our team will reach out to schedule a personalized demonstration. If you already have an account, simply sign in above.' },
  { q: 'What features does EMITHRAN offer?', a: 'EMITHRAN offers manufacturing cost modeling, real-time analytics, vendor management, raw materials database, equipment tracking, BOM management, and collaborative tools.' },
  { q: 'Is my data secure?', a: 'Yes, data security is our top priority. We implement industry-standard encryption, secure authentication, and regular security audits to protect your data.' },
  { q: 'Can EMITHRAN integrate with existing systems?', a: 'Yes, EMITHRAN integrates with existing ERP, PLM, and other manufacturing systems through APIs and custom integrations. Contact us to discuss your requirements.' },
]

export default function AuthPage() {
  const { signOut, accessDenied } = useAuth()
  const ssoPath = ssoSignInPath()

  useEffect(() => {
    if (consumeInactivitySignOutNotice()) {
      toast.info('You were signed out after 30 minutes of inactivity. Sign in to continue where you left off.', { duration: 8000 })
    }
    // A failed sign-in comes back here as ?error=<code> (lib/auth0.ts); the reason itself is in the server log.
    const error = new URLSearchParams(window.location.search).get('error')
    if (error) {
      toast.error(
        error === 'invalid_state'
          ? 'That sign-in link has expired or was already used. Please sign in again.'
          : 'Sign-in did not complete. Please try again, and contact your administrator if it keeps failing.',
        { duration: 8000 },
      )
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  // Light, like the marketing site's navbar above it: white and soft-grey surfaces, ink text, the same teal for actions.
  // Fixed colours (not the app theme), so the public page looks the same whatever theme a signed-in user picked.
  return (
    <div className="min-h-screen flex flex-col bg-white text-[#0f1b2d]" style={{ colorScheme: 'light' }}>
      <MarketingNavbar />

      <div className="flex relative flex-1">
        {/* Left side: branding and illustration */}
        <div
          className="hidden lg:flex lg:w-1/2 p-12 flex-col relative overflow-hidden bg-[linear-gradient(160deg,#eef8f6_0%,#f4f6f8_55%,#e9eef3_100%)]"
          style={{ clipPath: 'polygon(0 0, 100% 0, 85% 100%, 0 100%)' }}
        >
          <div className="relative z-10 flex flex-col items-center -ml-8 pt-6 text-center">
            <h1 className="text-3xl font-semibold tracking-tight mb-3">Welcome back</h1>
            <p className="text-black/55 text-base max-w-xs">One-stop solution provider to all manufacturing segments</p>
            <div className="mt-10 w-full max-w-lg">
              <Image src="/hero.svg" alt="Manufacturing illustration" width={500} height={400} className="w-full h-auto drop-shadow-xl" priority />
            </div>
          </div>
        </div>

        {/* Right side: sign in */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-8 lg:p-16 relative">
          <div className="w-full max-w-sm space-y-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight mb-1.5">Sign in to your account</h2>
              <p className="text-sm text-black/50">Use your company account, or single sign-on if your organisation has it.</p>
            </div>

            <div className="space-y-3">
              {accessDenied && (
                <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
                  Your account has not been invited to EMITHRAN. Ask your administrator for access, or{' '}
                  <button type="button" onClick={() => void signOut()} className="font-semibold text-[#0b7f70] hover:underline">use another account</button>.
                </div>
              )}

              <SignInLink
                href={SIGN_IN_PATH}
                className="w-full h-11 rounded-lg text-sm font-semibold text-white shadow-sm transition-[filter,transform] duration-150 bg-[linear-gradient(135deg,#0d9488,#0f766e)] hover:bg-transparent hover:brightness-110 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-[#0d9488]/40 focus-visible:ring-offset-2"
              >
                Sign In
              </SignInLink>

              {ssoPath && (
                <>
                  <div className="flex items-center gap-3 py-1">
                    <span className="h-px flex-1 bg-black/[0.08]" />
                    <span className="text-[11px] font-medium uppercase tracking-widest text-black/40">Or</span>
                    <span className="h-px flex-1 bg-black/[0.08]" />
                  </div>

                  <SignInLink
                    href={ssoPath}
                    variant="outline"
                    className="w-full h-11 rounded-lg border border-black/15 bg-white text-sm font-semibold text-[#0f1b2d] shadow-sm transition-colors duration-150 hover:bg-black/[0.03] hover:border-[#0d9488]/50 hover:text-[#0f766e] focus-visible:ring-2 focus-visible:ring-[#0d9488]/40 focus-visible:ring-offset-2"
                  >
                    <KeyRound className="w-4 h-4" aria-hidden="true" />
                    Sign in with SSO
                  </SignInLink>
                </>
              )}
            </div>

            <p className="text-center text-sm text-black/55">
              Don&apos;t have an account?{' '}
              <a href={REQUEST_DEMO_URL} className="font-semibold text-[#0b7f70] hover:underline">Request a demo</a>
            </p>

            <div className="flex justify-center gap-5 pt-2 text-xs">
              <a href="#about" className="text-black/45 hover:text-[#0b7f70] transition-colors">About Us</a>
              <span className="text-black/20" aria-hidden="true">•</span>
              <a href="#faqs" className="text-black/45 hover:text-[#0b7f70] transition-colors">FAQs</a>
            </div>
          </div>
        </div>
      </div>

      {/* About Us & FAQs */}
      <section id="about" className="w-full scroll-mt-20 border-t border-black/[0.08] bg-white">
        <div className="mx-auto max-w-3xl space-y-12 px-6 py-16">
          <div>
            <h2 className="text-3xl font-bold tracking-tight mb-5">About EMITHRAN</h2>
            <p className="text-black/60 mb-4 leading-relaxed">
              EMITHRAN is dedicated to revolutionizing the manufacturing industry by providing comprehensive solutions that streamline
              operations, optimize costs, and enhance productivity across all manufacturing segments.
            </p>
            <p className="text-black/60 leading-relaxed">
              We specialize in manufacturing cost modeling, process optimization, and end-to-end solutions that help engineering teams
              make informed decisions.
            </p>
          </div>

          <div>
            <h3 className="text-2xl font-semibold tracking-tight mb-5">Why Choose Us</h3>
            <ul className="space-y-3">
              {WHY_CHOOSE_US.map((item) => (
                <li key={item} className="flex items-start gap-3 text-black/60">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0d9e8a]" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div id="faqs" className="scroll-mt-20">
            <h2 className="text-3xl font-bold tracking-tight mb-6">Frequently Asked Questions</h2>
            <div className="space-y-3">
              {FAQS.map(({ q, a }) => (
                <details key={q} className="group rounded-xl border border-black/[0.08] bg-[#f8fafc]">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 font-semibold hover:text-[#0b7f70] transition-colors">
                    {q}
                    <ChevronDown className="h-4 w-4 shrink-0 text-black/40 transition-transform group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <p className="px-4 pb-4 text-black/60 leading-relaxed">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="w-full border-t border-black/[0.08] bg-[#f8fafc]">
        <div className="mx-auto max-w-[1280px] px-6 py-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-1 mb-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- the marketing site's logo */}
              <img src="/brand/emithran-mark.png" alt="" width={256} height={256} className="h-6 w-auto" />
              <span className="text-base font-semibold tracking-tight text-[#080808]">EMITHRAN</span>
            </div>
            <p className="text-xs leading-relaxed text-black/45">
              This Manufacturing Cost Calculator is provided for general informational purposes only and does not constitute any legal, tax or business advice. Verify all calculations with your accounting and engineering teams as cost estimates are subject to change without notice. We do not accept any liability as a result of using this tool.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/45">
            <span>© {new Date().getFullYear()} Emithran Technologies Pvt. Ltd.</span>
            <span className="text-black/20">·</span>
            <a href={marketingUrl('/terms')} className="hover:text-[#0b7f70] transition-colors">Terms of Use</a>
            <span className="text-black/20">·</span>
            <a href={marketingUrl('/privacy')} className="hover:text-[#0b7f70] transition-colors">Privacy Policy</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
