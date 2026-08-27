/**
 * Location -> currency/symbol inference, consolidated from three near-duplicate
 * copies that had drifted (app/(dashboard)/hr-rates/page.tsx,
 * app/(dashboard)/mhr-database/[id]/page.tsx, components/features/mhr/MHRFormDialog.tsx).
 * Mirrors the backend's authoritative
 * backend/src/modules/mhr/constants/mhr-calculation.constants.ts's
 * getCurrencyForLocation exactly (same location keywords, same symbols) so
 * frontend display never disagrees with what the backend actually computed.
 *
 * Fixes a real bug present in two of the three original copies: they returned
 * symbol '$' for INR instead of '₹'.
 */
export function getCurrencyForLocation(location: string): { currency: string; symbol: string } {
  const loc = (location || '').toLowerCase();
  if (loc.includes('india') || loc.includes('bangalore') || loc.includes('chennai')
    || loc.includes('pune') || loc.includes('mumbai') || loc.includes('delhi')
    || loc.includes('hyderabad') || loc.includes('ahmedabad') || loc.includes('kolkata')) {
    return { currency: 'INR', symbol: '₹' };
  }
  if (loc.includes('china') || loc.includes('shanghai') || loc.includes('beijing')
    || loc.includes('shenzhen') || loc.includes('guangzhou') || loc.includes('chengdu')) {
    return { currency: 'CNY', symbol: '¥' };
  }
  if (loc.includes('germany') || loc.includes('france') || loc.includes('spain')
    || loc.includes('italy') || loc.includes('netherlands') || loc.includes('europe')
    || loc.includes('austria') || loc.includes('belgium') || loc.includes('portugal')
    || loc.includes('finland') || loc.includes('denmark') || loc.includes('sweden')
    || loc.includes('norway') || loc.includes('poland') || loc.includes('czech')
    || loc.includes('romania') || loc.includes('hungary') || loc.includes('slovakia')
    || loc.includes('w. europe') || loc.includes('e. europe') || loc.includes('eastern europe')
    || loc.includes('western europe')) {
    return { currency: 'EUR', symbol: '€' };
  }
  if (loc.includes('usa') || loc.includes('united states') || loc.includes('us -')
    || loc.includes('u.s.') || loc.includes('america')) {
    return { currency: 'USD', symbol: '$' };
  }
  if (loc.includes('uk') || loc.includes('united kingdom') || loc.includes('britain')
    || loc.includes('england') || loc.includes('scotland')) {
    return { currency: 'GBP', symbol: '£' };
  }
  if (loc.includes('japan')) return { currency: 'JPY', symbol: '¥' };
  if (loc.includes('mexico')) return { currency: 'MXN', symbol: 'MX$' };
  if (loc.includes('taiwan')) return { currency: 'TWD', symbol: 'NT$' };
  if (loc.includes('korea')) return { currency: 'KRW', symbol: '₩' };
  if (loc.includes('australia')) return { currency: 'AUD', symbol: 'A$' };
  if (loc.includes('canada')) return { currency: 'CAD', symbol: 'CA$' };
  if (loc.includes('brazil')) return { currency: 'BRL', symbol: 'R$' };
  if (loc.includes('turkey')) return { currency: 'TRY', symbol: '₺' };
  if (loc.includes('russia')) return { currency: 'RUB', symbol: '₽' };
  if (loc.includes('indonesia')) return { currency: 'IDR', symbol: 'Rp' };
  if (loc.includes('vietnam')) return { currency: 'VND', symbol: '₫' };
  if (loc.includes('thailand')) return { currency: 'THB', symbol: '฿' };
  if (loc.includes('malaysia')) return { currency: 'MYR', symbol: 'RM' };
  if (loc.includes('singapore')) return { currency: 'SGD', symbol: 'S$' };
  if (loc.includes('south africa')) return { currency: 'ZAR', symbol: 'R' };
  if (loc.includes('saudi') || loc.includes('riyadh')) return { currency: 'SAR', symbol: 'SR' };
  if (loc.includes('uae') || loc.includes('dubai') || loc.includes('abu dhabi')) return { currency: 'AED', symbol: 'AED' };
  return { currency: 'USD', symbol: '$' };
}

// No hardcoded FX rate table here on purpose. This app has a real live rate
// source (ECB reference rates via Frankfurter — backend/src/common/fx/,
// exposed to the frontend as useFxRate/useFxRatesForCurrencies in
// lib/api/hooks/useFx.ts). Callers that need an actual rate number must use
// one of those hooks, not a static constant — see hr-rates/page.tsx,
// mhr-database/[id]/page.tsx, and MHRFormDialog.tsx for the pattern.
