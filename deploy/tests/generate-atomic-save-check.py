#!/usr/bin/env python3
"""Build a PostgreSQL integration check that ALWAYS ends with ROLLBACK.

Includes the current migration inside the same transaction, so neither test
users/recipes nor new function/grants are persisted. Run using psql -X -v
ON_ERROR_STOP=1, preferably against a development database without concurrent
schema deployment. This generator itself performs no database operations.
"""
import argparse
from pathlib import Path

FIXTURE = r"""
CREATE TEMP TABLE lmc_rpc_fixture(owner_id uuid,other_id uuid,recipe_id uuid,other_recipe_id uuid,tag_id uuid);
INSERT INTO lmc_rpc_fixture SELECT gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();
GRANT SELECT ON lmc_rpc_fixture TO authenticated,anon;
INSERT INTO auth.users(id,email,raw_user_meta_data)
SELECT owner_id,owner_id::text||'@atomic-save-test.invalid','{}'::jsonb FROM lmc_rpc_fixture
UNION ALL SELECT other_id,other_id::text||'@atomic-save-test.invalid','{}'::jsonb FROM lmc_rpc_fixture;
INSERT INTO public.dietary_pref(id,name) SELECT tag_id,'RPC temporary diet '||tag_id FROM lmc_rpc_fixture;
INSERT INTO public.recipe(id,author_id,title,directions,is_public,view_count,source_url,source_license)
SELECT recipe_id,owner_id,'Prior title','Prior instruction',false,7,'https://fixture.invalid/'||recipe_id,'Fixture provenance'
FROM lmc_rpc_fixture
UNION ALL SELECT other_recipe_id,other_id,'Other user title','Keep untouched',false,0,NULL,NULL FROM lmc_rpc_fixture;
SELECT set_config('request.jwt.claim.sub',owner_id::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true) FROM lmc_rpc_fixture;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record; payload jsonb; saved uuid; rejected boolean; ingredient_count integer;
BEGIN
  SELECT * INTO f FROM lmc_rpc_fixture;
  payload := jsonb_build_object('recipe_id',f.recipe_id,'title','Updated title',
    'description','Plain text with <angle brackets>','directions','Mix ingredients and cook.',
    'servings',2,'time',30,'is_public',false,'image_url','',
    'ingredients',jsonb_build_array(jsonb_build_object('name','RPC ingredient '||f.recipe_id,'quantity',0.5,'unit','cup')),
    'dietaryPreferenceIds',jsonb_build_array(f.tag_id),'cuisineIds','[]'::jsonb,'categoryIds','[]'::jsonb);
  saved := public.save_recipe(payload);
  IF saved<>f.recipe_id OR NOT EXISTS(SELECT 1 FROM public.recipe WHERE id=saved AND title='Updated title'
      AND view_count=7 AND source_license='Fixture provenance' AND author_id=f.owner_id) THEN
    RAISE EXCEPTION 'Owned update/protected metadata check failed';
  END IF;
  SELECT count(*) INTO ingredient_count FROM public.recipe_ingredients WHERE recipe_id=saved;
  rejected:=false;
  BEGIN
    PERFORM public.save_recipe(payload||jsonb_build_object('title','Must roll back',
      'ingredients',jsonb_build_array(jsonb_build_object('name','bad quantity','quantity','invalid','unit',''))));
  EXCEPTION WHEN SQLSTATE '22023' THEN rejected:=true;
  END;
  IF NOT rejected OR NOT EXISTS(SELECT 1 FROM public.recipe WHERE id=saved AND title='Updated title')
      OR (SELECT count(*) FROM public.recipe_ingredients WHERE recipe_id=saved)<>ingredient_count
      OR (SELECT count(*) FROM public.recipe_dietary_pref WHERE recipe_id=saved)<>1 THEN
    RAISE EXCEPTION 'Failed ingredient save was not atomic';
  END IF;
  rejected:=false;
  BEGIN
    PERFORM public.save_recipe(payload||jsonb_build_object('recipe_id',f.other_recipe_id));
  EXCEPTION WHEN SQLSTATE '42501' THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Another owner was allowed'; END IF;
  rejected:=false;
  BEGIN
    PERFORM public.save_recipe(payload||'{"view_count":999}'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Protected field was accepted'; END IF;
  rejected:=false;
  BEGIN
    PERFORM public.save_recipe(payload||jsonb_build_object('categoryIds',jsonb_build_array(gen_random_uuid())));
  EXCEPTION WHEN SQLSTATE '22023' THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Unknown tag was accepted'; END IF;
  PERFORM public.save_recipe(payload||'{"dietaryPreferenceIds":[],"cuisineIds":[],"categoryIds":[]}'::jsonb);
  IF EXISTS(SELECT 1 FROM public.recipe_dietary_pref WHERE recipe_id=saved)
      OR EXISTS(SELECT 1 FROM public.recipe_cuisines WHERE recipe_id=saved)
      OR EXISTS(SELECT 1 FROM public.recipe_categories WHERE recipe_id=saved) THEN
    RAISE EXCEPTION 'Empty arrays failed to clear old tags';
  END IF;
  saved:=public.save_recipe(payload||'{"recipe_id":null}'::jsonb);
  IF NOT EXISTS(SELECT 1 FROM public.recipe WHERE id=saved AND author_id=f.owner_id AND view_count=0
      AND source_url IS NULL) THEN RAISE EXCEPTION 'Creation/protected defaults failed'; END IF;
  IF has_table_privilege('authenticated','public.recipe','INSERT')
      OR has_table_privilege('authenticated','public.recipe','UPDATE')
      OR has_table_privilege('authenticated','public.recipe_ingredients','INSERT') THEN
    RAISE EXCEPTION 'Direct-write bypass remains granted';
  END IF;
END;
$$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE anon;
DO $$
DECLARE rejected boolean:=false;
BEGIN
  IF EXISTS(SELECT 1 FROM public.recipe WHERE id IN (
      SELECT recipe_id FROM lmc_rpc_fixture UNION SELECT other_recipe_id FROM lmc_rpc_fixture)) THEN
    RAISE EXCEPTION 'Anonymous visitor can see private fixture recipes';
  END IF;
  BEGIN
    PERFORM public.save_recipe('{}'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Anonymous visitor can invoke save RPC'; END IF;
END;
$$;
RESET ROLE;
SELECT 'PASS: owner/create/edit, rollback on invalid ingredients, protected metadata, empty joins, unknown tags, grants and anonymous isolation' AS result;
ROLLBACK;
"""

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--sql-output',required=True,type=Path)
args=parser.parse_args()
migration=(Path(__file__).resolve().parents[1]/'migrations/20261008_atomic_recipe_save.sql').read_text()
body=migration.split('BEGIN;',1)[1].rsplit('COMMIT;',1)[0]
args.sql_output.parent.mkdir(parents=True,exist_ok=True)
args.sql_output.write_text('-- Integration-only; no persistent changes.\nBEGIN;\n'+body+FIXTURE)
print(args.sql_output.resolve())
