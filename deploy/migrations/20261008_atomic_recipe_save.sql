-- Authenticated recipe creation/editing is one transaction. This migration
-- never alters imported content and may be reapplied without resetting data.
BEGIN;
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
