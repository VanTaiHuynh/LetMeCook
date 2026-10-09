-- Upgrade already installed rating triggers without recomputing or editing recipe rows.
BEGIN;
CREATE OR REPLACE FUNCTION public.lmc_refresh_recipe_rating(target uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  -- FK checks on concurrent review inserts hold KEY SHARE; keep those compatible.
  PERFORM 1 FROM public.recipe WHERE id=target FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.recipe SET rating_average=totals.average,rating_count=totals.count
  FROM (SELECT coalesce(avg(v.value),0)::double precision AS average,count(v.id)::integer AS count
        FROM public.reviews r JOIN public.review_ratings v ON v.review_id=r.id
        WHERE r.recipe_id=target AND v.category='overall') totals WHERE id=target;
END $$;
REVOKE ALL ON FUNCTION public.lmc_refresh_recipe_rating(uuid) FROM PUBLIC,anon,authenticated;
COMMIT;
