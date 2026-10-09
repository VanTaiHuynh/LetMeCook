-- Provision with supabase_admin after all migrations; runtime identities own no objects.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='letmecook_gateway') THEN
    CREATE ROLE letmecook_gateway NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='letmecook_worker') THEN
    CREATE ROLE letmecook_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE letmecook_gateway NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS CONNECTION LIMIT 12;
ALTER ROLE letmecook_worker NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20;
ALTER ROLE letmecook_worker SET statement_timeout='15s';
ALTER ROLE letmecook_worker SET lock_timeout='3s';
GRANT CONNECT ON DATABASE postgres TO letmecook_gateway,letmecook_worker;
GRANT USAGE ON SCHEMA public TO letmecook_gateway,letmecook_worker;
REVOKE CREATE ON SCHEMA public FROM letmecook_gateway,letmecook_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO letmecook_gateway;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['users','recipe','ingredients','categories','cuisines','dietary_pref',
    'recipe_ingredients','recipe_categories','recipe_cuisines','recipe_dietary_pref','recipe_favourites',
    'recipe_browsing_history','recipe_disliked','user_allergy','reviews','review_ratings',
    'weekly_meal_plans','kitchen_scopes','kitchen_members','kitchen_invites','kitchen_records',
    'kitchen_ledger','kitchen_consumption_receipts','kitchen_pantry_receipts','kitchen_consent',
    'kitchen_evidence_events','kitchen_cohort_enrollments','lmc_platform_settings','lmc_admin_audit',
    'lmc_contacts','lmc_newsletter','lmc_newsletter_tokens','lmc_newsletter_deliveries','lmc_ingredient_aliases',
    'kitchen_preference_sharing','kitchen_taste_feedback','kitchen_leftovers','kitchen_growth_receipts','kitchen_publications'] LOOP
    IF to_regclass('public.'||tab) IS NOT NULL THEN
      EXECUTE format('GRANT INSERT,UPDATE,DELETE ON public.%I TO letmecook_gateway',tab);
    END IF;
  END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO letmecook_gateway;
GRANT EXECUTE ON FUNCTION public.lmc_recipe_demo_visible(boolean,text,text,text) TO letmecook_gateway,letmecook_worker;

-- The worker cannot read user/profile/kitchen tables or change catalog rows.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM letmecook_worker;
GRANT SELECT ON public.recipe,public.recipe_ingredients,public.recipe_categories,
  public.recipe_cuisines,public.recipe_dietary_pref,public.ingredients,public.categories,
  public.cuisines,public.dietary_pref,public.lmc_platform_settings TO letmecook_worker;
DROP POLICY IF EXISTS lmc_worker_recipe_read ON public.recipe;
CREATE POLICY lmc_worker_recipe_read ON public.recipe FOR SELECT TO letmecook_worker USING (
  is_public AND public.lmc_recipe_demo_visible(demo_permission_confirmed,demo_permission_note,image_kind,image_url)
);
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['recipe_ingredients','recipe_categories','recipe_cuisines','recipe_dietary_pref'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS lmc_worker_catalog_link ON public.%I',tab);
    EXECUTE format('CREATE POLICY lmc_worker_catalog_link ON public.%I FOR SELECT TO letmecook_worker USING (EXISTS (SELECT 1 FROM public.recipe r WHERE r.id=recipe_id))',tab);
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['ingredients','categories','cuisines','dietary_pref','lmc_platform_settings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS lmc_worker_dictionary_read ON public.%I',tab);
    EXECUTE format('CREATE POLICY lmc_worker_dictionary_read ON public.%I FOR SELECT TO letmecook_worker USING (true)',tab);
  END LOOP;
END $$;
COMMIT;
