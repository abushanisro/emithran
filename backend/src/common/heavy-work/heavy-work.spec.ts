import * as fs from 'node:fs';
import * as path from 'node:path';

import { BadRequestException, HttpStatus, PayloadTooLargeException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import { runHeavyTask } from './heavy-tasks';
import { expandArchiveInWorker, HeavyWorkSlots, readWorkbook, runInWorker, withHeavyWorkSlot } from './heavy-work';
import { workbookFromData, workbookToData } from './workbook-data';
import { zip } from '../archive/test-zip';
import { xlsxZipLimits } from '../archive/xlsx-limits';
import { TryAgainLaterException } from '../http/try-again-later.exception';
import { runWithRequestAuth } from '../request-context/request-auth-context';

// Worker threads load the TypeScript sources through ts-node, which takes a few seconds on a cold start.
jest.setTimeout(60_000);

const MB = 1024 * 1024;
const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e: unknown) {
    return e;
  }
  return undefined;
};
const asUser = <T>(fn: () => Promise<T>, organizationId?: string) =>
  runWithRequestAuth({ accessToken: 't', userId: 'user-1', ...(organizationId ? { organizationId } : {}) }, fn);

async function workbookBytes(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('HeavyWorkSlots', () => {
  const limits = { maxConcurrent: 2, maxPerTenant: 1, retryAfterSeconds: 7 };

  it('gives one tenant only its share, with 429 and Retry-After', () => {
    const slots = new HeavyWorkSlots(limits);
    slots.acquire('org:a');
    const refusal = thrown(() => slots.acquire('org:a'));
    expect(refusal).toBeInstanceOf(TryAgainLaterException);
    expect((refusal as TryAgainLaterException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((refusal as TryAgainLaterException).retryAfterSeconds).toBe(7);
  });

  it('refuses everyone with 503 once the process is full, and frees slots when released (once)', () => {
    const slots = new HeavyWorkSlots(limits);
    const releaseA = slots.acquire('org:a');
    slots.acquire('org:b');
    expect((thrown(() => slots.acquire('org:c')) as TryAgainLaterException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    releaseA();
    releaseA();
    expect(() => slots.acquire('org:c')).not.toThrow();
    expect(() => slots.acquire('org:d')).toThrow(TryAgainLaterException);
  });

  it('counts the request\'s organization, or its user without one, and refuses work outside a request', async () => {
    const slots = new HeavyWorkSlots(limits);
    let inner: unknown;
    await asUser(() => withHeavyWorkSlot(async () => {
      inner = await asUser(() => withHeavyWorkSlot(() => Promise.resolve('second'), slots).catch((e: unknown) => e), 'org-1');
    }, slots), 'org-1');
    expect(inner).toBeInstanceOf(TryAgainLaterException);
    await expect(asUser(() => withHeavyWorkSlot(() => Promise.resolve('free again'), slots), 'org-1')).resolves.toBe('free again');
    await expect(withHeavyWorkSlot(() => Promise.resolve('x'), slots)).rejects.toThrow('inside an authenticated request');
  });
});

describe('workbook data', () => {
  it('round-trips the values, rows and sheets an import reads', async () => {
    const bytes = await workbookBytes((wb) => {
      const rates = wb.addWorksheet('Rates');
      rates.addRow(['Machine', 'Rate', 'Since']);
      rates.addRow(['Lathe', 12.5, new Date('2026-01-02T00:00:00Z')]);
      rates.getCell('B3').value = { formula: 'B2*2', result: 25 };
      rates.getCell('A5').value = { text: 'site', hyperlink: 'https://example.com' };
      rates.getRow(4).getCell(6).style = { font: { bold: true } }; // a row with a styled, empty cell
      wb.addWorksheet('Hidden', { state: 'hidden' }).addRow(['x']);
    });
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const rebuilt = workbookFromData(workbookToData(loaded));
    expect(rebuilt.worksheets.map((s) => [s.name, s.state, s.rowCount])).toEqual(loaded.worksheets.map((s) => [s.name, s.state, s.rowCount]));
    const [a, b] = [loaded.worksheets[0], rebuilt.worksheets[0]];
    for (let r = 1; r <= a.rowCount; r++) {
      expect(b.getRow(r).values).toEqual(a.getRow(r).values);
      expect(b.getRow(r).cellCount).toBe(a.getRow(r).cellCount);
    }
    const rows: number[] = [];
    b.eachRow((row) => rows.push(row.number));
    expect(rows).toEqual([1, 2, 3, 5]);
  });
});

describe('runHeavyTask: ExcelJS only sees workbooks that passed the archive gate', () => {
  let load: jest.SpyInstance;
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    load = jest.spyOn((require('exceljs/lib/xlsx/xlsx') as { prototype: { load: () => Promise<unknown> } }).prototype, 'load');
  });
  afterEach(() => { load.mockRestore(); });

  const refused = async (bytes: Buffer): Promise<string> => {
    const result = await runHeavyTask({ kind: 'workbook', bytes, limits: xlsxZipLimits() });
    expect(load).not.toHaveBeenCalled();
    if (result.kind !== 'workbook' || result.ok) throw new Error('expected a refusal');
    return result.message;
  };

  it('reads a real workbook', async () => {
    const bytes = await workbookBytes((wb) => wb.addWorksheet('Rates').addRow(['Machine', 'Rate']));
    const result = await runHeavyTask({ kind: 'workbook', bytes, limits: xlsxZipLimits() });
    expect(result).toMatchObject({ kind: 'workbook', ok: true, sheets: [{ name: 'Rates' }] });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('refuses a part that understates its size', async () => {
    const bytes = zip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(30 * MB, 0x20), deflate: true, statedSize: 4096 },
    ]);
    expect(await refused(bytes)).toMatch(/sheet1\.xml: could not be inflated within its declared size/);
  });

  it('refuses parts whose data overlaps', async () => {
    const bytes = zip([
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(MB, 0x20), deflate: true },
      { name: 'xl/worksheets/sheet2.xml', sharesWith: 0 },
    ]);
    expect(await refused(bytes)).toMatch(/share or overlap/);
  });

  it('refuses a part over the per-entry cap and a picture over the media cap', async () => {
    const sheet = zip([{ name: 'xl/worksheets/sheet1.xml', data: 'x', statedSize: 21 * MB }]);
    expect(await refused(sheet)).toMatch(/more than 20 MB/);
    const picture = zip([{ name: 'xl/media/image1.png', data: 'x', statedSize: 6 * MB }]);
    expect(await refused(picture)).toMatch(/more than 5 MB/);
  });

  it('refuses something that is not a zip', async () => {
    expect(await refused(Buffer.from('a,b\n1,2\n'))).toBe('The file is not a readable .xlsx workbook.');
  });
});

describe('the worker thread', () => {
  it('reads a workbook in a worker and hands back an ExcelJS workbook', async () => {
    const bytes = await workbookBytes((wb) => wb.addWorksheet('Rates').addRow(['Lathe', 12.5]));
    const workbook = await asUser(() => readWorkbook(bytes), 'org-1');
    expect(workbook.worksheets[0].getRow(1).values).toEqual([undefined, 'Lathe', 12.5]);
  });

  it('answers a refused workbook with 400', async () => {
    await expect(asUser(() => readWorkbook(Buffer.from('not a workbook')))).rejects.toThrow(BadRequestException);
  });

  it('ends a parse that runs out of its heap with 413, and the API thread carries on', async () => {
    // A workbook of 200k cells needs far more than a 32 MB heap to parse.
    const bytes = await workbookBytes((wb) => {
      const sheet = wb.addWorksheet('Big');
      for (let r = 0; r < 20_000; r++) sheet.addRow(Array.from({ length: 10 }, (_, c) => `r${r}c${c}`));
    });
    const task = { kind: 'workbook' as const, bytes, limits: xlsxZipLimits() };
    await expect(runInWorker(task, { workerHeapMb: 32, timeoutMs: 60_000 })).rejects.toThrow(PayloadTooLargeException);
    await expect(runInWorker(task, { workerHeapMb: 512, timeoutMs: 60_000 })).resolves.toMatchObject({ ok: true });
  });

  it('stops a parse that outlives its deadline with 413', async () => {
    const bytes = await workbookBytes((wb) => wb.addWorksheet('Rates').addRow(['x']));
    await expect(runInWorker({ kind: 'workbook', bytes, limits: xlsxZipLimits() }, { workerHeapMb: 256, timeoutMs: 1 })).rejects.toThrow(PayloadTooLargeException);
  });

  it('unpacks an archive in a worker and returns Buffers', async () => {
    const bytes = zip([{ name: 'a/one.gtl', data: 'G04*', deflate: true }, { name: 'two.gtl', data: 'x'.repeat(10_000) }]);
    const limits = { maxEntries: 10, maxEntryBytes: MB, maxTotalBytes: MB };
    const archive = await expandArchiveInWorker('pack.zip', bytes, limits);
    if (!archive.ok) throw new Error(archive.message);
    expect(archive.entries.map((e) => [e.path, Buffer.isBuffer(e.bytes), e.bytes.length])).toEqual([
      ['pack/a/one.gtl', true, 4],
      ['pack/two.gtl', true, 10_000],
    ]);
    expect(archive.entries[0].bytes.toString()).toBe('G04*');
  });
});

describe('every uploaded workbook goes through the worker', () => {
  it('no code outside the heavy-work worker hands bytes to ExcelJS', () => {
    const root = path.resolve(__dirname, '..', '..');
    const loaders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && /xlsx\.(load|read)\(|csv\.read\(/.test(fs.readFileSync(full, 'utf8'))) {
          loaders.push(path.relative(root, full));
        }
      }
    };
    walk(root);
    expect(loaders).toEqual([path.join('common', 'heavy-work', 'heavy-tasks.ts')]);
  });
});
