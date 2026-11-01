-- 940: an organization's budget rate override is visible to and used by that organization only; the global default stays as is.
-- exchange_rates carries only the columns 940 relies on (the real table is migration 150 + 803).
CREATE TABLE public.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_currency varchar(3) NOT NULL, to_currency varchar(3) NOT NULL,
  rate numeric(12, 6) NOT NULL, is_active boolean NOT NULL DEFAULT true
);
GRANT SELECT ON public.exchange_rates TO authenticated;
INSERT INTO public.exchange_rates (from_currency, to_currency, rate) VALUES ('USD', 'EUR', 0.8464), ('USD', 'INR', 64.3455);

INSERT INTO auth.users (id) VALUES ('11111111-0000-4000-8000-00000000000a'), ('11111111-0000-4000-8000-00000000000b');
INSERT INTO public.organizations (id) VALUES ('aaaaaaaa-0000-4000-8000-000000000001'), ('bbbbbbbb-0000-4000-8000-000000000002');

\i /migrations/940_organization_exchange_rates.sql
\i /migrations/940_organization_exchange_rates.sql

-- A member of organization A sets EUR twice: the first value is kept as history.
SET ROLE authenticated;
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000a', false);
SELECT set_config('test.org_ids', 'aaaaaaaa-0000-4000-8000-000000000001', false);
SELECT public.set_organization_exchange_rate('aaaaaaaa-0000-4000-8000-000000000001', 'eur', 0.9, 'FY budget');
SELECT public.set_organization_exchange_rate('aaaaaaaa-0000-4000-8000-000000000001', 'EUR', 1000, 'second edit');

DO $$
BEGIN
  ASSERT (SELECT rate FROM public.get_organization_exchange_rates('aaaaaaaa-0000-4000-8000-000000000001') WHERE currency = 'EUR') = 1000,
    'A sees its active override';
  ASSERT (SELECT count(*) FROM public.organization_exchange_rates) = 2, 'the replaced override is kept as inactive history';
  ASSERT (SELECT set_by FROM public.organization_exchange_rates WHERE is_active) = '11111111-0000-4000-8000-00000000000a', 'who set it';
  -- A cannot write B's rates, by the function or directly
  BEGIN
    PERFORM public.set_organization_exchange_rate('bbbbbbbb-0000-4000-8000-000000000002', 'EUR', 5, 'cross-tenant');
    RAISE EXCEPTION 'A set B''s rate';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.organization_exchange_rates (organization_id, currency, rate, set_by, reason)
    VALUES ('bbbbbbbb-0000-4000-8000-000000000002', 'EUR', 5, '11111111-0000-4000-8000-00000000000a', 'direct');
    RAISE EXCEPTION 'A inserted a rate for B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_organization_exchange_rates('bbbbbbbb-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'A read B''s rates';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- no rewriting the rate of a stored row (only is_active may change)
  BEGIN
    UPDATE public.organization_exchange_rates SET rate = 1;
    RAISE EXCEPTION 'a stored rate was rewritten';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- only currencies with a global default
  BEGIN
    PERFORM public.set_organization_exchange_rate('aaaaaaaa-0000-4000-8000-000000000001', 'XYZ', 5, 'unknown');
    RAISE EXCEPTION 'an unknown currency was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;

-- A member of organization B sees none of it, and the global default is unchanged.
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000b', false);
SELECT set_config('test.org_ids', 'bbbbbbbb-0000-4000-8000-000000000002', false);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.organization_exchange_rates) = 0, 'B sees no row of A';
  ASSERT (SELECT count(*) FROM public.get_organization_exchange_rates('bbbbbbbb-0000-4000-8000-000000000002')) = 0, 'B has no override';
  ASSERT (SELECT rate FROM public.exchange_rates WHERE to_currency = 'EUR' AND is_active) = 0.8464, 'the global default is unchanged';
END $$;
RESET ROLE;

SET ROLE anon;
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.set_organization_exchange_rate(uuid, text, numeric, text)', 'EXECUTE'), 'anon cannot set';
  ASSERT NOT has_table_privilege('anon', 'public.organization_exchange_rates', 'SELECT'), 'anon cannot read';
END $$;
RESET ROLE;
