BEGIN;
UPDATE public.lmc_platform_settings SET settings=jsonb_set(settings,'{collaborationEnabled}','false'::jsonb),version=version+1 WHERE id=true AND NOT(settings?'collaborationEnabled');
CREATE TABLE IF NOT EXISTS public.kitchen_cohort_enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scope_id uuid NOT NULL REFERENCES public.kitchen_scopes(id) ON DELETE CASCADE,
 cohort_name text NOT NULL CHECK(length(cohort_name) BETWEEN 1 AND 100),
 enrolled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
 enrolled_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK(expires_at=enrolled_at+interval '2160 hours'),
 state text NOT NULL DEFAULT 'active' CHECK(state IN('active','withdrawn','incomplete')),
 unavailable_reason text,
 state_changed_at timestamptz,
 release_version text NOT NULL,
 consent_version text NOT NULL,
 UNIQUE(scope_id,cohort_name)
);
CREATE INDEX IF NOT EXISTS kitchen_cohort_expiry ON public.kitchen_cohort_enrollments(expires_at,id);
CREATE OR REPLACE FUNCTION public.kitchen_preserve_cohort_anchor() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF ROW(NEW.id,NEW.scope_id,NEW.cohort_name,NEW.enrolled_at,NEW.expires_at,NEW.release_version,NEW.consent_version)
    IS DISTINCT FROM ROW(OLD.id,OLD.scope_id,OLD.cohort_name,OLD.enrolled_at,OLD.expires_at,OLD.release_version,OLD.consent_version) THEN
  RAISE EXCEPTION 'A named cohort enrollment anchor is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kitchen_cohort_anchor_immutable ON public.kitchen_cohort_enrollments;
CREATE TRIGGER kitchen_cohort_anchor_immutable BEFORE UPDATE ON public.kitchen_cohort_enrollments
FOR EACH ROW EXECUTE FUNCTION public.kitchen_preserve_cohort_anchor();
REVOKE ALL ON FUNCTION public.kitchen_preserve_cohort_anchor() FROM PUBLIC,anon,authenticated;
ALTER TABLE public.kitchen_cohort_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kitchen_cohort_read ON public.kitchen_cohort_enrollments;
CREATE POLICY kitchen_cohort_read ON public.kitchen_cohort_enrollments FOR SELECT TO authenticated USING(public.kitchen_can_read(scope_id));
REVOKE ALL ON public.kitchen_cohort_enrollments FROM PUBLIC,anon,authenticated;
-- Cohort actor identity and enrollment consent are gateway-only; public view exposes no enrolled_by.
GRANT ALL ON public.kitchen_cohort_enrollments TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
