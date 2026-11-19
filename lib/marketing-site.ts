/**
 * The marketing site (the ubaabu repository, deployed at www.emithran.com). The app's public pages link to it for
 * everything that is not signing in: product pages, pricing, about, FAQ, contact and the demo request.
 */
export const MARKETING_SITE_URL = (process.env.NEXT_PUBLIC_MARKETING_URL ?? 'https://www.emithran.com').replace(/\/+$/, '')

export function marketingUrl(path: string): string {
  return `${MARKETING_SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

export const REQUEST_DEMO_URL = marketingUrl('/request-demo')
