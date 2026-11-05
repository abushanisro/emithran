import { isMissingTable } from './missing-table';

describe('isMissingTable', () => {
  it('is true for the codes PostgREST and Postgres use, and for the PostgREST message alone', () => {
    expect(isMissingTable({ code: 'PGRST205', message: 'x' })).toBe(true);
    expect(isMissingTable({ code: '42P01', message: 'relation "x" does not exist' })).toBe(true);
    expect(isMissingTable({ message: "Could not find the table 'public.process_routes' in the schema cache" })).toBe(true);
  });
  it('is false for anything else, including a missing column and no error', () => {
    expect(isMissingTable({ code: '42703', message: 'column x does not exist' })).toBe(false);
    expect(isMissingTable({ code: 'XX000', message: 'boom' })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
    expect(isMissingTable(undefined)).toBe(false);
  });
});
