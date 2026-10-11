import type { Project } from '@/lib/api/projects';

type ProjectMoney = Pick<Project, 'actualCost' | 'actualCostCurrency' | 'targetBomCost' | 'targetBomCostCurrency'>;
const finiteMoney = (amount: unknown): amount is number => typeof amount === 'number' && Number.isFinite(amount);
export const projectCostCurrency = (project: ProjectMoney): string => project.actualCostCurrency ?? 'USD';

export function projectSavings(project: ProjectMoney): number | null {
  if (!finiteMoney(project.actualCost) || !finiteMoney(project.targetBomCost) ||
      (project.targetBomCostCurrency ?? 'USD') !== projectCostCurrency(project)) return null;
  return project.targetBomCost - project.actualCost;
}

/** Portfolio figures are complete USD totals, never partial sums or mixed currencies. */
export function summarizeProjectCosts(projects: readonly ProjectMoney[]) {
  const actual = projects.every(p => finiteMoney(p.actualCost) && projectCostCurrency(p) === 'USD')
    ? projects.reduce((sum, p) => sum + p.actualCost!, 0) : null;
  const target = projects.every(p => finiteMoney(p.targetBomCost) && (p.targetBomCostCurrency ?? 'USD') === 'USD')
    ? projects.reduce((sum, p) => sum + p.targetBomCost!, 0) : null;
  const savings = actual == null || target == null ? null : target - actual;
  const savingsPercent = savings == null || target == null || target <= 0 ? null : savings / target * 100;
  return { actual, target, savings, savingsPercent };
}

export function formatProjectMoney(amount: number | null | undefined, currency = 'USD'): string {
  return finiteMoney(amount) ? amount.toLocaleString('en-US', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }) : '—';
}
