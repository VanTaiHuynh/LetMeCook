-- LetMeCook local Supabase schema. Apply as postgres, after Supabase initializes
-- auth and storage. Idempotent, additive, and never resets application data.
BEGIN;

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'user',
  email text UNIQUE,
  about_me text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  cooking_skill text NOT NULL DEFAULT '',
  dietary_pref text[] NOT NULL DEFAULT '{}',
  user_allergy uuid[] NOT NULL DEFAULT '{}'
);
-- These frontend profile fields are absent from some earlier JPA-only schemas.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS user_allergy uuid[] NOT NULL DEFAULT '{}';
-- Preserve an old scalar preference as one array entry when upgrading a
-- JPA-only database; frontend profile forms use an array, not a scalar string.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
             AND table_name = 'users' AND column_name = 'dietary_pref'
             AND data_type IN ('text', 'character varying')) THEN
    ALTER TABLE public.users ALTER COLUMN dietary_pref DROP DEFAULT;
    ALTER TABLE public.users ALTER COLUMN dietary_pref TYPE text[] USING
      CASE WHEN dietary_pref IS NULL OR dietary_pref = '' THEN '{}'::text[]
           ELSE ARRAY[dietary_pref::text] END;
    ALTER TABLE public.users ALTER COLUMN dietary_pref SET DEFAULT '{}';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS public.cuisines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS public.dietary_pref (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS public.ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.recipe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  servings real NOT NULL DEFAULT 0 CHECK (servings >= 0),
  image_url text NOT NULL DEFAULT '',
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  directions text NOT NULL DEFAULT '',
  source_url text,
  source_license text,
  source_author text,
  image_source_url text,
  image_author text,
  image_license text,
  image_kind text,
  view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  time integer NOT NULL DEFAULT 0 CHECK (time >= 0),
  author_id uuid REFERENCES public.users(id) ON DELETE SET NULL
);
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS source_license text;
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS source_author text;
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS image_source_url text;
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS image_author text;
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS image_license text;
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS image_kind text;
CREATE UNIQUE INDEX IF NOT EXISTS lmc_recipe_source_url ON public.recipe(source_url)
WHERE source_url IS NOT NULL AND source_url <> '';

CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipe(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id),
  quantity text NOT NULL DEFAULT '', unit text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS public.recipe_categories (
  recipe_id uuid NOT NULL REFERENCES public.recipe(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id),
  PRIMARY KEY (recipe_id, category_id)
);
CREATE TABLE IF NOT EXISTS public.recipe_cuisines (
  recipe_id uuid NOT NULL REFERENCES public.recipe(id) ON DELETE CASCADE,
  cuisine_id uuid NOT NULL REFERENCES public.cuisines(id),
  PRIMARY KEY (recipe_id, cuisine_id)
);
CREATE TABLE IF NOT EXISTS public.recipe_dietary_pref (
  recipe_id uuid NOT NULL REFERENCES public.recipe(id) ON DELETE CASCADE,
  preference_id uuid NOT NULL REFERENCES public.dietary_pref(id),
  PRIMARY KEY (recipe_id, preference_id)
);
CREATE TABLE IF NOT EXISTS public.recipe_favourites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES public.recipe(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, recipe_id)
);
CREATE TABLE IF NOT EXISTS public.recipe_browsing_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES public.recipe(id) ON DELETE CASCADE,
  viewed_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, recipe_id)
);
CREATE TABLE IF NOT EXISTS public.recipe_disliked (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES public.recipe(id) ON DELETE CASCADE,
  UNIQUE (user_id, recipe_id)
);
CREATE TABLE IF NOT EXISTS public.user_allergy (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id),
  PRIMARY KEY (user_id, ingredient_id)
);
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipe(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  comment text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS comment text NOT NULL DEFAULT '';
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS public.review_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('cost', 'time', 'difficulty', 'overall')),
  value integer NOT NULL CHECK (value BETWEEN 1 AND 5),
  UNIQUE (review_id, category)
);

CREATE INDEX IF NOT EXISTS lmc_recipe_public_created ON public.recipe (created_at DESC) WHERE is_public;
CREATE INDEX IF NOT EXISTS lmc_recipe_public_views ON public.recipe (view_count DESC) WHERE is_public;
CREATE INDEX IF NOT EXISTS lmc_recipe_author ON public.recipe (author_id);
CREATE INDEX IF NOT EXISTS lmc_recipe_ingredients_recipe ON public.recipe_ingredients (recipe_id);
CREATE INDEX IF NOT EXISTS lmc_recipe_ingredients_ingredient ON public.recipe_ingredients (ingredient_id);
CREATE INDEX IF NOT EXISTS lmc_categories_recipe ON public.recipe_categories (category_id);
CREATE INDEX IF NOT EXISTS lmc_cuisines_recipe ON public.recipe_cuisines (cuisine_id);
CREATE INDEX IF NOT EXISTS lmc_dietary_recipe ON public.recipe_dietary_pref (preference_id);
CREATE INDEX IF NOT EXISTS lmc_favourites_recipe ON public.recipe_favourites (recipe_id);
CREATE INDEX IF NOT EXISTS lmc_history_user_time ON public.recipe_browsing_history (user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS lmc_history_recipe ON public.recipe_browsing_history (recipe_id);
CREATE INDEX IF NOT EXISTS lmc_dislikes_recipe ON public.recipe_disliked (recipe_id);
CREATE INDEX IF NOT EXISTS lmc_reviews_recipe ON public.reviews (recipe_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lmc_reviews_user ON public.reviews (user_id);
CREATE INDEX IF NOT EXISTS lmc_allergy_ingredient ON public.user_allergy (ingredient_id);

-- Registration writes auth.users; application users share that UUID. On later
-- auth updates only email is synchronized, so edited public profiles survive.
CREATE OR REPLACE FUNCTION public.lmc_sync_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.users(id, email, first_name, last_name)
  VALUES (NEW.id, NEW.email,
          COALESCE(NEW.raw_user_meta_data ->> 'first_name', ''),
          COALESCE(NEW.raw_user_meta_data ->> 'last_name', ''))
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lmc_sync_auth_user() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS lmc_auth_user_profile ON auth.users;
CREATE TRIGGER lmc_auth_user_profile AFTER INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.lmc_sync_auth_user();
INSERT INTO public.users(id, email, first_name, last_name)
SELECT id, email, COALESCE(raw_user_meta_data ->> 'first_name', ''),
       COALESCE(raw_user_meta_data ->> 'last_name', '')
FROM auth.users ON CONFLICT (id) DO NOTHING;

-- Frontend stores selected allergy IDs in the profile array. Mirror those IDs
-- into the JPA join table, validating every ID through its ingredient FK.
CREATE OR REPLACE FUNCTION public.lmc_sync_user_allergies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_allergy IS NOT DISTINCT FROM OLD.user_allergy THEN
    RETURN NEW;
  END IF;
  DELETE FROM public.user_allergy WHERE user_id = NEW.id
    AND NOT (ingredient_id = ANY (NEW.user_allergy));
  INSERT INTO public.user_allergy(user_id, ingredient_id)
  SELECT NEW.id, ingredient_id FROM unnest(NEW.user_allergy) AS ingredient_id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lmc_sync_user_allergies() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS lmc_profile_allergies ON public.users;
CREATE TRIGGER lmc_profile_allergies AFTER INSERT OR UPDATE OF user_allergy ON public.users
FOR EACH ROW EXECUTE FUNCTION public.lmc_sync_user_allergies();

-- Only these profile fields are intentionally public; emails, preferences and
-- allergies remain in the owner's protected profile. Include the base PK so
-- PostgREST can embed this view through reviews.user_id -> users.id.
CREATE OR REPLACE VIEW public.user_public_profiles WITH (security_barrier = true) AS
SELECT id, first_name, last_name, about_me, image_url FROM public.users;
REVOKE ALL ON public.user_public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_public_profiles TO anon, authenticated, service_role;

-- Keep table privileges explicit, including the columns a profile may change.
REVOKE ALL ON public.users, public.recipe, public.ingredients, public.categories,
  public.cuisines, public.dietary_pref, public.recipe_ingredients,
  public.recipe_categories, public.recipe_cuisines, public.recipe_dietary_pref,
  public.recipe_favourites, public.recipe_browsing_history, public.recipe_disliked,
  public.user_allergy, public.reviews, public.review_ratings FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.recipe, public.ingredients, public.categories, public.cuisines,
  public.dietary_pref, public.recipe_ingredients, public.recipe_categories,
  public.recipe_cuisines, public.recipe_dietary_pref, public.reviews,
  public.review_ratings TO anon, authenticated;
GRANT SELECT ON public.users, public.recipe_favourites, public.recipe_browsing_history,
  public.recipe_disliked, public.user_allergy TO authenticated;
GRANT UPDATE (first_name, last_name, about_me, image_url, cooking_skill, dietary_pref,
  user_allergy) ON public.users TO authenticated;
GRANT INSERT ON public.ingredients TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.recipe, public.recipe_ingredients,
  public.recipe_categories, public.recipe_cuisines, public.recipe_dietary_pref,
  public.recipe_favourites, public.recipe_browsing_history, public.recipe_disliked,
  public.reviews, public.review_ratings TO authenticated;
GRANT ALL ON public.users, public.recipe, public.ingredients, public.categories,
  public.cuisines, public.dietary_pref, public.recipe_ingredients,
  public.recipe_categories, public.recipe_cuisines, public.recipe_dietary_pref,
  public.recipe_favourites, public.recipe_browsing_history, public.recipe_disliked,
  public.user_allergy, public.reviews, public.review_ratings TO service_role;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lmc_profile_read ON public.users;
CREATE POLICY lmc_profile_read ON public.users FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()));
DROP POLICY IF EXISTS lmc_profile_update ON public.users;
CREATE POLICY lmc_profile_update ON public.users FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));

-- This guard fails closed before platform settings are available on a fresh install.
CREATE OR REPLACE FUNCTION public.lmc_recipe_uploads_enabled()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE enabled boolean;
BEGIN
  IF pg_catalog.to_regclass('public.lmc_platform_settings') IS NULL THEN RETURN false; END IF;
  EXECUTE 'SELECT settings->>''publicDemo''=''false'' FROM public.lmc_platform_settings WHERE id=true' INTO enabled;
  RETURN coalesce(enabled,false);
END $$;
REVOKE ALL ON FUNCTION public.lmc_recipe_uploads_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lmc_recipe_uploads_enabled() TO anon,authenticated,service_role;

ALTER TABLE public.recipe ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lmc_recipe_read ON public.recipe;
CREATE POLICY lmc_recipe_read ON public.recipe FOR SELECT TO anon, authenticated
USING (is_public OR author_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS lmc_recipe_create ON public.recipe;
CREATE POLICY lmc_recipe_create ON public.recipe FOR INSERT TO authenticated
WITH CHECK (author_id = (SELECT auth.uid()) AND public.lmc_recipe_uploads_enabled());
DROP POLICY IF EXISTS lmc_recipe_update ON public.recipe;
CREATE POLICY lmc_recipe_update ON public.recipe FOR UPDATE TO authenticated
USING (author_id = (SELECT auth.uid()) AND public.lmc_recipe_uploads_enabled()) WITH CHECK (author_id = (SELECT auth.uid()) AND public.lmc_recipe_uploads_enabled());
DROP POLICY IF EXISTS lmc_recipe_delete ON public.recipe;
CREATE POLICY lmc_recipe_delete ON public.recipe FOR DELETE TO authenticated
USING (author_id = (SELECT auth.uid()) AND public.lmc_recipe_uploads_enabled());

-- Generate identical policies only for our known lookup, recipe-link and
-- private-activity tables. Existing unrelated policies are never touched.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['categories', 'cuisines', 'dietary_pref', 'ingredients'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS lmc_lookup_read ON public.%I', table_name);
    EXECUTE format('CREATE POLICY lmc_lookup_read ON public.%I FOR SELECT TO anon, authenticated USING (true)', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['recipe_ingredients', 'recipe_categories', 'recipe_cuisines', 'recipe_dietary_pref'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS lmc_recipe_link_read ON public.%I', table_name);
    EXECUTE format('CREATE POLICY lmc_recipe_link_read ON public.%I FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.recipe r WHERE r.id = recipe_id))', table_name);
    EXECUTE format('DROP POLICY IF EXISTS lmc_recipe_link_write ON public.%I', table_name);
    EXECUTE format('CREATE POLICY lmc_recipe_link_write ON public.%I FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.recipe r WHERE r.id = recipe_id AND r.author_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.recipe r WHERE r.id = recipe_id AND r.author_id = (SELECT auth.uid())))', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['recipe_favourites', 'recipe_browsing_history', 'recipe_disliked'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS lmc_activity_read ON public.%I', table_name);
    EXECUTE format('CREATE POLICY lmc_activity_read ON public.%I FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()))', table_name);
    EXECUTE format('DROP POLICY IF EXISTS lmc_activity_insert ON public.%I', table_name);
    EXECUTE format('CREATE POLICY lmc_activity_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.recipe r WHERE r.id = recipe_id))', table_name);
    EXECUTE format('DROP POLICY IF EXISTS lmc_activity_update ON public.%I', table_name);
    EXECUTE format('CREATE POLICY lmc_activity_update ON public.%I FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.recipe r WHERE r.id = recipe_id))', table_name);
    EXECUTE format('DROP POLICY IF EXISTS lmc_activity_delete ON public.%I', table_name);
    EXECUTE format('CREATE POLICY lmc_activity_delete ON public.%I FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()))', table_name);
  END LOOP;
END;
$$;
DROP POLICY IF EXISTS lmc_ingredient_create ON public.ingredients;
CREATE POLICY lmc_ingredient_create ON public.ingredients FOR INSERT TO authenticated
WITH CHECK (length(trim(name)) BETWEEN 1 AND 200);
ALTER TABLE public.user_allergy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lmc_allergy_read ON public.user_allergy;
CREATE POLICY lmc_allergy_read ON public.user_allergy FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lmc_review_read ON public.reviews;
CREATE POLICY lmc_review_read ON public.reviews FOR SELECT TO anon, authenticated
USING (EXISTS (SELECT 1 FROM public.recipe r WHERE r.id = recipe_id));
DROP POLICY IF EXISTS lmc_review_write ON public.reviews;
CREATE POLICY lmc_review_write ON public.reviews FOR ALL TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.recipe r WHERE r.id = recipe_id));
ALTER TABLE public.review_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lmc_rating_read ON public.review_ratings;
CREATE POLICY lmc_rating_read ON public.review_ratings FOR SELECT TO anon, authenticated
USING (EXISTS (SELECT 1 FROM public.reviews r WHERE r.id = review_id));
DROP POLICY IF EXISTS lmc_rating_write ON public.review_ratings;
CREATE POLICY lmc_rating_write ON public.review_ratings FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.reviews r WHERE r.id = review_id AND r.user_id = (SELECT auth.uid())))
WITH CHECK (EXISTS (SELECT 1 FROM public.reviews r WHERE r.id = review_id AND r.user_id = (SELECT auth.uid())));

-- Public visitors can increment views only on a visible recipe, without broad
-- UPDATE permission on recipe. This function cannot mutate any other column.
CREATE OR REPLACE FUNCTION public.increment_view_count(recipe_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.recipe SET view_count = LEAST(view_count::bigint + 1, 2147483647)::integer
  WHERE id = recipe_id AND (is_public OR author_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.increment_view_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_view_count(uuid) TO anon, authenticated, service_role;

-- Images are uploaded under <auth UUID>/<timestamp>.<extension>.
-- Folder ownership supports both new uploads and the current upsert path.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('recipe-images', 'recipe-images', true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif']),
       ('user-profile-images', 'user-profile-images', true, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS lmc_image_read ON storage.objects;
CREATE POLICY lmc_image_read ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id IN ('recipe-images', 'user-profile-images'));
DROP POLICY IF EXISTS lmc_image_create ON storage.objects;
CREATE POLICY lmc_image_create ON storage.objects FOR INSERT TO authenticated
WITH CHECK ((bucket_id='user-profile-images' OR (bucket_id='recipe-images' AND public.lmc_recipe_uploads_enabled())) AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS lmc_image_update ON storage.objects;
CREATE POLICY lmc_image_update ON storage.objects FOR UPDATE TO authenticated
USING ((bucket_id='user-profile-images' OR (bucket_id='recipe-images' AND public.lmc_recipe_uploads_enabled())) AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
WITH CHECK ((bucket_id='user-profile-images' OR (bucket_id='recipe-images' AND public.lmc_recipe_uploads_enabled())) AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS lmc_image_delete ON storage.objects;
CREATE POLICY lmc_image_delete ON storage.objects FOR DELETE TO authenticated
USING ((bucket_id='user-profile-images' OR (bucket_id='recipe-images' AND public.lmc_recipe_uploads_enabled())) AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

-- Atomic recipe editor RPC (kept in sync with deploy/migrations/20261008_atomic_recipe_save.sql).
CREATE INDEX IF NOT EXISTS lmc_ingredient_normalized_name
  ON public.ingredients ((regexp_replace(lower(btrim(name)), '\s+', ' ', 'g')));

CREATE OR REPLACE FUNCTION public.save_recipe(payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller uuid := auth.uid();
  target uuid;
  owner_id uuid;
  ingredient_doc jsonb;
  ingredient_key text;
  ingredient_name text;
  ingredient_uuid uuid;
  ingredient_quantity text;
  ingredient_unit text;
  tag_key text;
  tag_table text;
  tag_column text;
  tag_ids uuid[];
  valid_count integer;
  servings_value numeric;
  time_value numeric;
  image_value text;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Sign in before saving a recipe' USING ERRCODE = '42501';
  END IF;
  IF NOT public.lmc_recipe_uploads_enabled() THEN
    RAISE EXCEPTION 'Recipe changes are disabled in public demo mode' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR NOT (payload ?& ARRAY[
      'title','description','directions','servings','time','is_public','ingredients',
      'dietaryPreferenceIds','cuisineIds','categoryIds']) THEN
    RAISE EXCEPTION 'Recipe fields and all relationship arrays are required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(payload) k WHERE k <> ALL(ARRAY[
      'recipe_id','title','description','directions','servings','time','is_public',
      'image_url','ingredients','dietaryPreferenceIds','cuisineIds','categoryIds'])) THEN
    RAISE EXCEPTION 'Unsupported recipe field' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(payload->'title') IS DISTINCT FROM 'string'
      OR length(btrim(payload->>'title')) NOT BETWEEN 1 AND 200
      OR jsonb_typeof(payload->'description') IS DISTINCT FROM 'string'
      OR length(payload->>'description') > 10000
      OR jsonb_typeof(payload->'directions') IS DISTINCT FROM 'string'
      OR length(btrim(payload->>'directions')) NOT BETWEEN 1 AND 40000
      OR jsonb_typeof(payload->'is_public') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(payload->'servings') IS DISTINCT FROM 'number'
      OR jsonb_typeof(payload->'time') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Invalid title, description, directions or numeric fields' USING ERRCODE = '22023';
  END IF;
  servings_value := (payload->>'servings')::numeric;
  time_value := (payload->>'time')::numeric;
  -- Zero denotes unknown in the existing data/UI; provided values are integers.
  IF servings_value NOT BETWEEN 0 AND 1000000 OR servings_value <> trunc(servings_value)
      OR time_value NOT BETWEEN 0 AND 525600 OR time_value <> trunc(time_value) THEN
    RAISE EXCEPTION 'Servings/time must be nonnegative integers within bounds' USING ERRCODE = '22023';
  END IF;
  IF payload ? 'image_url' AND jsonb_typeof(payload->'image_url') NOT IN ('string','null') THEN
    RAISE EXCEPTION 'Invalid image URL' USING ERRCODE = '22023';
  END IF;
  image_value := btrim(coalesce(payload->>'image_url',''));
  IF length(image_value) > 2048 OR (image_value <> '' AND
      image_value !~ '^https?://[^[:space:]]+$' AND image_value !~ '^/[^/[:space:]][^[:space:]]*$') THEN
    RAISE EXCEPTION 'Image URL must use HTTP(S) or a local absolute path' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(payload->'ingredients') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Ingredients must be an array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(payload->'ingredients') NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A recipe needs 1 to 200 ingredients' USING ERRCODE = '22023';
  END IF;
  FOREACH tag_key IN ARRAY ARRAY['dietaryPreferenceIds','cuisineIds','categoryIds'] LOOP
    IF jsonb_typeof(payload->tag_key) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION '% must be an array', tag_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(payload->tag_key) > 100 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(payload->tag_key) t WHERE jsonb_typeof(t) <> 'string') THEN
      RAISE EXCEPTION 'Invalid % UUID list', tag_key USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(array_agg(DISTINCT value::uuid),'{}'::uuid[]) INTO tag_ids
      FROM jsonb_array_elements_text(payload->tag_key);
    tag_table := CASE tag_key WHEN 'dietaryPreferenceIds' THEN 'dietary_pref'
      WHEN 'cuisineIds' THEN 'cuisines' ELSE 'categories' END;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE id = ANY($1)', tag_table)
      INTO valid_count USING tag_ids;
    IF valid_count <> cardinality(tag_ids) THEN
      RAISE EXCEPTION 'Unknown ID in %', tag_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF payload->>'recipe_id' IS NULL OR payload->>'recipe_id' = '' THEN
    target := gen_random_uuid();
    INSERT INTO public.recipe(id,author_id,title,description,directions,servings,time,is_public,image_url)
      VALUES(target,caller,btrim(payload->>'title'),payload->>'description',payload->>'directions',
        servings_value::real,time_value::integer,(payload->>'is_public')::boolean,image_value);
  ELSE
    target := (payload->>'recipe_id')::uuid;
    SELECT r.author_id INTO owner_id FROM public.recipe r WHERE r.id = target FOR UPDATE;
    IF NOT FOUND OR owner_id IS DISTINCT FROM caller THEN
      RAISE EXCEPTION 'Recipe is unavailable or belongs to another user' USING ERRCODE = '42501';
    END IF;
    UPDATE public.recipe SET title=btrim(payload->>'title'),description=payload->>'description',
      directions=payload->>'directions',servings=servings_value::real,time=time_value::integer,
      is_public=(payload->>'is_public')::boolean,image_url=image_value WHERE id=target;
  END IF;

  DELETE FROM public.recipe_ingredients WHERE recipe_id=target;
  FOR ingredient_doc IN SELECT value FROM jsonb_array_elements(payload->'ingredients') LOOP
    IF jsonb_typeof(ingredient_doc) IS DISTINCT FROM 'object'
        OR jsonb_typeof(ingredient_doc->'name') IS DISTINCT FROM 'string'
        OR jsonb_typeof(ingredient_doc->'quantity') IS NULL
        OR jsonb_typeof(ingredient_doc->'quantity') NOT IN ('string','number')
        OR (ingredient_doc ? 'unit' AND jsonb_typeof(ingredient_doc->'unit') NOT IN ('string','null'))
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(ingredient_doc) k
          WHERE k <> ALL(ARRAY['name','ingredient_id','quantity','unit'])) THEN
      RAISE EXCEPTION 'Invalid ingredient fields' USING ERRCODE = '22023';
    END IF;
    ingredient_name := regexp_replace(btrim(ingredient_doc->>'name'), '\s+', ' ', 'g');
    ingredient_key := lower(ingredient_name);
    ingredient_quantity := btrim(ingredient_doc->>'quantity');
    ingredient_unit := btrim(coalesce(ingredient_doc->>'unit',''));
    IF length(ingredient_name) NOT BETWEEN 1 AND 200 OR length(ingredient_unit) > 40
        OR length(ingredient_quantity) NOT BETWEEN 1 AND 30
        OR ingredient_quantity !~ '^[0-9]+([.][0-9]+)?$' THEN
      RAISE EXCEPTION 'Ingredient needs a name and a positive numeric quantity' USING ERRCODE = '22023';
    END IF;
    IF ingredient_quantity::numeric <= 0 OR ingredient_quantity::numeric > 1000000000 THEN
      RAISE EXCEPTION 'Ingredient quantity is outside bounds' USING ERRCODE = '22023';
    END IF;
    IF ingredient_doc->>'ingredient_id' IS NOT NULL AND ingredient_doc->>'ingredient_id' <> '' THEN
      ingredient_uuid := (ingredient_doc->>'ingredient_id')::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.ingredients i WHERE i.id=ingredient_uuid
          AND regexp_replace(lower(btrim(i.name)), '\s+', ' ', 'g')=ingredient_key) THEN
        RAISE EXCEPTION 'Ingredient ID does not match its name' USING ERRCODE = '22023';
      END IF;
    ELSE
      -- Serialize inserts for the normalized label, also under concurrent saves.
      PERFORM pg_advisory_xact_lock(hashtextextended('letmecook:ingredient:'||ingredient_key,0));
      SELECT i.id INTO ingredient_uuid FROM public.ingredients i
        WHERE regexp_replace(lower(btrim(i.name)), '\s+', ' ', 'g')=ingredient_key ORDER BY i.id LIMIT 1;
      IF NOT FOUND THEN
        ingredient_uuid := gen_random_uuid();
        INSERT INTO public.ingredients(id,name) VALUES(ingredient_uuid,ingredient_name);
      END IF;
    END IF;
    INSERT INTO public.recipe_ingredients(recipe_id,ingredient_id,quantity,unit)
      VALUES(target,ingredient_uuid,ingredient_quantity,ingredient_unit);
  END LOOP;

  FOREACH tag_key IN ARRAY ARRAY['dietaryPreferenceIds','cuisineIds','categoryIds'] LOOP
    SELECT coalesce(array_agg(DISTINCT value::uuid),'{}'::uuid[]) INTO tag_ids
      FROM jsonb_array_elements_text(payload->tag_key);
    tag_table := CASE tag_key WHEN 'dietaryPreferenceIds' THEN 'recipe_dietary_pref'
      WHEN 'cuisineIds' THEN 'recipe_cuisines' ELSE 'recipe_categories' END;
    tag_column := CASE tag_key WHEN 'dietaryPreferenceIds' THEN 'preference_id'
      WHEN 'cuisineIds' THEN 'cuisine_id' ELSE 'category_id' END;
    EXECUTE format('DELETE FROM public.%I WHERE recipe_id=$1',tag_table) USING target;
    EXECUTE format('INSERT INTO public.%I(recipe_id,%I) SELECT $1, unnest($2::uuid[])',tag_table,tag_column)
      USING target,tag_ids;
  END LOOP;
  RETURN target;
END;
$$;
REVOKE ALL ON FUNCTION public.save_recipe(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_recipe(jsonb) TO authenticated;
-- The RPC validates editable fields and preserves rank/provenance/ownership.
-- Deleting an owned recipe still uses its existing owner-only RLS policy.
REVOKE INSERT, UPDATE ON public.recipe FROM authenticated;
REVOKE INSERT ON public.ingredients FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.recipe_ingredients, public.recipe_categories,
  public.recipe_cuisines, public.recipe_dietary_pref FROM authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
