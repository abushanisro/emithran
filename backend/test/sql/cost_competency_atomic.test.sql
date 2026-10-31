-- 936: a cost competency update applies all of its rows or none of them.
-- The two tables as migration 306 creates them (without the foreign key to the nomination, which this test does not need).
CREATE TABLE public.cost_competency_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nomination_evaluation_id uuid NOT NULL, cost_component varchar(255) NOT NULL,
  base_value decimal(15,4) DEFAULT 0, base_payment_term varchar(100), updated_at timestamptz DEFAULT now(),
  UNIQUE (nomination_evaluation_id, cost_component)
);
CREATE TABLE public.cost_competency_vendor_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_analysis_id uuid NOT NULL REFERENCES cost_competency_analysis(id) ON DELETE CASCADE, vendor_id uuid NOT NULL,
  numeric_value decimal(15,4), text_value text, updated_at timestamptz DEFAULT now(), UNIQUE (cost_analysis_id, vendor_id)
);
INSERT INTO cost_competency_analysis (id, nomination_evaluation_id, cost_component, base_value, base_payment_term) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'Net Price/unit', 10, '30'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1', 'Tooling Cost', 20, '45');
INSERT INTO cost_competency_vendor_values (cost_analysis_id, vendor_id, numeric_value, text_value) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 1, 'x'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1', 2, 'y');

DO $$
DECLARE failed boolean;
BEGIN
  -- a valid payload updates every row; absent keys leave their column alone
  PERFORM update_cost_competency_analysis('00000000-0000-0000-0000-0000000000f1', '[
    {"costComponent": "Net Price/unit", "baseValue": 11, "vendorValues": [{"vendorId": "00000000-0000-0000-0000-0000000000e1", "numericValue": 5}]},
    {"costComponent": "Tooling Cost", "basePaymentTerm": "60", "vendorValues": []}
  ]');
  ASSERT (SELECT base_value FROM cost_competency_analysis WHERE id = '00000000-0000-0000-0000-0000000000a1') = 11, 'base value updated';
  ASSERT (SELECT base_payment_term FROM cost_competency_analysis WHERE id = '00000000-0000-0000-0000-0000000000a1') = '30', 'absent term kept';
  ASSERT (SELECT base_value FROM cost_competency_analysis WHERE id = '00000000-0000-0000-0000-0000000000a2') = 20, 'absent value kept';
  ASSERT (SELECT base_payment_term FROM cost_competency_analysis WHERE id = '00000000-0000-0000-0000-0000000000a2') = '60', 'term updated';
  ASSERT (SELECT numeric_value FROM cost_competency_vendor_values WHERE cost_analysis_id = '00000000-0000-0000-0000-0000000000a1') = 5
     AND (SELECT text_value FROM cost_competency_vendor_values WHERE cost_analysis_id = '00000000-0000-0000-0000-0000000000a1') = 'x',
    'vendor value updated, absent text kept';

  -- a failure in the last row undoes the earlier rows of the same call
  failed := false;
  BEGIN
    PERFORM update_cost_competency_analysis('00000000-0000-0000-0000-0000000000f1', '[
      {"costComponent": "Net Price/unit", "baseValue": 99, "vendorValues": []},
      {"costComponent": "Tooling Cost", "vendorValues": [{"vendorId": "00000000-0000-0000-0000-0000000000e9", "numericValue": 1}]}
    ]');
  EXCEPTION WHEN no_data_found THEN failed := true;
  END;
  ASSERT failed, 'an unknown vendor value fails the call';
  ASSERT (SELECT base_value FROM cost_competency_analysis WHERE id = '00000000-0000-0000-0000-0000000000a1') = 11, 'earlier row rolled back';

  failed := false;
  BEGIN
    PERFORM update_cost_competency_analysis('00000000-0000-0000-0000-0000000000f1', '[{"costComponent": "Nope", "vendorValues": []}]');
  EXCEPTION WHEN no_data_found THEN failed := true;
  END;
  ASSERT failed, 'an unknown cost component fails the call';

  failed := false;
  BEGIN
    PERFORM update_cost_competency_analysis('00000000-0000-0000-0000-0000000000f2', '[{"costComponent": "Net Price/unit"}]');
  EXCEPTION WHEN no_data_found THEN failed := true;
  END;
  ASSERT failed, 'another nomination''s rows are not touched';

  ASSERT has_function_privilege('authenticated', 'public.update_cost_competency_analysis(uuid, jsonb)', 'EXECUTE'), 'users can call it';
  ASSERT NOT has_function_privilege('anon', 'public.update_cost_competency_analysis(uuid, jsonb)', 'EXECUTE'), 'anon cannot';
END $$;
