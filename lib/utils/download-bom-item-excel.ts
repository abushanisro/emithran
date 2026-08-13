import { apiClient } from '@/lib/api/client';
import { apiConfig } from '@/lib/api/config';

/**
 * Downloads the server-generated Part Cost Report workbook (.xlsx) for a BOM
 * item — a formula-driven cost model (editable material/process inputs
 * recalculate live in Excel) plus a live CAD-calculation-trace verification
 * sheet, built server-side with exceljs (see backend ExcelReportService) so
 * the numbers come straight from the authoritative cost-aggregation source,
 * not a client-side re-derivation.
 *
 * batchSize/location are optional — pass the page's current scenario values
 * so the live-verification sheet matches what's on screen; omit and the
 * backend falls back to whatever's saved on the costed route.
 */
export async function downloadBomItemExcel(
  bomItemId: string,
  fallbackFilename: string,
  scenario?: { batchSize?: number; location?: string },
): Promise<void> {
  const token = apiClient.getAccessToken();
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const params = new URLSearchParams();
  if (scenario?.batchSize != null) params.set('batchSize', String(scenario.batchSize));
  if (scenario?.location) params.set('location', scenario.location);
  const qs = params.toString();
  const res = await fetch(`${apiConfig.endpoints.api.v1}/cost-analysis/bom-item/${bomItemId}/excel${qs ? `?${qs}` : ''}`, { headers });

  if (!res.ok) {
    throw new Error(`Excel export failed (${res.status})`);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : fallbackFilename;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
