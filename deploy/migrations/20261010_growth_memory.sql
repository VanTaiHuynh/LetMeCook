BEGIN;
CREATE TABLE IF NOT EXISTS public.kitchen_preference_sharing (
 scope_id uuid NOT NULL REFERENCES public.kitchen_scopes(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.kitchen_taste_feedback (
 id uuid PRIMARY KEY, scope_id uuid NOT NULL REFERENCES public.kitchen_scopes(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES public.kitchen_records(id) ON DELETE CASCADE,
 recipe_id uuid NOT NULL REFERENCES public.recipe(id) ON DELETE CASCADE,
 rating smallint NOT NULL CHECK(rating BETWEEN 1 AND 5),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=20000),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,user_id)
);
CREATE INDEX IF NOT EXISTS kitchen_taste_actor_time ON public.kitchen_taste_feedback(scope_id,user_id,updated_at DESC,id);
CREATE TABLE IF NOT EXISTS public.kitchen_leftovers (
 id uuid PRIMARY KEY, scope_id uuid NOT NULL REFERENCES public.kitchen_scopes(id) ON DELETE CASCADE,
 session_id uuid NOT NULL UNIQUE REFERENCES public.kitchen_records(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
 recipe_id uuid NOT NULL REFERENCES public.recipe(id) ON DELETE CASCADE, title text NOT NULL CHECK(length(title)<=500),
 servings_available numeric(12,3) NOT NULL CHECK(servings_available>=0 AND servings_available<=1000),
 cooked_on date NOT NULL, use_by date CHECK(use_by IS NULL OR use_by>=cooked_on),
 confirmed_at timestamptz NOT NULL DEFAULT now(), version bigint NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE INDEX IF NOT EXISTS kitchen_leftover_scope ON public.kitchen_leftovers(scope_id,confirmed_at DESC,id);
CREATE TABLE IF NOT EXISTS public.kitchen_growth_receipts (
 scope_id uuid NOT NULL REFERENCES public.kitchen_scopes(id) ON DELETE CASCADE,
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 100),
 actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
 fingerprint text NOT NULL, response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope_id,idempotency_key)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['kitchen_preference_sharing','kitchen_taste_feedback','kitchen_leftovers','kitchen_growth_receipts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',tab);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='letmecook_gateway') THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO letmecook_gateway',tab);
  END IF;
 END LOOP;
END $$;
-- Private preferences and receipts are gateway-only; household membership is freshly
-- checked by the gateway for every read/write, including roles which bypass RLS.
COMMIT;
