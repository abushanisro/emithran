export interface MaterialSuggestion {
  name: string;
  reason: string;
  score: number; // relative ranking score — not a probability; higher = more likely match
}

const UNSPECIFIED = new Set(['Unknown', 'Not Specified', 'Not specified', 'None', '']);

export function isDrawingMaterialUnspecified(drawingMaterial: string | null | undefined): boolean {
  return !drawingMaterial || UNSPECIFIED.has(drawingMaterial.trim());
}

export function suggestMaterialCandidates(
  drawingMaterial: string | null | undefined,
  sheetThicknessMm: number | null | undefined,
  coating: string | null | undefined,
  partName: string | null | undefined,
  drawingNotes?: string | null,
): MaterialSuggestion[] | null {
  if (!isDrawingMaterialUnspecified(drawingMaterial)) return null;

  const nameUpper  = (partName ?? '').toUpperCase();
  const coatingLow = (coating ?? '').toLowerCase();
  const notesUpper = (drawingNotes ?? '').toUpperCase();
  const isSheetMetal = (sheetThicknessMm ?? 0) > 0;

  // Part-name signals
  const hasStructural = /FRAME|BRACKET|MOUNT|CHASSIS|SUPPORT|BACKFRAME|FRONTFRAME|PANEL|ENCLOSURE|COVER|DOOR/.test(nameUpper);
  const hasHygienic   = /FOOD|PHARMA|MEDICAL|SANITARY|HYGIENE|STERILE|SURGICAL/.test(nameUpper);

  // Coating signals (field + drawing notes)
  const hasPowderCoat  = coatingLow.includes('powder') || notesUpper.includes('POWDER COAT');
  const hasZinc        = coatingLow.includes('zinc') || coatingLow.includes('galv') || notesUpper.includes('ZINC') || notesUpper.includes('GALVANIS');
  const hasPhosphating = notesUpper.includes('PHOSPHAT');
  const hasAnodize     = coatingLow.includes('anodiz') || notesUpper.includes('ANODIZ');

  // Notes signals
  const hasOutdoor   = /OUTDOOR|EXTERNAL|WEATHER|EXTERIOR/.test(notesUpper);
  const hasCorrosion = /CORROSION|FOOD GRADE|FOOD-GRADE|HYGIENIC|FOOD CONTACT/.test(notesUpper);

  if (isSheetMetal) {
    let crcaScore  = 55;
    let hrScore    = 20;
    let ss304Score = 15;

    if (hasStructural)                       { crcaScore += 15; hrScore += 5; }
    if (hasPowderCoat || hasZinc)           { crcaScore += 10; ss304Score = Math.max(5, ss304Score - 5); }
    if (hasPhosphating)                      { crcaScore += 8; }
    if (hasOutdoor)                          { crcaScore += 5; hrScore += 3; }
    if (hasHygienic || hasCorrosion)        { ss304Score += 30; crcaScore -= 20; hrScore -= 10; }

    const crcaReason = [
      `${sheetThicknessMm} mm sheet metal part`,
      hasPowderCoat ? 'preferred substrate for powder coating' : 'standard grade for laser cutting and press brake forming',
      hasStructural  ? 'structural / frame application confirmed by part name' : null,
      hasPhosphating ? 'phosphating pre-treatment suggests mild steel substrate' : null,
      'widely available in IS2062 standard',
    ].filter(Boolean).join(' · ');

    return [
      {
        name: 'IS2062 E250 CRCA',
        reason: crcaReason,
        score: cap(crcaScore),
      },
      {
        name: 'IS2062 E350 HR Sheet',
        reason: 'Hot-rolled structural grade · higher yield strength for load-bearing brackets and frames · weldable',
        score: cap(hrScore),
      },
      {
        name: 'SS304 Sheet',
        reason: (hasHygienic || hasCorrosion)
          ? 'Hygienic / food / corrosion-resistant application detected — austenitic stainless steel required'
          : 'Suitable when corrosion resistance required without coating · common in outdoor or wet environments',
        score: cap(ss304Score),
      },
    ].sort((a, b) => b.score - a.score);
  }

  // CNC machined bar stock
  let en8Score   = 40;
  let alScore    = 30;
  let ss304Score = 15;

  if (hasStructural)               { en8Score  += 10; }
  if (hasHygienic || hasCorrosion) { ss304Score += 30; en8Score -= 15; }
  if (hasAnodize)                  { alScore   += 20; en8Score -= 10; }

  return [
    {
      name: 'EN8 / C45 Bar',
      reason: 'General purpose medium-carbon steel · good machinability and strength · standard for CNC turning and milling',
      score: cap(en8Score),
    },
    {
      name: 'Aluminium 6061-T6 Bar',
      reason: hasAnodize
        ? 'Anodizing detected — aluminium alloy substrate required · T6 temper gives good strength-to-weight ratio'
        : 'Lightweight with excellent machinability · suitable for precision machined parts requiring good surface finish',
      score: cap(alScore),
    },
    {
      name: 'SS304 Bar',
      reason: (hasHygienic || hasCorrosion)
        ? 'Hygienic / food / corrosion-resistant application detected — stainless steel required'
        : 'Use for corrosion environments, chemical exposure, or hygienic applications',
      score: cap(ss304Score),
    },
  ].sort((a, b) => b.score - a.score);
}

// Scores are relative rankings, not probabilities — cap at 90 to avoid misleading display.
function cap(v: number): number {
  return Math.min(90, Math.max(0, v));
}
