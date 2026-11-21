'use client'

import { useEffect, useState } from 'react'

import { Menu, X } from '@/components/ui/icons'
import { marketingUrl, REQUEST_DEMO_URL } from '@/lib/marketing-site'

/**
 * The marketing site's navbar (ubaabu: src/components/layout/Navbar.tsx), cut down for the sign-in page: About and FAQ jump to
 * the page's own sections; Contact Us and Request Demo go to the marketing site.
 */

// About and FAQ are sections of the sign-in page itself.
const items = [
  { label: 'About', href: '#about' },
  { label: 'FAQ', href: '#faqs' },
]

const CONTACT_URL = marketingUrl('/contact?source=app&cta=contact-us')
// The brand's teal button on its darker steps (#0d9488 → #0f766e), so the white label stays readable.
const CTA_GRADIENT = 'linear-gradient(135deg, #0d9488, #0f766e)'

export function MarketingNavbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [])

  return (
    <header className="sticky inset-x-0 top-0 z-50 border-b border-black/[0.08] bg-white" style={{ colorScheme: 'light' }}>
      <nav className="mx-auto flex max-w-[1280px] items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <a href={marketingUrl('/')} className="flex items-center gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- the marketing site's logo, as it draws it */}
            <img src="/brand/emithran-mark.png" width={256} height={256} alt="" className="h-8 w-auto" />
            <span className="text-lg font-semibold tracking-tight text-[#080808]">EMITHRAN</span>
          </a>
          <ul className="hidden items-center gap-0.5 md:flex">
            {items.map((item) => (
              <li key={item.label}>
                <a href={item.href} className="rounded-md px-3 py-2 text-sm font-medium text-black/60 hover:text-black hover:bg-black/5 transition-colors">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <a href={CONTACT_URL} className="rounded-md border border-black/15 px-4 py-2 text-sm font-semibold text-[#0d1117] hover:bg-black/[0.04] transition-colors whitespace-nowrap">
            Contact Us
          </a>
          <a href={REQUEST_DEMO_URL} className="rounded-md px-4 py-2 text-sm font-semibold text-white hover:opacity-85 transition-opacity whitespace-nowrap" style={{ background: CTA_GRADIENT }}>
            Request Demo
          </a>
        </div>

        <button
          type="button"
          className="-my-1.5 -mr-3 inline-flex h-11 w-11 items-center justify-center text-[#080808] md:hidden"
          onClick={() => { setMobileOpen(!mobileOpen) }}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {mobileOpen && (
        <div id="mobile-nav" className="mx-4 mb-2 rounded-xl border border-black/[0.08] bg-white p-4 shadow-lg md:hidden">
          {items.map((item) => (
            <a key={item.label} href={item.href} onClick={() => { setMobileOpen(false) }} className="block rounded-md px-3 py-2.5 text-sm font-medium text-black/60 hover:text-black hover:bg-black/5 transition-colors">
              {item.label}
            </a>
          ))}
          <a href={CONTACT_URL} className="mt-2 block w-full rounded-md border border-black/15 px-4 py-2.5 text-center text-sm font-semibold text-[#0d1117] hover:bg-black/[0.04] transition-colors">
            Contact Us
          </a>
          <a href={REQUEST_DEMO_URL} className="mt-2 block w-full rounded-md px-4 py-2.5 text-center text-sm font-semibold text-white hover:opacity-85 transition-opacity" style={{ background: CTA_GRADIENT }}>
            Request Demo
          </a>
        </div>
      )}
    </header>
  )
}
