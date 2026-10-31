-- Migration 936: update a nomination's cost competency analysis in one transaction.
--
-- The API used to update each cost row and each vendor value with its own request, so a failure part way left the analysis
-- half-updated, and a vendor value that failed (or matched no row) was only logged. This function applies the whole payload or
-- nothing: any unknown cost component or vendor value raises, which rolls back every change made by the call.
--
-- p_components: [{ "costComponent": text, "baseValue"?: number, "basePaymentTerm"?: text,
--                  "vendorValues": [{ "vendorId": uuid, "numericValue"?: number, "textValue"?: text }] }]
-- A key that is absent leaves its column as it is; a key that is present (also as null) sets it.
-- SECURITY INVOKER: row-level security on both tables applies to the caller exactly as for direct updates.

CREATE OR REPLACE FUNCTION public.update_cost_competency_analysis(p_nomination_evaluation_id uuid, p_components jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  c jsonb;
  v jsonb;
  v_analysis_id uuid;
BEGIN
  IF jsonb_typeof(p_components) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'components must be an array' USING ERRCODE = '22023';
  END IF;

  FOR c IN SELECT * FROM jsonb_array_elements(p_components) LOOP
    UPDATE cost_competency_analysis
    SET base_value = CASE WHEN c ? 'baseValue' THEN (c->>'baseValue')::numeric ELSE base_value END,
        base_payment_term = CASE WHEN c ? 'basePaymentTerm' THEN c->>'basePaymentTerm' ELSE base_payment_term END,
        updated_at = now()
    WHERE nomination_evaluation_id = p_nomination_evaluation_id
      AND cost_component = c->>'costComponent'
    RETURNING id INTO v_analysis_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'cost component "%" does not exist for this nomination', c->>'costComponent' USING ERRCODE = 'P0002';
    END IF;

    FOR v IN SELECT * FROM jsonb_array_elements(COALESCE(c->'vendorValues', '[]'::jsonb)) LOOP
      UPDATE cost_competency_vendor_values
      SET numeric_value = CASE WHEN v ? 'numericValue' THEN (v->>'numericValue')::numeric ELSE numeric_value END,
          text_value = CASE WHEN v ? 'textValue' THEN v->>'textValue' ELSE text_value END,
          updated_at = now()
      WHERE cost_analysis_id = v_analysis_id
        AND vendor_id = (v->>'vendorId')::uuid;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'vendor % has no value for cost component "%"', v->>'vendorId', c->>'costComponent' USING ERRCODE = 'P0002';
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.update_cost_competency_analysis(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_cost_competency_analysis(uuid, jsonb) TO authenticated, service_role;
