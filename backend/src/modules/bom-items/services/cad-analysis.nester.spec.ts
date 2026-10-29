import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cadEngineHttp } from '../../../common/resilience/engine-http';
import { CADAnalysisService } from './cad-analysis.service';

const request = {
  outlinePointsMm: [[0, 0], [10, 0], [10, 10], [0, 10]],
  holesMm: [],
  sheetWidthMm: 100,
  sheetLengthMm: 100,
  quantity: 5,
  kerfMm: 1,
};

function fakeNester(script: string): void {
  const file = join(mkdtempSync(join(tmpdir(), 'nester-')), 'nester');
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  process.env.NESTER_BIN = file;
}

const pythonAnswer = {
  data: { sheet_width_mm: 100, sheet_length_mm: 100, parts_per_sheet: 3, placements: [], utilization_pct: 3, sheets_required: 2, capped: false },
};

describe('CADAnalysisService.computeTrueNest with NESTING_ENGINE=rust', () => {
  const service = new CADAnalysisService({} as never, {} as never);

  beforeEach(() => {
    process.env.NESTING_ENGINE = 'rust';
  });
  afterEach(() => {
    delete process.env.NESTING_ENGINE;
    delete process.env.NESTER_BIN;
    jest.restoreAllMocks();
  });

  it('returns the Rust nester\'s answer in the camelCase shape costing reads, without calling the Python engine', async () => {
    const post = jest.spyOn(cadEngineHttp, 'post');
    fakeNester(
      `read input; case "$input" in *'"kerf_mm":1'*'"edge_margin_mm":2'*) ;; *) exit 9;; esac; ` +
        `printf '%s' '{"ok":true,"result":{"sheet_width_mm":100,"sheet_length_mm":100,"parts_per_sheet":2,"placements":[{"x_mm":2,"y_mm":2,"rotation_deg":0},{"x_mm":13,"y_mm":2,"rotation_deg":90}],"utilization_pct":2,"sheets_required":3,"capped":false}}'`,
    );
    const { result, reason } = await service.computeTrueNest(request);
    expect(reason).toBe('');
    expect(result).toEqual({
      sheetWidthMm: 100,
      sheetLengthMm: 100,
      partsPerSheet: 2,
      placements: [{ xMm: 2, yMm: 2, rotationDeg: 0 }, { xMm: 13, yMm: 2, rotationDeg: 90 }],
      utilizationPct: 2,
      sheetsRequired: 3,
      capped: false,
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('passes a refusal about the part through with the same wording as the Python 422, and does not fall back', async () => {
    const post = jest.spyOn(cadEngineHttp, 'post');
    fakeNester(`cat > /dev/null; printf '%s' '{"ok":false,"reason":"outline has only 2 point(s) -- need at least 3 to form a polygon"}'`);
    const { result, reason } = await service.computeTrueNest(request);
    expect(result).toBeNull();
    expect(reason).toBe('Could not compute a true nest: outline has only 2 point(s) -- need at least 3 to form a polygon');
    expect(post).not.toHaveBeenCalled();
  });

  it('falls back to the Python engine when the nester is unavailable (here: it crashes)', async () => {
    const post = jest.spyOn(cadEngineHttp, 'post').mockResolvedValue(pythonAnswer as never);
    fakeNester('cat > /dev/null; exit 139');
    const { result } = await service.computeTrueNest(request);
    expect(post).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ partsPerSheet: 3, sheetsRequired: 2 });
  });

  it('uses only the Python engine when NESTING_ENGINE is not rust', async () => {
    delete process.env.NESTING_ENGINE;
    const post = jest.spyOn(cadEngineHttp, 'post').mockResolvedValue(pythonAnswer as never);
    process.env.NESTER_BIN = '/no/such/binary';
    await service.computeTrueNest(request);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
