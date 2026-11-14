// The location's sourced electricity price (location_electricity_prices, migration 1004), read once for every process that charges energy.
import type { DbClient } from '../../../../common/db/postgrest-client';

export interface LocationElectricity { pricePerKwh: number; currency: string; basis: string }

/** The location's electricity price; null when it has none or it cannot be read. */
export async function loadLocationElectricity(client: DbClient, location: string): Promise<LocationElectricity | null> {
  const { data, error } = await client.from('location_electricity_prices').select('price_per_kwh, currency, basis').eq('location', location).maybeSingle();
  if (error || !data) return null;
  const row = data as { price_per_kwh: number | string; currency: string; basis: string };
  return { pricePerKwh: Number(row.price_per_kwh), currency: row.currency, basis: row.basis };
}

const p4 = (n: number) => String(Math.round(n * 10000) / 10000);

/** The price in USD per kWh with where it came from, or null when the location has none or its currency has no rate to USD. */
export function electricityUsd(
  row: LocationElectricity | null | undefined, location: string | undefined, toUsd: (value: number, currency: string) => number | null,
): { usdPerKwh: number; source: string } | null {
  if (!row) return null;
  const usd = row.currency === 'USD' ? row.pricePerKwh : toUsd(row.pricePerKwh, row.currency);
  if (usd == null || !(usd > 0)) return null;
  const converted = row.currency === 'USD' ? '' : ` = ${p4(usd)} USD/kWh`;
  return { usdPerKwh: usd, source: `${location ?? 'location'} electricity price: ${p4(row.pricePerKwh)} ${row.currency}/kWh (${row.basis})${converted}` };
}
