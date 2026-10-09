-- Additive local kitchen data. Gateway checks JWT/RBAC even with the service DB role.
BEGIN;
CREATE TABLE IF NOT EXISTS public.kitchen_scopes (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('personal','household')),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_personal_owner ON public.kitchen_scopes(owner_id) WHERE kind='personal';
CREATE TABLE IF NOT EXISTS public.kitchen_members (
  scope_id uuid NOT NULL REFERENCES public.kitchen_scopes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK(role IN ('owner','editor','viewer')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(scope_id,user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_single_owner ON public.kitchen_members(scope_id) WHERE role='owner';
CREATE TABLE IF NOT EXISTS public.kitchen_invites (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL REFERENCES public.kitchen_scopes(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  role text NOT NULL CHECK(role IN ('editor','viewer')),
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  used_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((used_by IS NULL AND used_at IS NULL) OR used_at IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.kitchen_records (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL REFERENCES public.kitchen_scopes(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('pantry','price','session','swap','workspace','catalog','shopping')),
  body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=1000000),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kitchen_records_scope_kind ON public.kitchen_records(scope_id,kind,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_singleton_records ON public.kitchen_records(scope_id,kind) WHERE kind IN ('workspace','shopping');
CREATE TABLE IF NOT EXISTS public.kitchen_ledger (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL REFERENCES public.kitchen_scopes(id) ON DELETE CASCADE,
  lot_id uuid NOT NULL,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK(action IN ('added','updated','removed','consumed')),
  ingredient text NOT NULL,
  delta numeric,
  unit text NOT NULL,
  session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kitchen_ledger_scope_time ON public.kitchen_ledger(scope_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.kitchen_consumption_receipts (
  scope_id uuid NOT NULL REFERENCES public.kitchen_scopes(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 100),
  session_id uuid NOT NULL REFERENCES public.kitchen_records(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  fingerprint text NOT NULL,
  response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(scope_id,idempotency_key),
  UNIQUE(session_id)
);
CREATE TABLE IF NOT EXISTS public.kitchen_consent (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.kitchen_evidence_events (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL REFERENCES public.kitchen_scopes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL UNIQUE REFERENCES public.kitchen_records(id) ON DELETE CASCADE,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kitchen_evidence_scope_time ON public.kitchen_evidence_events(scope_id,confirmed_at);
-- A departing/deleted member must not erase the shared stock, cooking history or
-- ledger they contributed. Personal scopes still follow their owner's lifecycle.
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['kitchen_records','kitchen_ledger','kitchen_consumption_receipts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN actor_id DROP NOT NULL',tab);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',tab,tab||'_actor_id_fkey');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY(actor_id) REFERENCES public.users(id) ON DELETE SET NULL',tab,tab||'_actor_id_fkey');
  END LOOP;
END $$;

-- Avoid recursive membership policies; only expose a boolean for the current JWT.
CREATE OR REPLACE FUNCTION public.kitchen_can_read(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(SELECT 1 FROM public.kitchen_scopes s WHERE s.id=target AND
    (s.owner_id=auth.uid() OR EXISTS(SELECT 1 FROM public.kitchen_members m WHERE m.scope_id=s.id AND m.user_id=auth.uid())))
$$;
REVOKE ALL ON FUNCTION public.kitchen_can_read(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kitchen_can_read(uuid) TO authenticated,service_role;
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['kitchen_scopes','kitchen_members','kitchen_invites','kitchen_records','kitchen_ledger','kitchen_consumption_receipts','kitchen_consent','kitchen_evidence_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',tab);
  END LOOP;
END $$;
DROP POLICY IF EXISTS kitchen_scope_read ON public.kitchen_scopes;
CREATE POLICY kitchen_scope_read ON public.kitchen_scopes FOR SELECT TO authenticated USING(public.kitchen_can_read(id));
DROP POLICY IF EXISTS kitchen_member_read ON public.kitchen_members;
CREATE POLICY kitchen_member_read ON public.kitchen_members FOR SELECT TO authenticated USING(public.kitchen_can_read(scope_id));
DROP POLICY IF EXISTS kitchen_record_read ON public.kitchen_records;
CREATE POLICY kitchen_record_read ON public.kitchen_records FOR SELECT TO authenticated USING(public.kitchen_can_read(scope_id));
DROP POLICY IF EXISTS kitchen_ledger_read ON public.kitchen_ledger;
CREATE POLICY kitchen_ledger_read ON public.kitchen_ledger FOR SELECT TO authenticated USING(public.kitchen_can_read(scope_id));
DROP POLICY IF EXISTS kitchen_consent_read ON public.kitchen_consent;
CREATE POLICY kitchen_consent_read ON public.kitchen_consent FOR SELECT TO authenticated USING(user_id=auth.uid());
DROP POLICY IF EXISTS kitchen_evidence_read ON public.kitchen_evidence_events;
CREATE POLICY kitchen_evidence_read ON public.kitchen_evidence_events FOR SELECT TO authenticated USING(
  public.kitchen_can_read(scope_id) AND EXISTS(SELECT 1 FROM public.kitchen_consent c WHERE c.user_id=kitchen_evidence_events.user_id AND c.enabled)
);
-- Evidence events and invite/receipt internals are gateway-only. Aggregate evidence respects consent.
GRANT SELECT ON public.kitchen_scopes,public.kitchen_members,public.kitchen_records,public.kitchen_ledger,public.kitchen_consent TO authenticated;
COMMIT;
