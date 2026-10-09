-- Execute after the rating migration. Fixtures are rolled back, never left as product activity.
BEGIN;
DO $$
DECLARE actor uuid:=gen_random_uuid(); first_recipe uuid:=gen_random_uuid(); second_recipe uuid:=gen_random_uuid();
        a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,'rating-test-'||actor||'@example.invalid');
  INSERT INTO public.users(id) VALUES(actor) ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.recipe(id,title,is_public) VALUES(first_recipe,'Rating transaction fixture',true),(second_recipe,'Moved review fixture',true);
  INSERT INTO public.reviews(id,recipe_id,user_id) VALUES(a,first_recipe,actor),(b,first_recipe,actor),(c,first_recipe,actor);
  INSERT INTO public.review_ratings(review_id,category,value) VALUES(a,'overall',5),(b,'overall',3),(c,'cost',1),(c,'time',1),(c,'difficulty',1);
  IF NOT EXISTS(SELECT 1 FROM public.recipe WHERE id=first_recipe AND rating_average=4 AND rating_count=2) THEN RAISE EXCEPTION 'Overall aggregate must exclude other categories'; END IF;
  UPDATE public.review_ratings SET value=1 WHERE review_id=a AND category='overall';
  IF NOT EXISTS(SELECT 1 FROM public.recipe WHERE id=first_recipe AND rating_average=2 AND rating_count=2) THEN RAISE EXCEPTION 'Rating update must refresh aggregate'; END IF;
  DELETE FROM public.review_ratings WHERE review_id=a AND category='overall';
  IF NOT EXISTS(SELECT 1 FROM public.recipe WHERE id=first_recipe AND rating_average=3 AND rating_count=1) THEN RAISE EXCEPTION 'Rating deletion must refresh aggregate'; END IF;
  UPDATE public.reviews SET recipe_id=second_recipe WHERE id=b;
  IF NOT EXISTS(SELECT 1 FROM public.recipe WHERE id=first_recipe AND rating_average=0 AND rating_count=0) OR
     NOT EXISTS(SELECT 1 FROM public.recipe WHERE id=second_recipe AND rating_average=3 AND rating_count=1) THEN RAISE EXCEPTION 'Moved review must refresh both recipes'; END IF;
  DELETE FROM public.reviews WHERE id=b;
  IF NOT EXISTS(SELECT 1 FROM public.recipe WHERE id=second_recipe AND rating_average=0 AND rating_count=0) THEN RAISE EXCEPTION 'Cascade deletion must clear aggregate'; END IF;
END $$;
ROLLBACK;
