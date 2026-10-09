BEGIN;
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS rating_average double precision NOT NULL DEFAULT 0;
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS lmc_recipe_public_rating ON public.recipe(rating_average DESC,id) WHERE is_public;

-- Only explicitly submitted overall ratings count. Cost/time/difficulty are not substitutes.
CREATE OR REPLACE FUNCTION public.lmc_refresh_recipe_rating(target uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  -- Serialize aggregate updates for the same recipe; each following query sees committed changes.
  -- Compatible with KEY SHARE from concurrent review foreign-key checks.
  PERFORM 1 FROM public.recipe WHERE id=target FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.recipe SET rating_average=totals.average, rating_count=totals.count
  FROM (SELECT coalesce(avg(v.value),0)::double precision AS average,count(v.id)::integer AS count
        FROM public.reviews r JOIN public.review_ratings v ON v.review_id=r.id
        WHERE r.recipe_id=target AND v.category='overall') totals WHERE id=target;
END $$;
REVOKE ALL ON FUNCTION public.lmc_refresh_recipe_rating(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.lmc_rating_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_recipe uuid; new_recipe uuid; target uuid;
BEGIN
  IF TG_OP<>'INSERT' AND OLD.category='overall' THEN
    SELECT recipe_id INTO old_recipe FROM public.reviews WHERE id=OLD.review_id;
  END IF;
  IF TG_OP<>'DELETE' AND NEW.category='overall' THEN
    SELECT recipe_id INTO new_recipe FROM public.reviews WHERE id=NEW.review_id;
  END IF;
  FOR target IN SELECT DISTINCT x FROM unnest(ARRAY[old_recipe,new_recipe]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM public.lmc_refresh_recipe_rating(target);
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.lmc_rating_changed() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS lmc_rating_aggregate ON public.review_ratings;
CREATE TRIGGER lmc_rating_aggregate AFTER INSERT OR UPDATE OR DELETE ON public.review_ratings
FOR EACH ROW EXECUTE FUNCTION public.lmc_rating_changed();

CREATE OR REPLACE FUNCTION public.lmc_review_rating_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM public.lmc_refresh_recipe_rating(OLD.recipe_id);
  ELSIF OLD.recipe_id IS DISTINCT FROM NEW.recipe_id THEN
    FOR target IN SELECT DISTINCT x FROM unnest(ARRAY[OLD.recipe_id,NEW.recipe_id]) x ORDER BY x LOOP
      PERFORM public.lmc_refresh_recipe_rating(target);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.lmc_review_rating_changed() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS lmc_review_rating_aggregate ON public.reviews;
CREATE TRIGGER lmc_review_rating_aggregate AFTER UPDATE OF recipe_id OR DELETE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.lmc_review_rating_changed();

UPDATE public.recipe r SET rating_average=totals.average,rating_count=totals.count
FROM (SELECT r.id,coalesce(avg(v.value),0)::double precision AS average,count(v.id)::integer AS count
      FROM public.recipe r LEFT JOIN public.reviews review ON review.recipe_id=r.id
      LEFT JOIN public.review_ratings v ON v.review_id=review.id AND v.category='overall'
      GROUP BY r.id) totals WHERE r.id=totals.id;
COMMIT;
