import { Factory } from '@/components/ui/icons';

const LOCATION_CODES: Record<string, string> = {
  'India': 'IN',
  'USA': 'US',
  'China': 'CN',
  'Germany': 'DE',
  'France': 'FR',
  'W. Europe': 'EU',
  'E. Europe': 'EU',
  'UK': 'UK',
  'Vietnam': 'VN',
  'Mexico': 'MX',
};

/**
 * Small duotone country-code chip that replaces the flag emoji; a factory icon
 * when the location has no code. Presentation only.
 */
export function LocationMark({ location }: { location: string }) {
  const code = LOCATION_CODES[location];
  if (!code) return <Factory className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />;
  return (
    <span className="mr-1 inline-flex h-4 min-w-5 items-center justify-center rounded bg-(--duo-back)/30 px-1 text-[9px] font-semibold leading-none text-foreground">
      {code}
    </span>
  );
}
