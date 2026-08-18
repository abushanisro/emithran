// "Sheet Metal - Net Material Usage" calculator's physics_key implementation.
// Verified against the real live formula (bom-items.service.ts's
// smNetWeightKg, the exact code that produces the true RTP2 1.234 kg
// figure): netWeightKg = (flatPatternAreaMm2 * thicknessMm / 1e9) *
// densityKgM3 -- area[mm²] × thickness[mm] = volume[mm³]; ÷1e9 converts
// mm³ → m³ (1 m³ = 1e9 mm³); × density[kg/m³] = mass[kg]. Both inputs are
// genuinely consumed scalars (not decorative), so unlike Gross Usage this
// needs no BOM-item/DB access at all -- a pure function.
export function resolveNetUsagePhysics(inputValues: Record<string, any>): Record<string, any> {
  const areaMm2 = Number(inputValues['Flat Pattern Area'] ?? 0);
  const thicknessMm = Number(inputValues['Thickness'] ?? 0);
  const densityKgM3 = Number(inputValues['Material Density'] ?? 0);

  const volumeMm3 = areaMm2 * thicknessMm;
  const netUsageKg = (volumeMm3 / 1e9) * densityKgM3;

  return {
    'Volume': Math.round(volumeMm3 * 100) / 100,
    'Net Usage': Math.round(netUsageKg * 1000000) / 1000000,
  };
}
