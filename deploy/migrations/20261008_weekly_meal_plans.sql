-- Canonical plans are written through the authenticated Spring gateway. Re-runnable.
BEGIN;
CREATE TABLE IF NOT EXISTS public.weekly_meal_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start),
  CHECK (plan ?& ARRAY['weekStart', 'meals', 'checkedItems']),
  CHECK (plan ->> 'weekStart' = week_start::text),
  CHECK (jsonb_typeof(plan -> 'meals') = 'array'),
  CHECK (jsonb_typeof(plan -> 'checkedItems') = 'array'),
  CHECK (jsonb_array_length(plan -> 'meals') <= 7)
);
CREATE INDEX IF NOT EXISTS lmc_weekly_meal_plans_owner_updated ON public.weekly_meal_plans(user_id, updated_at DESC);
ALTER TABLE public.weekly_meal_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lmc_weekly_meal_plans_read ON public.weekly_meal_plans;
CREATE POLICY lmc_weekly_meal_plans_read ON public.weekly_meal_plans FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
-- Direct client snapshots cannot bypass canonical recipe/intent validation or version checks.
REVOKE ALL ON public.weekly_meal_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.weekly_meal_plans TO authenticated;
GRANT ALL ON public.weekly_meal_plans TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
