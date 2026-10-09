-- Small, original synthetic demo dataset for an otherwise empty local DB.
-- These are newly written examples, not copies of the hosted project's data.
-- No accounts or passwords are seeded. Demo recipes have no author account.
BEGIN;

DO $$
DECLARE
  recipe_a uuid := '10000000-0000-4000-8000-000000000001';
  recipe_b uuid := '10000000-0000-4000-8000-000000000002';
  recipe_c uuid := '10000000-0000-4000-8000-000000000003';
  recipe_d uuid := '10000000-0000-4000-8000-000000000004';
BEGIN
  -- If real recipes already exist, preserve them and leave the DB untouched.
  IF EXISTS (SELECT 1 FROM public.recipe LIMIT 1) THEN RETURN; END IF;

  INSERT INTO public.categories(id, name) VALUES
    ('20000000-0000-4000-8000-000000000001', 'dinner'),
    ('20000000-0000-4000-8000-000000000002', 'lunch'),
    ('20000000-0000-4000-8000-000000000003', 'breakfast')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.cuisines(id, name) VALUES
    ('30000000-0000-4000-8000-000000000001', 'international'),
    ('30000000-0000-4000-8000-000000000002', 'asian'),
    ('30000000-0000-4000-8000-000000000003', 'mediterranean')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.dietary_pref(id, name) VALUES
    ('40000000-0000-4000-8000-000000000001', 'vegan'),
    ('40000000-0000-4000-8000-000000000002', 'vegetarian'),
    ('40000000-0000-4000-8000-000000000003', 'gluten free'),
    ('40000000-0000-4000-8000-000000000004', 'dairy free')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.ingredients(id, name) VALUES
    ('50000000-0000-4000-8000-000000000001', 'rice'),
    ('50000000-0000-4000-8000-000000000002', 'carrot'),
    ('50000000-0000-4000-8000-000000000003', 'peas'),
    ('50000000-0000-4000-8000-000000000004', 'olive oil'),
    ('50000000-0000-4000-8000-000000000005', 'chickpeas'),
    ('50000000-0000-4000-8000-000000000006', 'tomato'),
    ('50000000-0000-4000-8000-000000000007', 'cucumber'),
    ('50000000-0000-4000-8000-000000000008', 'lemon'),
    ('50000000-0000-4000-8000-000000000009', 'pasta'),
    ('50000000-0000-4000-8000-000000000010', 'garlic'),
    ('50000000-0000-4000-8000-000000000011', 'egg'),
    ('50000000-0000-4000-8000-000000000012', 'spinach')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.recipe(id,title,description,servings,image_url,is_public,directions,time) VALUES
    (recipe_a, 'Demo: Vegetable Rice Skillet',
     '<p>Synthetic local demo recipe. A simple skillet of rice, carrots and peas.</p>', 2,
     '/assets/pexels-janetrangdoan-769969.jpg', true,
     '<li>Cook the rice according to its packet directions.</li><li>Dice the carrot and soften it in olive oil in a skillet.</li><li>Add peas and a splash of water; cook until the vegetables are tender.</li><li>Stir in the cooked rice and heat through.</li>', 25),
    (recipe_b, 'Demo: Lemon Chickpea Salad',
     '<p>Synthetic local demo recipe. A fresh chickpea salad with cucumber, tomato and lemon.</p>', 2,
     '/assets/pexels-anh-nguyen-517648218-30767530.jpg', true,
     '<li>Drain and rinse the chickpeas.</li><li>Dice the cucumber and tomato.</li><li>Whisk lemon juice with olive oil.</li><li>Toss everything together and serve.</li>', 15),
    (recipe_c, 'Demo: Tomato Garlic Pasta',
     '<p>Synthetic local demo recipe. Tomato and garlic make a quick sauce for pasta.</p>', 2,
     '/assets/pexels-nerfee-mirandilla-1656989-3186654.jpg', true,
     '<li>Cook pasta in boiling water according to the packet directions.</li><li>Warm olive oil and gently cook minced garlic for one minute.</li><li>Add diced tomato and simmer until softened.</li><li>Toss the drained pasta with the sauce.</li>', 20),
    (recipe_d, 'Demo: Spinach Breakfast Eggs',
     '<p>Synthetic local demo recipe. Soft scrambled eggs with wilted spinach.</p>', 2,
     '/assets/pexels-delphine-hourlay-91322-691159.jpg', true,
     '<li>Wash and drain the spinach.</li><li>Warm olive oil in a skillet and wilt the spinach.</li><li>Beat the eggs, pour them into the skillet, and stir gently.</li><li>Cook until the eggs are set, then serve.</li>', 10);

  INSERT INTO public.recipe_categories(recipe_id, category_id) VALUES
    (recipe_a,'20000000-0000-4000-8000-000000000001'),
    (recipe_b,'20000000-0000-4000-8000-000000000002'),
    (recipe_c,'20000000-0000-4000-8000-000000000001'),
    (recipe_d,'20000000-0000-4000-8000-000000000003');
  INSERT INTO public.recipe_cuisines(recipe_id, cuisine_id) VALUES
    (recipe_a,'30000000-0000-4000-8000-000000000002'),
    (recipe_b,'30000000-0000-4000-8000-000000000003'),
    (recipe_c,'30000000-0000-4000-8000-000000000003'),
    (recipe_d,'30000000-0000-4000-8000-000000000001');
  INSERT INTO public.recipe_dietary_pref(recipe_id, preference_id) VALUES
    (recipe_a,'40000000-0000-4000-8000-000000000001'),
    (recipe_a,'40000000-0000-4000-8000-000000000003'),
    (recipe_b,'40000000-0000-4000-8000-000000000001'),
    (recipe_b,'40000000-0000-4000-8000-000000000003'),
    (recipe_c,'40000000-0000-4000-8000-000000000001'),
    (recipe_d,'40000000-0000-4000-8000-000000000002'),
    (recipe_d,'40000000-0000-4000-8000-000000000003');
  INSERT INTO public.recipe_ingredients(recipe_id,ingredient_id,quantity,unit) VALUES
    (recipe_a,'50000000-0000-4000-8000-000000000001','1','cup'),
    (recipe_a,'50000000-0000-4000-8000-000000000002','1','qty'),
    (recipe_a,'50000000-0000-4000-8000-000000000003','1/2','cup'),
    (recipe_a,'50000000-0000-4000-8000-000000000004','1','Tbsps'),
    (recipe_b,'50000000-0000-4000-8000-000000000005','1','can'),
    (recipe_b,'50000000-0000-4000-8000-000000000006','2','qty'),
    (recipe_b,'50000000-0000-4000-8000-000000000007','1','qty'),
    (recipe_b,'50000000-0000-4000-8000-000000000008','1','qty'),
    (recipe_b,'50000000-0000-4000-8000-000000000004','1','Tbsps'),
    (recipe_c,'50000000-0000-4000-8000-000000000009','200','grams'),
    (recipe_c,'50000000-0000-4000-8000-000000000006','3','qty'),
    (recipe_c,'50000000-0000-4000-8000-000000000010','2','cloves'),
    (recipe_c,'50000000-0000-4000-8000-000000000004','1','Tbsps'),
    (recipe_d,'50000000-0000-4000-8000-000000000011','4','qty'),
    (recipe_d,'50000000-0000-4000-8000-000000000012','2','cup'),
    (recipe_d,'50000000-0000-4000-8000-000000000004','1','Tbsps');
END;
$$;

COMMIT;
