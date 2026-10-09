#!/usr/bin/env python3
"""Consistent local database snapshot plus original images, uploads and runtime key.

The protected backup contains credentials and private user data; no sensitive
values are printed. Does not change the application database.
"""
import datetime, hashlib, json, os, shutil, subprocess, sys, tarfile
from pathlib import Path
os.umask(0o077)
project=Path(__file__).resolve().parents[1]
root=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else project.parent/'backups'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
root.mkdir(parents=True,exist_ok=False); root.chmod(0o700)
base=['docker','exec','-i','supabase_db_letmecook']
relations=['public.recipe','auth.users','public.users','public.weekly_meal_plans','public.kitchen_records','public.kitchen_ledger','public.lmc_contacts','storage.objects','public.kitchen_cohort_enrollments']
# Optional additive releases: include each existing private feature table in the
# same repeatable-read snapshot, while retaining compatibility with older backups.
optional_relations=['public.kitchen_preference_sharing','public.kitchen_taste_feedback','public.kitchen_leftovers','public.kitchen_growth_receipts','public.kitchen_publications']
for relation in optional_relations:
 if subprocess.check_output(base+['psql','-U','postgres','-d','postgres','-XAt','-c',"SELECT to_regclass('"+relation+"') IS NOT NULL"],text=True).strip()=='t':relations.append(relation)
connection=subprocess.Popen(base+['psql','-U','postgres','-d','postgres','-XqAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
try:
 connection.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n")
 pairs=','.join("'"+name+"',(SELECT count(*) FROM "+name+")" for name in relations)
 connection.stdin.write('SELECT json_build_object('+pairs+')::text;\n'); connection.stdin.flush()
 snapshot=connection.stdout.readline().strip(); counts=json.loads(connection.stdout.readline())
 if not snapshot or not all(isinstance(value,int) for value in counts.values()): raise RuntimeError('Invalid backup snapshot metadata')
 with (root/'application.dump').open('wb') as output:
  subprocess.run(base+['pg_dump','-U','postgres','-d','postgres','-Fc','--schema=public','--schema=auth','--schema=storage','--snapshot='+snapshot],stdout=output,check=True)
 connection.stdin.write('ROLLBACK;\n\\q\n');connection.stdin.flush();connection.communicate(timeout=10)
 if connection.returncode: raise RuntimeError('Snapshot session failed')
 with tarfile.open(root/'recipe-images.tar.gz','w:gz') as archive: archive.add(project/'client/public/recipe-images',arcname='recipe-images')
 with (root/'storage-uploads.tar.gz').open('wb') as output:
  subprocess.run(['docker','exec','supabase_storage_letmecook','tar','-C','/mnt','-czf','-','.'],stdout=output,check=True)
 source_paths=['README.md','.github','client/src','client/public','client/index.html','client/package.json','client/package-lock.json','client/vite.config.js','client/eslint.config.js','client/vitest.config.js','client/tests','client/.env.example','server/src','server/pom.xml','RecommendationSystem/src','RecommendationSystem/tests','RecommendationSystem/evaluation','RecommendationSystem/.gitignore','RecommendationSystem/app.py','RecommendationSystem/requirements.txt','RecommendationSystem/requirements.lock','RecommendationSystem/run_gunicorn.sh','RecommendationSystem/gunicorn.conf.py','RecommendationSystem/README-cache-generation.txt','deploy','docs/product']
 def source_filter(member):
  parts=Path(member.name).parts
  if any(part in {'.git','node_modules','__pycache__','recipe-images','target','dist','.env.local','.env.roles'} for part in parts):return None
  if member.issym() or member.islnk():return None
  return member
 with tarfile.open(root/'source-release.tar.gz','w:gz') as archive:
  for relative in source_paths:
   path=project/relative
   if path.exists():archive.add(path,arcname='LetMeCook/'+relative,filter=source_filter)
 shutil.copy2(project/'deploy/.env.local',root/'runtime.env'); (root/'runtime.env').chmod(0o600)
 metadata={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'counts':counts,'private':True,'runtimeDatabaseRoles':['letmecook_gateway','letmecook_worker'],'includes':['public/auth/storage database with ACLs','original recipe images','Supabase uploaded object bytes','runtime environment and persistent planner signing key','rebuildable source, dependencies, migrations and release documentation']}
 (root/'manifest.json').write_text(json.dumps(metadata,indent=2)+'\n')
 files=['application.dump','recipe-images.tar.gz','storage-uploads.tar.gz','runtime.env','manifest.json','source-release.tar.gz']
 def digest(path):
  value=hashlib.sha256()
  with path.open('rb') as handle:
   for block in iter(lambda:handle.read(1024*1024),b''):value.update(block)
  return value.hexdigest()
 (root/'SHA256SUMS').write_text(''.join(digest(root/name)+'  '+name+'\n' for name in files))
 print('Protected local backup created at '+str(root))
except Exception:
 connection.kill();connection.communicate();raise
