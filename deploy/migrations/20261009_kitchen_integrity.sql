-- Additive operational safeguards. Apply after weekly_meal_plans; no user rows reset.
BEGIN;
CREATE TABLE IF NOT EXISTS public.kitchen_pantry_receipts (
  scope_id uuid NOT NULL REFERENCES public.kitchen_scopes(id) ON DELETE CASCADE,
  operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 8 AND 100),
  line_id uuid NOT NULL,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  fingerprint text NOT NULL CHECK (length(fingerprint)=64),
  response jsonb NOT NULL CHECK (jsonb_typeof(response)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(scope_id,operation_key,line_id)
);
ALTER TABLE public.kitchen_pantry_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitchen_pantry_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.kitchen_pantry_receipts TO service_role;
ALTER TABLE public.kitchen_consumption_receipts ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.weekly_meal_plans(id) ON DELETE SET NULL;
ALTER TABLE public.kitchen_consumption_receipts ADD COLUMN IF NOT EXISTS day_index integer CHECK(day_index BETWEEN 0 AND 6);
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_consumption_plan_slot ON public.kitchen_consumption_receipts(plan_id,day_index) WHERE plan_id IS NOT NULL;
-- Supports both expiry-filtered exports and bounded chronological retention batches.
CREATE INDEX IF NOT EXISTS kitchen_evidence_expiry ON public.kitchen_evidence_events(confirmed_at,id);
CREATE INDEX IF NOT EXISTS kitchen_evidence_owner_time ON public.kitchen_evidence_events(user_id,confirmed_at,id);
COMMIT;
NOTIFY pgrst,'reload schema';
