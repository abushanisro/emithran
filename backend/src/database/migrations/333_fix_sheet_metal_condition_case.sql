-- Migration 333: Canonicalize routing-template condition_feature values to UPPER_SNAKE
--
-- Migration 318 seeded the sheet-metal template with "condition_feature": "bend",
-- but manufacturing feature types are UPPER_SNAKE ("BEND", "THREAD_INTERNAL").
-- DeterministicPlannerService compared them case-sensitively, so every
-- conditional step was silently skipped — flat AND bent sheet parts both lost
-- the Bend Brake step. The planner now matches case-insensitively; this
-- migration makes the stored data canonical so templates read unambiguously.
--
-- Applies to ALL templates (any family, system or user) — uppercasing is safe
-- because matching is case-insensitive and feature types are defined uppercase.

UPDATE part_family_routing_templates
SET routing_sequence = (
  SELECT jsonb_agg(
    CASE
      WHEN step ? 'condition_feature'
        THEN jsonb_set(step, '{condition_feature}', to_jsonb(upper(step->>'condition_feature')))
      ELSE step
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(routing_sequence) WITH ORDINALITY AS t(step, ord)
)
WHERE routing_sequence IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(routing_sequence) AS s(step)
    WHERE s.step ? 'condition_feature'
      AND s.step->>'condition_feature' <> upper(s.step->>'condition_feature')
  );
