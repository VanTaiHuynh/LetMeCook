#!/usr/bin/env python3
"""Verify public, non-secret app responses; never inspect credentials or tokens."""
import argparse
import json
import re
import sys
import time
from html.parser import HTMLParser
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.parse import urlsplit


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class AppDocument(HTMLParser):
    def __init__(self):
        super().__init__()
        self.config_text = []
        self.in_config = False
        self.assets = {'javascript': [], 'css': []}
        self.root = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'div' and attrs.get('id') == 'root':
            self.root = True
        if tag == 'script' and attrs.get('id') == 'lmc-seo-config':
            self.in_config = True
        if tag == 'script' and attrs.get('type') == 'module':
            self.assets['javascript'].append(attrs.get('src', ''))
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.assets['css'].append(attrs.get('href', ''))

    def handle_endtag(self, tag):
        if tag == 'script':
            self.in_config = False

    def handle_data(self, data):
        if self.in_config:
            self.config_text.append(data)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def verify(args):
    opener = build_opener(NoRedirect())

    def get(path, *, hostname='letmecook.ca', base=None, limit=5 * 1024 * 1024):
        base = base or args.base
        require(path.startswith('/') and not path.startswith('//'), 'Invalid verification path')
        headers = {'Cache-Control': 'no-cache', 'User-Agent': 'LetMeCook-Origin-Verification/1.0'}
        if base.startswith('http://127.0.0.1:'):
            headers.update({'Host': hostname, 'X-Forwarded-Proto': 'https'})
        try:
            response = opener.open(Request(base + path, headers=headers), timeout=20)
        except HTTPError as error:
            response = error
        with response:
            body = response.read(limit + 1)
            require(len(body) <= limit, 'Verification response exceeded its size limit')
            return response.status, response.headers, body

    def document(path):
        status, headers, body = get(path, limit=2 * 1024 * 1024)
        require(status == 200, f'{path}: expected full app HTTP 200, got {status}')
        require('text/html' in headers.get('Content-Type', ''), f'{path}: expected HTML')
        doc = AppDocument()
        doc.feed(body.decode('utf-8'))
        require(doc.root and doc.config_text, f'{path}: missing full app SSR marker')
        config = json.loads(''.join(doc.config_text))
        require(config.get('publicSiteOrigin') == 'https://letmecook.ca', f'{path}: app public origin is not configured for letmecook.ca')
        require(config.get('metadata', {}).get('known') is True, f'{path}: app did not recognize this route')
        require(config.get('metadata', {}).get('pathname') == path, f'{path}: wrong SSR route')
        return doc, headers

    doc, _ = document('/')
    for kind, candidates in doc.assets.items():
        paths = []
        for candidate in candidates:
            parts = urlsplit(candidate)
            if parts.netloc and (parts.scheme != 'https' or parts.netloc != 'letmecook.ca'):
                continue
            extension = 'js' if kind == 'javascript' else 'css'
            if not parts.query and not parts.fragment and re.fullmatch(rf'/assets/[A-Za-z0-9_.-]+\.{extension}', parts.path):
                paths.append(parts.path)
        require(bool(paths), f'Missing full application {kind} bundle')
        path = paths[0]
        status, headers, body = get(path)
        require(status == 200 and len(body) > 20, f'Application {kind} asset unavailable')
        require(kind in headers.get('Content-Type', ''), f'Application {kind} asset returned an unexpected content type')
    for path in ['/features', '/how-it-works', '/recipes', '/search', '/sunny', '/meal-planner', '/cook-along', '/login', '/terms', '/privacy']:
        _, headers = document(path)
        if path == '/login':
            require('noindex' in headers.get('X-Robots-Tag', '').lower(), 'Login page must remain noindex')
    status, _, body = get('/api/health/ready', limit=256 * 1024)
    require(status == 200 and json.loads(body).get('status') == 'ready', 'Application backend is not ready')
    status, _, body = get('/api/platform/config', limit=256 * 1024)
    require(status == 200, 'Public platform configuration unavailable')
    demo = json.loads(body).get('publicDemo')
    require(isinstance(demo, bool), 'Public catalog mode must be a boolean')
    if args.expect_demo == 'true':
        require(demo is True, 'Approved-catalog public mode is not enabled')
    if args.check_auth:
        status, _, body = get('/auth/v1/health', limit=256 * 1024)
        require(status == 200 and bool(body), 'Same-origin authentication health unavailable')
    status, _, _ = get('/__letmecook_unknown_route__', limit=2 * 1024 * 1024)
    require(status == 404, 'Unknown app route must return HTTP 404')
    if args.check_www:
        base = 'https://www.letmecook.ca' if args.base.startswith('https:') else args.base
        status, headers, _ = get('/features?source=domain-check', hostname='www.letmecook.ca', base=base, limit=256 * 1024)
        require(status == 301, 'www must return HTTP 301')
        require(headers.get('Location') == 'https://letmecook.ca/features?source=domain-check', 'www canonical redirect must preserve path and query')
    print(f'PASS {args.base}: full app, assets, routes, backend, publicDemo={str(demo).lower()}')


def wait_for_origin(args, verify_once=verify, clock=time.monotonic, pause=time.sleep):
    deadline = clock() + args.wait_seconds
    while True:
        try:
            return verify_once(args)
        except (RuntimeError, OSError, ValueError):
            remaining = deadline - clock()
            if remaining <= 0:
                raise
            pause(min(0.5, remaining))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('base', choices=['http://127.0.0.1:9401', 'http://127.0.0.1:8092', 'https://letmecook.ca'])
    parser.add_argument('--expect-demo', choices=['any', 'true'], default='any')
    parser.add_argument('--check-www', action='store_true')
    parser.add_argument('--check-auth', action='store_true')
    parser.add_argument('--wait-seconds', type=int, choices=range(0, 61), default=0, metavar='0..60')
    args = parser.parse_args()
    wait_for_origin(args)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'FAIL: {error}', file=sys.stderr)
        sys.exit(1)
