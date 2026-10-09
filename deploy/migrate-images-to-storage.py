#!/usr/bin/env python3
"""Copy existing site images into this project's local Supabase Storage.

Only Storage's API writes object data/metadata. Originals and recipe URLs stay
unchanged. Credentials are captured in memory and never printed or saved.
Retries verify existing object bytes instead of overwriting them.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import mimetypes
from pathlib import Path
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, build_opener, HTTPRedirectHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, hdrs, newurl):
        return None

DEPLOY = Path(__file__).resolve().parent
REPO = DEPLOY.parent
IMAGE_SUFFIXES = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.ico'}


def database(sql):
    result = subprocess.run(['docker', 'exec', 'supabase_db_letmecook', 'psql',
                             '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres',
                             '-d', 'postgres', '-c', sql], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('LetMeCook database inventory failed.')
    return json.loads(result.stdout)


def inventory():
    recipes = database("SELECT coalesce(json_agg(image_url),'[]'::json) FROM public.recipe")
    linked = set()
    for image in recipes:
        if not isinstance(image, str) or not image.startswith('/recipe-images/'):
            raise RuntimeError('Catalog contains an unexpected image path; review before migrating.')
        relative = Path(image.removeprefix('/recipe-images/'))
        if len(relative.parts) != 1 or relative.suffix.lower() not in IMAGE_SUFFIXES:
            raise RuntimeError('Catalog image path is not a flat local image.')
        linked.add(relative.name)
        if not (REPO / 'client/public/recipe-images' / relative).is_file():
            raise RuntimeError('A catalog original is missing; no placeholder will be substituted.')
    entries = []
    for path in sorted((REPO / 'client/public/recipe-images').iterdir()):
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES:
            entries.append(('recipe-images', path.name, path))
    for directory, prefix in [(REPO / 'client/src/assets', 'brand'), (REPO / 'client/public/assets', 'assets')]:
        for path in sorted(directory.rglob('*')):
            if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES:
                entries.append(('site-assets', prefix + '/' + path.relative_to(directory).as_posix(), path))
    for path in sorted((REPO / 'client/public').iterdir()):
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES:
            entries.append(('site-assets', path.name, path))
    return entries, linked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Upload missing objects through the local Storage API.')
    parser.add_argument('--workers', type=int, default=12)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if not 1 <= args.workers <= 32:
        parser.error('workers must be between 1 and 32')
    entries, linked = inventory()
    summary = {'catalogRecipes': len(linked), 'objects': len(entries),
               'sourceBytes': sum(path.stat().st_size for _, _, path in entries),
               'provider': 'Supabase Storage local', 'originalFilesPreserved': True,
               'recipeURLsPreserved': True}
    if not args.apply:
        print(json.dumps(summary))
        return
    status = json.loads(subprocess.check_output(['supabase', 'status', '--workdir', str(DEPLOY), '-o', 'json'],
                                               stderr=subprocess.DEVNULL, text=True))
    if status.get('API_URL', '').rstrip('/') != 'http://127.0.0.1:56421':
        raise RuntimeError('Refusing to write to a different Supabase instance.')
    base = status['API_URL'].rstrip('/') + '/storage/v1'
    key = status.get('SERVICE_ROLE_KEY')
    if not key:
        raise RuntimeError('Local Storage operator credential is unavailable.')
    headers = {'Authorization': 'Bearer ' + key, 'apikey': key}
    # Reuse the handler chain; constructing TLS handlers for every local HTTP
    # request wastes CPU loading trust roots. Each request still owns its headers.
    opener = build_opener(NoRedirect)

    def request(method, route, data=None, content_type=None):
        request_headers = dict(headers)
        if content_type:
            request_headers['Content-Type'] = content_type
        # No redirects: an operator key must remain on the fixed local origin.
        return opener.open(Request(base + route, data=data, headers=request_headers, method=method), timeout=60)

    # Keep imported recipe photos private and protected by the existing recipe
    # read policy. Brand/marketing assets have no account data and are public.
    buckets = json.loads(request('GET', '/bucket').read())
    existing = {bucket['id']: bucket for bucket in buckets}
    if 'recipe-images' not in existing or existing['recipe-images']['public']:
        raise RuntimeError('Expected the existing private recipe-images bucket.')
    if 'site-assets' not in existing:
        payload = json.dumps({'id': 'site-assets', 'name': 'site-assets', 'public': True,
                              'file_size_limit': 10485760,
                              'allowed_mime_types': ['image/jpeg', 'image/png', 'image/webp', 'image/gif',
                                                     'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']}).encode()
        request('POST', '/bucket', payload, 'application/json').close()
    elif not existing['site-assets']['public']:
        raise RuntimeError('Existing site-assets bucket has unexpected access settings.')
    records = database("SELECT coalesce(json_agg(json_build_object('bucket',bucket_id,'name',name)),'[]'::json) FROM storage.objects WHERE bucket_id IN ('recipe-images','site-assets')")
    stored = {(record['bucket'], record['name']) for record in records}
    started = time.monotonic()

    def transfer(entry):
        bucket, name, path = entry
        content = path.read_bytes()
        expected = hashlib.sha256(content).digest()
        route = '/object/' + bucket + '/' + quote(name, safe='/')
        for attempt in range(3):
            try:
                if (bucket, name) not in stored:
                    mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
                    try:
                        request('POST', route, content, mime).close()
                    except HTTPError as error:
                        if error.code != 409:
                            raise
                with request('GET', route) as response:
                    actual = hashlib.sha256(response.read()).digest()
                if actual != expected:
                    raise RuntimeError('Stored image differs from its original: ' + bucket + '/' + name)
                return bucket, len(content), (bucket, name) not in stored
            except (HTTPError, URLError, TimeoutError):
                if attempt == 2:
                    raise RuntimeError('Local image transfer failed: ' + bucket + '/' + name) from None
                time.sleep(attempt + 1)

    counts = {'recipe-images': 0, 'site-assets': 0}
    uploaded = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(transfer, entry) for entry in entries]
        for index, future in enumerate(as_completed(futures), 1):
            bucket, _, created = future.result()
            counts[bucket] += 1
            uploaded += int(created)
            if index % 500 == 0:
                print(f'Verified {index}/{len(entries)} images', flush=True)
    summary.update({'verifiedSHA256': counts, 'uploaded': uploaded,
                    'durationSeconds': round(time.monotonic() - started, 2)})
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    main()
