BEGIN;
CREATE TABLE IF NOT EXISTS public.kitchen_publications (
 scope_id uuid PRIMARY KEY REFERENCES public.kitchen_scopes(id) ON DELETE CASCADE,
 slug text NOT NULL UNIQUE CHECK(length(slug) BETWEEN 3 AND 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 published boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kitchen_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitchen_publications FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.kitchen_publications TO service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='letmecook_gateway') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON public.kitchen_publications TO letmecook_gateway;
 END IF;
END $$;
-- Anonymous access is only through the bounded gateway projection with fresh
-- public/source-image/administrator permission checks, never the underlying table.
COMMIT;
