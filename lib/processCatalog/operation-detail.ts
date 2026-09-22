import type { ProcessCalculatorMapping } from '@/lib/api/hooks/useProcessCalculatorMappings';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Whether the Process page may offer an operation pill's expandable detail
 * (feature-type operations, aliases, default machine).
 *
 * - An ACTIVE row always may: it is a real, costable operation.
 * - An INACTIVE row may only when it IS its own canonical process, meaning its
 *   operation name equals the canonical process name. That is every process
 *   seeded from a source folder that has no costing engine yet: real data
 *   (Laser Sintering and its As Sintered features, Anodize and its types) that
 *   is inactive only because nothing costs it. Hiding it made the seeded
 *   operations invisible.
 * - An inactive DUPLICATE still may not. A retired alias row such as Laser Puch
 *   shares Laser Punch canonical row, and showing that row full detail would
 *   read as self-referential on the duplicate own pill (its alias list would
 *   list the pill name). Its name differs from the canonical one, so it stays
 *   hidden.
 *
 * A payload without the canonical name (an older backend) keeps the previous
 * behaviour: inactive rows show no detail.
 */
export function hasOperationDetail(
  op: Pick<ProcessCalculatorMapping, 'isActive' | 'operation' | 'taxonomy'>,
): boolean {
  const t = op.taxonomy;
  if (!t) return false;
  const hasContent = t.operations.length > 0 || t.aliases.length > 0 || !!t.defaultMachineName;
  if (!hasContent) return false;
  if (op.isActive !== false) return true;
  return !!t.processName && norm(t.processName) === norm(op.operation);
}
