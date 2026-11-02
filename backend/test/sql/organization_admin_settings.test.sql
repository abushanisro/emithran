-- 944: an organization's budget exchange rates are changed by its admins (or owner) only; members still read
-- the rates. exchange_rates carries only the columns 940/944 rely on (the real table is migration 150 + 803).
CREATE TABLE public.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_currency varchar(3) NOT NULL, to_currency varchar(3) NOT NULL,
  rate numeric(12, 6) NOT NULL, is_active boolean NOT NULL DEFAULT true
);
GRANT SELECT ON public.exchange_rates TO authenticated;
INSERT INTO public.exchange_rates (from_currency, to_currency, rate) VALUES ('USD', 'EUR', 0.8464);

-- organization A: an admin, an owner, a member and a viewer
INSERT INTO auth.users (id) VALUES
  ('11111111-0000-4000-8000-00000000000a'), ('11111111-0000-4000-8000-00000000000b'),
  ('11111111-0000-4000-8000-00000000000c'), ('11111111-0000-4000-8000-00000000000d');
INSERT INTO public.organizations (id) VALUES ('aaaaaaaa-0000-4000-8000-000000000001');
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-00000000000a', 'admin'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-00000000000b', 'owner'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-00000000000c', 'member'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-00000000000d', 'viewer');

SET ROLE authenticated;
SELECT set_config('test.org_ids', 'aaaaaaaa-0000-4000-8000-000000000001', false);

-- The admin and the owner set rates.
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000a', false);
SELECT public.set_organization_exchange_rate('aaaaaaaa-0000-4000-8000-000000000001', 'EUR', 0.9, 'FY budget');
SELECT set_config('test.uid', '11111111-0000-4000-8000-00000000000b', false);
SELECT public.set_organization_exchange_rate('aaaaaaaa-0000-4000-8000-000000000001', 'EUR', 0.95, 'owner revision');

-- A member and a viewer read the rate but cannot change it, by the function or directly.
DO $$
DECLARE who text;
BEGIN
  FOREACH who IN ARRAY ARRAY['11111111-0000-4000-8000-00000000000c', '11111111-0000-4000-8000-00000000000d'] LOOP
    PERFORM set_config('test.uid', who, false);
    ASSERT (SELECT rate FROM public.get_organization_exchange_rates('aaaaaaaa-0000-4000-8000-000000000001') WHERE currency = 'EUR') = 0.95,
      'members and viewers read the organization''s rate';
    BEGIN
      PERFORM public.set_organization_exchange_rate('aaaaaaaa-0000-4000-8000-000000000001', 'EUR', 5, 'not an admin');
      RAISE EXCEPTION '% set a rate without being an admin', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO public.organization_exchange_rates (organization_id, currency, rate, set_by, reason)
      VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'EUR', 5, who::uuid, 'direct');
      RAISE EXCEPTION '% inserted a rate without being an admin', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    UPDATE public.organization_exchange_rates SET is_active = false;
    ASSERT (SELECT count(*) FROM public.organization_exchange_rates WHERE is_active) = 1, 'a non-admin cannot retire the active rate';
  END LOOP;
END $$;
RESET ROLE;

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.organization_exchange_rates) = 2, 'only the admin''s and the owner''s rates were stored';
END $$;
