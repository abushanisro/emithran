import { classifyStatement, splitStatements } from './sql-statements';

const kinds = (sql: string) => splitStatements(sql).map((s) => classifyStatement(s));

describe('splitStatements', () => {
  it('splits on top-level semicolons only', () => {
    expect(splitStatements(`CREATE TABLE a (x int); INSERT INTO a VALUES (1); `)).toEqual(['CREATE TABLE a (x int)', 'INSERT INTO a VALUES (1)']);
  });

  it("ignores ';' and keywords inside strings, quoted identifiers and comments", () => {
    const sql = `INSERT INTO t (n) VALUES ('a; INSERT INTO x'); -- INSERT INTO y;
      /* DELETE FROM z; */ UPDATE "odd;name" SET n = 'it''s';`;
    expect(splitStatements(sql)).toHaveLength(2);
    expect(kinds(sql).map((k) => k.table)).toEqual(['t', 'odd;name']);
  });

  it('keeps function and DO bodies opaque, whatever they contain', () => {
    const sql = `CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN INSERT INTO a VALUES (1); DELETE FROM b; END $fn$;
      DO $$ BEGIN UPDATE c SET x = 1; END $$;`;
    expect(kinds(sql)).toEqual([{ kind: 'schema' }, { kind: 'procedural' }]);
  });

  it("handles E'' strings with backslash-escaped quotes", () => {
    expect(splitStatements(`INSERT INTO t VALUES (E'a\\'; b'); SELECT 1;`)).toHaveLength(2);
  });
});

describe('classifyStatement', () => {
  it.each([
    ['ALTER TABLE a ADD COLUMN b int', { kind: 'schema' }],
    ['CREATE POLICY p ON a USING (true)', { kind: 'schema' }],
    ['GRANT SELECT ON a TO authenticated', { kind: 'schema' }],
    ['COPY public.rates (a, b) FROM stdin', { kind: 'data', verb: 'COPY', table: 'public.rates' }],
    ['UPDATE ONLY public.machines SET rate = 1', { kind: 'data', verb: 'UPDATE', table: 'public.machines' }],
    ['DELETE FROM materials WHERE id = 1', { kind: 'data', verb: 'DELETE', table: 'materials' }],
    ['TRUNCATE TABLE lookup', { kind: 'data', verb: 'TRUNCATE', table: 'lookup' }],
    ['SELECT seed_rates()', { kind: 'procedural' }],
    ['SET search_path = public', { kind: 'other' }],
  ])('%s', (sql, expected) => {
    expect(classifyStatement(sql)).toEqual(expected);
  });

  it('counts the rows of an INSERT ... VALUES, and none for INSERT ... SELECT', () => {
    expect(classifyStatement(`INSERT INTO "Public"."Rates" (a, b) VALUES (1, (2)), (3, now()) ON CONFLICT (a) DO NOTHING`)).toEqual({
      kind: 'data',
      verb: 'INSERT',
      table: 'public.rates',
      rows: 2,
    });
    expect(classifyStatement('INSERT INTO a SELECT * FROM b')).toMatchObject({ rows: 0 });
  });

  it('sees through a leading CTE to the write', () => {
    expect(classifyStatement('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x')).toMatchObject({ kind: 'data', table: 't' });
  });
});
