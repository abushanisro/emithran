// The drawing surface-treatment callout of a part, one resolver for every
// reader (route costing, the secondary-operations engine). Precedence:
//  1. drawingIntelligence.surface_treatment  (legacy field name)
//  2. drawingIntelligence.coating.value       (drawing analysis API returns {value, confidence})
//  3. drawingIntelligence.coating             (flat string)
//  4. item.coating                            (manually set or auto-filled column)
export function surfaceCalloutOf(item: { drawingIntelligence?: unknown; coating?: unknown } | null | undefined): string | null {
  const di = item?.drawingIntelligence as { surface_treatment?: unknown; coating?: unknown } | null | undefined;
  const coating = di?.coating;
  const candidates = [
    di?.surface_treatment,
    typeof coating === 'object' && coating !== null ? (coating as { value?: unknown }).value : undefined,
    typeof coating === 'string' ? coating : undefined,
    item?.coating,
  ];
  const found = candidates.find((c): c is string => typeof c === 'string');
  return found ?? null;
}
