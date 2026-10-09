#!/usr/bin/env python3
"""Verify a backup into an isolated temporary DB/directory, never the live DB."""
import hashlib,json,os,subprocess,sys,tarfile,tempfile,uuid
from pathlib import Path
os.umask(0o077)
root=Path(sys.argv[1]).resolve()
for line in (root/'SHA256SUMS').read_text().splitlines():
 expected,name=line.split('  ',1)
 if '/' in name or name.startswith('.'):raise ValueError('Unsafe checksum entry')
 value=hashlib.sha256()
 with (root/name).open('rb') as handle:
  for block in iter(lambda:handle.read(1024*1024),b''):value.update(block)
 if value.hexdigest()!=expected:raise ValueError('Backup checksum mismatch: '+name)
metadata=json.loads((root/'manifest.json').read_text()); database='lmc_restore_'+uuid.uuid4().hex
base=['docker','exec','-i','supabase_db_letmecook','sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" exec "$@"','lmc-restore']
def sql(query):
 return subprocess.check_output(base+['psql','-U','supabase_admin','-d',database,'-XAt','-v','ON_ERROR_STOP=1','-c',query],text=True).strip()
try:
 subprocess.run(base+['createdb','-U','postgres',database],check=True)
 sql('DROP SCHEMA public CASCADE; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;')
 with (root/'application.dump').open('rb') as source:subprocess.run(base+['pg_restore','-U','supabase_admin','-d',database,'--no-owner','--exit-on-error'],stdin=source,check=True)
 for relation,expected in metadata['counts'].items():
  if relation not in ['public.recipe','auth.users','public.users','public.weekly_meal_plans','public.kitchen_records','public.kitchen_ledger','public.lmc_contacts','storage.objects','public.kitchen_cohort_enrollments','public.kitchen_preference_sharing','public.kitchen_taste_feedback','public.kitchen_leftovers','public.kitchen_growth_receipts','public.kitchen_publications']:raise ValueError('Unknown manifest table')
  if int(sql('SELECT count(*) FROM '+relation))!=expected:raise ValueError('Snapshot count mismatch: '+relation)
  print(relation+': snapshot count restored')
 if sql("SELECT relrowsecurity FROM pg_class WHERE oid='public.kitchen_records'::regclass")!='t':raise ValueError('Kitchen RLS was not restored')
 if sql("SELECT has_table_privilege('authenticated','public.kitchen_records','INSERT')")!='f':raise ValueError('Gateway-only write ACL was not restored')
 if sql("SELECT has_table_privilege('authenticated','public.kitchen_records','SELECT')")!='t':raise ValueError('Member read ACL was not restored')
 if metadata.get('runtimeDatabaseRoles'):
  if metadata['runtimeDatabaseRoles']!=['letmecook_gateway','letmecook_worker']:raise ValueError('Unknown runtime role manifest')
  if sql("SELECT has_table_privilege('letmecook_worker','public.users','SELECT')")!='f':raise ValueError('Worker profile restriction was not restored')
  if sql("SELECT has_table_privilege('letmecook_worker','public.recipe','UPDATE')")!='f':raise ValueError('Worker catalog write restriction was not restored')
  if sql("SELECT relrowsecurity FROM pg_class WHERE oid='public.recipe'::regclass")!='t':raise ValueError('Catalog RLS was not restored')
  if sql("SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='recipe' AND policyname='lmc_worker_recipe_read'")!='1':raise ValueError('Worker catalog policy was not restored')
  if sql("SELECT has_function_privilege('letmecook_worker','public.increment_view_count(uuid)','EXECUTE')")!='f':raise ValueError('Worker mutation function restriction was not restored')
  for relation in ['public.kitchen_preference_sharing','public.kitchen_taste_feedback','public.kitchen_leftovers','public.kitchen_growth_receipts','public.kitchen_publications']:
   if relation in metadata['counts']:
    if sql("SELECT relrowsecurity FROM pg_class WHERE oid='"+relation+"'::regclass")!='t':raise ValueError('Private feature RLS missing: '+relation)
    for role in ['authenticated','anon','letmecook_worker']:
     for privilege in ['SELECT','INSERT','UPDATE','DELETE']:
      if sql("SELECT has_table_privilege('"+role+"','"+relation+"','"+privilege+"')")!='f':raise ValueError('Private feature ACL leaked: '+relation)
    if sql("SELECT has_table_privilege('letmecook_gateway','"+relation+"','UPDATE')")!='t':raise ValueError('Private feature gateway grant missing')
  print('Runtime worker and private feature RLS/ACL restrictions restored')
 with tempfile.TemporaryDirectory(prefix='lmc-backup-verify-') as folder:
  for name in ['recipe-images.tar.gz','storage-uploads.tar.gz']+(['source-release.tar.gz'] if (root/'source-release.tar.gz').exists() else []):
   destination=Path(folder)/name;destination.mkdir()
   with tarfile.open(root/name,'r:gz') as archive:
    members=archive.getmembers()
    if any(member.issym() or member.islnk() or Path(member.name).is_absolute() or '..' in Path(member.name).parts for member in members):raise ValueError('Unsafe image archive member')
    archive.extractall(destination,filter='data')
    for member in members:
     if member.isfile():
      with archive.extractfile(member) as original:
       if hashlib.sha256(original.read()).digest()!=hashlib.sha256((destination/member.name).read_bytes()).digest():raise ValueError('Restored image differs from archive')
   print(name+': every archived file extracted and byte-verified')
 print('Database rows, RLS, ACLs, original images, upload bytes, rebuildable source and runtime-key checksum verified. Live database untouched.')
finally:
 subprocess.run(base+['dropdb','-U','postgres','--if-exists',database],check=True,stdout=subprocess.DEVNULL)
