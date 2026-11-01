import { BadRequestException } from '@nestjs/common';

import { VendorsService, VENDOR_CSV_MAX_LINE_LENGTH, VENDOR_IMPORT_MAX_BYTES, VENDOR_IMPORT_MAX_ROWS } from '../../../modules/vendors/vendors.service';

const logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
const service = (): any => new (VendorsService as any)({}, logger);

describe('vendor import bounds (loop-bound injection)', () => {
  it('parses an ordinary CSV line, quoted commas included', () => {
    expect(service().parseCSVLine('1,"Acme, Inc",Pune')).toEqual(['1', 'Acme, Inc', 'Pune']);
  });

  it('rejects a line longer than the bound before walking it', () => {
    expect(() => service().parseCSVLine('a'.repeat(VENDOR_CSV_MAX_LINE_LENGTH + 1))).toThrow(BadRequestException);
  });

  it('rejects a file with too many rows', () => {
    const csv = Array.from({ length: VENDOR_IMPORT_MAX_ROWS + 1 }, (_, i) => `${i},v${i}`).join('\n');
    expect(() => service().parseCsvRows(csv)).toThrow(`at most ${VENDOR_IMPORT_MAX_ROWS}`);
  });

  it('rejects an oversized upload as a bad request, not a server error', async () => {
    const file = { originalname: 'v.csv', mimetype: 'text/csv', buffer: Buffer.alloc(VENDOR_IMPORT_MAX_BYTES + 1) };
    await expect(service().importFromCsv(file, 'u', 't', 'o')).rejects.toThrow(BadRequestException);
  });
});
