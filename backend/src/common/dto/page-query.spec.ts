import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, PageQueryDto, pageRange, parseSort } from './page-query';

const check = async (plain: Record<string, unknown>) => {
  const dto = plainToInstance(PageQueryDto, plain);
  return { dto, errors: await validate(dto) };
};

describe('PageQueryDto', () => {
  it('defaults to the first page of 50', async () => {
    const { dto, errors } = await check({});
    expect(errors).toEqual([]);
    expect([dto.page, dto.limit]).toEqual([1, PAGE_LIMIT_DEFAULT]);
  });

  it('reads numbers from the query string', async () => {
    const { dto, errors } = await check({ page: '3', limit: '25' });
    expect(errors).toEqual([]);
    expect([dto.page, dto.limit]).toEqual([3, 25]);
  });

  it.each([[{ limit: String(PAGE_LIMIT_MAX + 1) }], [{ limit: '0' }], [{ page: '0' }], [{ limit: '1.5' }], [{ limit: 'ten' }]])('refuses %j', async (plain) => {
    expect((await check(plain)).errors.length).toBeGreaterThan(0);
  });

  it('accepts the largest allowed page', async () => {
    expect((await check({ limit: String(PAGE_LIMIT_MAX) })).errors).toEqual([]);
  });
});

describe('parseSort', () => {
  const allowed = ['name', 'createdAt'] as const;

  it('reads + and - and a bare name, in order', () => {
    expect(parseSort('+name,-createdAt', allowed)).toEqual([{ field: 'name', ascending: true }, { field: 'createdAt', ascending: false }]);
    expect(parseSort(' name', allowed)).toEqual([{ field: 'name', ascending: true }]); // a + in a URL arrives as a space
  });

  it('maps a public field to its column', () => {
    expect(parseSort('-createdAt', allowed, { createdAt: 'created_at' })).toEqual([{ field: 'created_at', ascending: false }]);
  });

  it('is empty without a sort', () => {
    expect(parseSort(undefined, allowed)).toEqual([]);
    expect(parseSort('', allowed)).toEqual([]);
  });

  it('refuses a field that is not on the list, and says which are', () => {
    expect(() => parseSort('+password_hash', allowed)).toThrow(BadRequestException);
    expect(() => parseSort('name,-secret', allowed)).toThrow(/Allowed: name, createdAt/);
  });
});

describe('pageRange', () => {
  it('gives the first and last row of a page, zero-based and inclusive', () => {
    expect(pageRange(1, 50)).toEqual([0, 49]);
    expect(pageRange(3, 20)).toEqual([40, 59]);
  });
});
