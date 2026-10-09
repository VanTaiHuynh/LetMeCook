-- Apply after platform operations. Public-demo approval is a recorded declaration,
-- never an assertion that third-party content has independently verified rights.
BEGIN;
CREATE OR REPLACE FUNCTION public.lmc_recipe_demo_visible(approved boolean,permission_note text,photo_kind text,photo_url text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT NOT coalesce((SELECT settings->>'publicDemo'='true' FROM public.lmc_platform_settings WHERE id=true),true)
    OR (approved IS TRUE AND length(btrim(coalesce(permission_note,'')))>0 AND photo_kind='source' AND photo_url LIKE '/recipe-images/%')
$$;
REVOKE ALL ON FUNCTION public.lmc_recipe_demo_visible(boolean,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lmc_recipe_demo_visible(boolean,text,text,text) TO anon,authenticated,service_role;
DROP POLICY IF EXISTS lmc_recipe_read ON public.recipe;
CREATE POLICY lmc_recipe_read ON public.recipe FOR SELECT TO anon,authenticated USING(
  author_id=(SELECT auth.uid()) OR (is_public AND
  public.lmc_recipe_demo_visible(demo_permission_confirmed,demo_permission_note,image_kind,image_url))
);
CREATE OR REPLACE FUNCTION public.increment_view_count(recipe_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  UPDATE public.recipe SET view_count=LEAST(view_count::bigint+1,2147483647)::integer
  WHERE id=recipe_id AND (author_id=auth.uid() OR (is_public
    AND public.lmc_recipe_demo_visible(demo_permission_confirmed,demo_permission_note,image_kind,image_url)));
$$;
REVOKE ALL ON FUNCTION public.increment_view_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_view_count(uuid) TO anon,authenticated,service_role;

-- Keep author edits on the atomic, whitelisted save_recipe RPC. A direct INSERT
-- could otherwise forge newly added rating/permission columns as well as UPDATE.
REVOKE INSERT,UPDATE ON public.recipe FROM authenticated,anon;
DO $$ DECLARE columns text; BEGIN
  SELECT string_agg(quote_ident(column_name),',') INTO columns FROM information_schema.columns
    WHERE table_schema='public' AND table_name='recipe';
  EXECUTE 'REVOKE INSERT ('||columns||'), UPDATE ('||columns||') ON public.recipe FROM authenticated,anon';
END $$;

-- Permission declarations bind the reviewed content, not only a permanent UUID.
CREATE OR REPLACE FUNCTION public.lmc_invalidate_recipe_demo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  NEW.demo_permission_confirmed := false;
  NEW.demo_permission_note := NULL;
  NEW.demo_reviewed_at := NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.lmc_invalidate_recipe_demo() FROM PUBLIC;
DROP TRIGGER IF EXISTS lmc_recipe_demo_content_changed ON public.recipe;
CREATE TRIGGER lmc_recipe_demo_content_changed BEFORE UPDATE OF title,description,directions,servings,time,image_url,is_public
ON public.recipe FOR EACH ROW WHEN (
  OLD.title IS DISTINCT FROM NEW.title OR OLD.description IS DISTINCT FROM NEW.description OR
  OLD.directions IS DISTINCT FROM NEW.directions OR OLD.servings IS DISTINCT FROM NEW.servings OR
  OLD.time IS DISTINCT FROM NEW.time OR OLD.image_url IS DISTINCT FROM NEW.image_url OR OLD.is_public IS DISTINCT FROM NEW.is_public
) EXECUTE FUNCTION public.lmc_invalidate_recipe_demo();
CREATE OR REPLACE FUNCTION public.lmc_invalidate_recipe_demo_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' THEN target:=OLD.recipe_id; ELSE target:=NEW.recipe_id; END IF;
  UPDATE public.recipe SET demo_permission_confirmed=false,demo_permission_note=NULL,demo_reviewed_at=NULL WHERE id=target;
  IF TG_OP='UPDATE' AND OLD.recipe_id IS DISTINCT FROM NEW.recipe_id THEN
    UPDATE public.recipe SET demo_permission_confirmed=false,demo_permission_note=NULL,demo_reviewed_at=NULL WHERE id=OLD.recipe_id;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.lmc_invalidate_recipe_demo_link() FROM PUBLIC;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['recipe_ingredients','recipe_dietary_pref','recipe_cuisines','recipe_categories'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS lmc_recipe_demo_link_changed ON public.%I',tab);
    EXECUTE format('CREATE TRIGGER lmc_recipe_demo_link_changed AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.lmc_invalidate_recipe_demo_link()',tab);
  END LOOP;
END $$;

-- Existing stable stored image URLs are preserved. The browser obtains signed
-- object URLs after this SELECT policy; profile photos retain their existing policy.
UPDATE storage.buckets SET public=false WHERE id='recipe-images';
DROP POLICY IF EXISTS lmc_image_read ON storage.objects;
CREATE POLICY lmc_image_read ON storage.objects FOR SELECT TO anon,authenticated USING(
  bucket_id='user-profile-images' OR
  (bucket_id='recipe-images' AND (
    (storage.foldername(name))[1]=(SELECT auth.uid())::text OR
    EXISTS(SELECT 1 FROM public.recipe r WHERE r.is_public AND
      right(r.image_url,length('/recipe-images/'||storage.objects.name))='/recipe-images/'||storage.objects.name)
  ))
);
NOTIFY pgrst,'reload schema';
COMMIT;
