import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BOM_ITEM_DTO_COLUMNS, BOMItemResponseDto } from '../../../modules/bom-items/dto/bom-item-response.dto';

/**
 * findAll/findOne select BOM_ITEM_DTO_COLUMNS instead of '*'. A column
 * fromDatabase starts reading but the list leaves out would silently arrive as
 * undefined, so the two must match exactly.
 */
describe('BOM_ITEM_DTO_COLUMNS', () => {
  const selected = BOM_ITEM_DTO_COLUMNS.split(',');

  const source = readFileSync(
    resolve(__dirname, '../../../modules/bom-items/dto/bom-item-response.dto.ts'),
    'utf8',
  );
  const body = source.slice(source.indexOf('static fromDatabase'));
  const fnBody = body.slice(0, body.indexOf('\n  }\n') > 0 ? body.indexOf('\n  }\n') : body.indexOf('\r\n  }\r\n'));
  const read = new Set([...fnBody.matchAll(/row\.([a-z0-9_]+)/g)].map((m) => m[1]));

  it('selects every column fromDatabase reads', () => {
    expect([...read].filter((c) => !selected.includes(c))).toEqual([]);
  });

  it('selects nothing fromDatabase does not read', () => {
    expect(selected.filter((c) => !read.has(c))).toEqual([]);
  });

  it('has no duplicates or blanks', () => {
    expect(new Set(selected).size).toBe(selected.length);
    expect(selected.every((c) => /^[a-z0-9_]+$/.test(c))).toBe(true);
  });

  it('still builds a DTO from a row holding only those columns', () => {
    const row = Object.fromEntries(selected.map((c) => [c, null]));
    Object.assign(row, { id: 'i1', bom_id: 'b1', name: 'Part', part_number: 'P-1', item_type: 'part', quantity: 1 });
    expect(() => BOMItemResponseDto.fromDatabase(row)).not.toThrow();
  });
});
