-- Curation is a trusted administrator decision, never the user's review checkbox.
BEGIN;
UPDATE public.kitchen_records
SET body=body||'{"approvalStatus":"pending"}'::jsonb,version=version+1,updated_at=now()
WHERE kind='swap' AND NOT body ? 'approvalStatus';

ALTER TABLE public.kitchen_records DROP CONSTRAINT IF EXISTS kitchen_swap_approval_shape;
ALTER TABLE public.kitchen_records ADD CONSTRAINT kitchen_swap_approval_shape CHECK (
  kind<>'swap' OR (
    coalesce(body->>'approvalStatus','') IN ('pending','approved','rejected') AND
    (body->>'approvalStatus'='pending' OR (
      length(trim(coalesce(body->>'approvalNote','')))>0 AND
      coalesce(body->>'approvalSourceUrl','') ~ '^https?://' AND
      coalesce(body->>'approvalReviewedBy','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' AND
      length(trim(coalesce(body->>'approvalReviewedAt','')))>0
    ))
  )
);

CREATE OR REPLACE FUNCTION public.kitchen_swap_review_invalidation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE review_fields text[]:=ARRAY['approvalStatus','approvalNote','approvalSourceUrl','approvalReviewedBy','approvalReviewedAt','approvalReviewType'];
BEGIN
  IF OLD.kind='swap' AND NEW.kind='swap' AND NEW.body IS DISTINCT FROM OLD.body THEN
    IF NEW.version<>OLD.version+1 THEN
      RAISE EXCEPTION 'Substitution changes require a new compare-and-set version' USING ERRCODE='23514';
    END IF;
    -- Editing any declared rule content invalidates the old decision. The review
    -- endpoint changes only the approval fields on the exact persisted version.
    IF (NEW.body-review_fields) IS DISTINCT FROM (OLD.body-review_fields) THEN
      NEW.body:=(NEW.body-review_fields)||'{"approvalStatus":"pending"}'::jsonb;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.kitchen_swap_review_invalidation() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS kitchen_swap_review_invalidation ON public.kitchen_records;
CREATE TRIGGER kitchen_swap_review_invalidation BEFORE UPDATE ON public.kitchen_records
FOR EACH ROW EXECUTE FUNCTION public.kitchen_swap_review_invalidation();

-- Gateway endpoints check app_metadata. Private kitchens remain scoped for reads.
REVOKE INSERT,UPDATE,DELETE ON public.kitchen_records FROM PUBLIC,anon,authenticated;
COMMIT;
