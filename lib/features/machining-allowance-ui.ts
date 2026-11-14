import type { AllowanceBasis, AllowanceDecisionRequest, AllowanceStatus, FeatureAllowance } from '@/lib/api/hooks/useMachiningAllowance';

/**
 * What the machining allowance panel says and offers, from the cost summary's allowance (backend machining-allowance.ts). The backend and
 * the database check every write again; this only decides labels and when the form may be sent.
 */

export const STATUS_LABEL: Record<AllowanceStatus, string> = {
  specified: 'Specified (drawing / PMI / customer)',
  standard_derived: 'Licensed standard',
  foundry_profile_derived: 'Approved foundry profile',
  estimated: 'Engineer estimate',
  requires_review: 'Requires review',
};

export const SHORT_STATUS: Record<AllowanceStatus, string> = {
  specified: 'specified', standard_derived: 'standard', foundry_profile_derived: 'profile', estimated: 'estimate', requires_review: 'review',
};

export const STATUS_CLASS: Record<AllowanceStatus, string> = {
  specified: 'text-emerald-600',
  standard_derived: 'text-emerald-600',
  foundry_profile_derived: 'text-sky-600',
  estimated: 'text-amber-600',
  requires_review: 'text-red-600',
};

export const BASIS_LABEL: Record<AllowanceBasis, string> = {
  engineering_drawing: 'Engineering drawing',
  cad_model_pmi: 'CAD model PMI',
  customer_specification: 'Customer specification',
  engineering_estimate: 'Engineer estimate',
};

/** ISO 8062-3 machining-allowance grades; the part's grade is the engineer's choice, never inferred. */
export const RMAG_GRADES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'] as const;

/** One line on where the value comes from. */
export function sourceLine(f: FeatureAllowance): string {
  const s = f.source;
  if (s.kind === 'none') return 'No source: enter the value from the drawing, or an estimate with its reason.';
  if (s.kind === 'decision') {
    const when = s.setAt ? ` on ${new Date(s.setAt).toLocaleDateString()}` : '';
    const basis = (BASIS_LABEL as Partial<Record<string, string>>)[s.basis ?? ''];
    return `${basis ?? s.ref ?? 'decision'} by ${s.setBy ?? 'an engineer'}${when}: ${s.reason ?? ''}`.trim();
  }
  if (s.kind === 'drawing') return `From ${s.ref ?? 'the drawing'}`;
  return s.ref ?? (s.kind === 'dataset' ? 'licensed dataset' : 'approved profile');
}

/** The value as shown: "1.5 mm × 2 sides", or a dash when there is none. */
export function valueLine(f: FeatureAllowance): string {
  if (f.allowanceMm == null) return '—';
  return `${f.allowanceMm} mm${f.sides === 2 ? ' × 2 sides' : ''}`;
}

export interface DecisionForm {
  machined: boolean;
  allowanceMm: string;
  sides: '1' | '2';
  basis: AllowanceBasis | '';
  reason: string;
}

/** The request the form makes, or why it cannot be sent yet. */
export function decisionRequest(featureKey: string, form: DecisionForm): { request: AllowanceDecisionRequest } | { error: string } {
  const reason = form.reason.trim();
  if (reason.length < 3) return { error: 'Say where the value comes from (at least 3 characters).' };
  if (reason.length > 500) return { error: 'The reason is at most 500 characters.' };
  if (!form.machined) return { request: { featureKey, machined: false, reason } };
  const mm = Number(form.allowanceMm);
  if (!form.allowanceMm.trim() || !Number.isFinite(mm) || mm <= 0) return { error: 'Enter the allowance per face in mm (a positive number).' };
  if (!form.basis) return { error: 'Choose the source of the value.' };
  return { request: { featureKey, machined: true, allowanceMm: mm, sides: form.sides === '2' ? 2 : 1, basis: form.basis, reason } };
}

/** The form's starting values: the feature's current value, sides by its kind (a hole carries it on both sides of its diameter). */
export function initialForm(f: FeatureAllowance): DecisionForm {
  const internal = f.asCast?.rule === 'internal' || /Hole|Void/.test(f.featureType);
  return {
    machined: true,
    allowanceMm: f.allowanceMm != null ? String(f.allowanceMm) : '',
    sides: f.sides === 2 || (f.sides == null && internal) ? '2' : '1',
    basis: '',
    reason: '',
  };
}
