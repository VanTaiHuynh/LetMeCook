#!/usr/bin/env python3
"""Download only each recipe's actual source image, never an illustrative fallback.

Wikibooks File: images use MediaWiki imageinfo and open-license metadata.
Approved publisher CDN URLs are retained as rights-reserved source photographs.
A cached download is copied to a stable recipe UUID path; every output record has
one verified, locally stored image. Failed/missing images are excluded and logged.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys
import threading
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

BASE = Path(__file__).resolve().parent
PROJECT = BASE.parent / "LetMeCook"
API = "https://en.wikibooks.org/w/api.php"
USER_AGENT = "LetMeCookRecipeImages/1.0 (local archive; https://github.com/VanTaiHuynh/LetMeCook)"
MAX_IMAGE_BYTES = 20 * 1024 * 1024
_DOWNLOAD_RATE_LOCK = threading.Lock()
_NEXT_DOWNLOAD_AT = 0.0
IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif"}


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain_text(value):
    parser = PlainText()
    parser.feed(str(value or ""))
    return re.sub(r"\s+", " ", " ".join(parser.parts)).strip()


def approved_media_url(url):
    try:
        parsed = urlsplit(str(url))
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
            return False
        host = (parsed.hostname or "").lower()
        return host in {"upload.wikimedia.org", "images.immediate.co.uk"}
    except ValueError:
        return False


def source_page_url(url):
    try:
        parsed = urlsplit(str(url))
        return parsed.scheme == "https" and parsed.hostname in {"en.wikibooks.org", "commons.wikimedia.org"} and not parsed.username and not parsed.password
    except ValueError:
        return False


def image_signature(data):
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if len(data) >= 16 and data[4:8] == b"ftyp" and (data[8:12] in {b"avif", b"avis"} or b"avif" in data[12:32]):
        return "image/avif"
    raise ValueError("Response does not have a supported image signature")


def validate_image(data, content_type):
    mime = image_signature(data)
    advertised = content_type.split(";", 1)[0].strip().lower()
    if advertised == "image/jpg":
        advertised = "image/jpeg"
    if advertised not in IMAGE_TYPES or advertised != mime:
        raise ValueError(f"Image signature ({mime}) does not match content type ({advertised})")
    if len(data) < 32:
        raise ValueError("Image response is truncated")
    return mime


def file_title(filename):
    value = str(filename or "").strip().replace("_", " ")
    value = re.sub(r"^(?:File|Image):", "", value, flags=re.I).strip()
    if not value or "|" in value or any(ord(char) < 32 for char in value):
        return ""
    return "File:" + value


def allowed_license(metadata):
    labels = [plain_text(metadata.get(name, {}).get("value", "")) for name in ("LicenseShortName", "License", "UsageTerms")]
    license_url = str(metadata.get("LicenseUrl", {}).get("value", ""))
    for label in labels:
        normalized = re.sub(r"[ _]+", "-", label.lower())
        if re.search(r"(?:^|[^a-z])cc-?0(?:$|[^a-z])", normalized) or "public-domain" in normalized:
            return label or "Public domain", license_url
        if re.fullmatch(r"cc-by(?:-sa)?(?:-[1-4]\.0)?(?:-international)?", normalized):
            return label, license_url
    # License URLs sometimes provide the unambiguous machine-readable value.
    if re.fullmatch(r"https?://creativecommons\.org/(?:licenses/by(?:-sa)?/[1-4]\.0|publicdomain/(?:zero/1\.0|mark/1\.0))/?", license_url, re.I):
        selected = re.search(r"licenses/(by(?:-sa)?)/([1-4]\.0)", license_url, re.I)
        label = "CC " + selected.group(1).upper().replace("-", "-") + " " + selected.group(2) if selected else "CC0" if "/zero/" in license_url else "Public domain"
        return label, license_url
    return None


def image_metadata(page):
    info = (page.get("imageinfo") or [{}])[0]
    ext = info.get("extmetadata", {})
    license_result = allowed_license(ext)
    original = str(info.get("url", ""))
    thumbnail = str(info.get("thumburl", ""))
    download = thumbnail if approved_media_url(thumbnail) else original
    description = str(info.get("descriptionurl", ""))
    if not license_result or not approved_media_url(original) or not approved_media_url(download) or not source_page_url(description):
        return {"status": "excluded", "reason": "No supported open license and Wikimedia source image", "title": page.get("title", "")}
    license_name, license_url = license_result
    return {
        "status": "ready", "title": page.get("title", ""), "download_url": download,
        "original_image_url": original, "image_source_url": description,
        "image_author": plain_text(ext.get("Artist", {}).get("value", "")),
        "image_license": license_name, "image_license_url": license_url,
        "image_kind": "source", "image_changes": "Wikimedia scaled thumbnail" if download != original else "Unmodified original download",
        "metadata_fetched_at": int(time.time()),
    }


def atomic_bytes(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=path.name + ".", suffix=".tmp", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(data)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_json(path, value):
    atomic_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode())


def load_json(path):
    return json.loads(path.read_text()) if path.exists() else {}


class SafeRedirect(HTTPRedirectHandler):
    def __init__(self, predicate):
        self.predicate = predicate

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not self.predicate(newurl):
            raise HTTPError(newurl, 403, "Redirect outside approved source hosts", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def http_response(url, *, is_api=False):
    global _NEXT_DOWNLOAD_AT
    if not is_api:
        # One global CDN request budget, shared by all three download threads.
        with _DOWNLOAD_RATE_LOCK:
            now = time.monotonic()
            if now < _NEXT_DOWNLOAD_AT:
                time.sleep(_NEXT_DOWNLOAD_AT - now)
            _NEXT_DOWNLOAD_AT = time.monotonic() + 0.25
    predicate = (lambda target: urlsplit(target).scheme == "https" and urlsplit(target).hostname == "en.wikibooks.org") if is_api else approved_media_url
    if not predicate(url):
        raise ValueError("URL outside approved source hosts")
    opener = build_opener(SafeRedirect(predicate))
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json" if is_api else "image/avif,image/webp,image/*"}
    return opener.open(Request(url, headers=headers), timeout=40)


def retry_delay(error, attempt):
    value = getattr(error, "headers", {}).get("Retry-After", "") if getattr(error, "headers", None) else ""
    try:
        return min(60, max(2, float(value)))
    except (TypeError, ValueError):
        return min(60, 2 ** (attempt + 1))


def resolve_metadata(titles, cache, cache_path, *, batch_size=50, pause=0.5, retry_failed=False):
    wanted = [title for title in sorted(set(titles)) if title not in cache or (retry_failed and cache[title].get("status") == "failed")]
    for offset in range(0, len(wanted), batch_size):
        group = wanted[offset:offset + batch_size]
        params = {"action": "query", "format": "json", "formatversion": 2, "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": 640,
                  "iiextmetadatafilter": "Artist|LicenseShortName|License|LicenseUrl|UsageTerms|AttributionRequired", "iiextmetadatalanguage": "en", "titles": "|".join(group), "maxlag": 5}
        failure = "No response"
        for attempt in range(3):
            try:
                with http_response(API + "?" + urlencode(params), is_api=True) as response:
                    data = json.load(response)
                if data.get("error"):
                    raise ValueError(str(data["error"]))
                query = data.get("query", {})
                pages = {file_title(page.get("title")): page for page in query.get("pages", [])}
                aliases = {file_title(item["from"]): file_title(item["to"]) for item in query.get("normalized", []) + query.get("redirects", [])}
                for title in group:
                    resolved = title
                    seen = set()
                    while resolved in aliases and resolved not in seen:
                        seen.add(resolved)
                        resolved = aliases[resolved]
                    page = pages.get(resolved, {})
                    cache[title] = image_metadata(page) if page.get("imageinfo") else {"status": "excluded", "reason": "Source file not found", "title": title}
                break
            except Exception as error:
                failure = f"{type(error).__name__}: {error}"
                if attempt < 2:
                    time.sleep(retry_delay(error, attempt))
        else:
            for title in group:
                cache[title] = {"status": "failed", "reason": failure, "title": title}
        atomic_json(cache_path, cache)
        print(f"Metadata {min(offset + batch_size, len(wanted))}/{len(wanted)}", flush=True)
        time.sleep(pause)


def raw_image_url(record):
    for name in ("original_image_url", "source_image_url", "image_source_url", "image_url", "image"):
        value = record.get(name)
        if isinstance(value, list):
            value = next(iter(value), "")
        if isinstance(value, dict):
            value = value.get("url") or value.get("contentUrl") or ""
        if isinstance(value, str) and approved_media_url(value):
            return value
    return ""


def recipe_metadata(record, metadata_cache):
    title = file_title(record.get("source_image_filename"))
    if title:
        metadata = metadata_cache.get(title, {})
        return dict(metadata) if metadata.get("status") == "ready" else None
    url = raw_image_url(record)
    if not url:
        return None
    # Wikimedia files need license/artist metadata; never infer those from a URL.
    if urlsplit(url).hostname == "upload.wikimedia.org":
        return None
    return {
        "status": "ready", "download_url": url, "original_image_url": url,
        "image_source_url": url, "image_author": plain_text(record.get("image_author", "")),
        "image_license": plain_text(record.get("image_license")) or "Original source; rights reserved",
        "image_license_url": str(record.get("image_license_url", "")), "image_kind": "source",
        "image_changes": "Publisher-provided source image downloaded locally",
    }


def cached_file_valid(entry, cache_dir):
    if entry.get("status") != "downloaded":
        return False
    filename = entry.get("cache_file", "")
    if not filename or Path(filename).name != filename:
        return False
    path = cache_dir / filename
    if not path.is_file():
        return False
    try:
        data = path.read_bytes()
        return validate_image(data, entry.get("content_type", "")) and hashlib.sha256(data).hexdigest() == entry.get("sha256")
    except ValueError:
        return False


def download_image(url, cache_dir):
    failure = "No response"
    for attempt in range(3):
        try:
            with http_response(url) as response:
                content_type = response.headers.get("Content-Type", "")
                length = int(response.headers.get("Content-Length", "0") or "0")
                if length > MAX_IMAGE_BYTES:
                    raise ValueError("Image exceeds maximum file size")
                data = response.read(MAX_IMAGE_BYTES + 1)
                if len(data) > MAX_IMAGE_BYTES:
                    raise ValueError("Image exceeds maximum file size")
            mime = validate_image(data, content_type)
            digest = hashlib.sha256(data).hexdigest()
            filename = digest + "." + IMAGE_TYPES[mime]
            atomic_bytes(cache_dir / filename, data)
            return {"status": "downloaded", "cache_file": filename, "sha256": digest, "content_type": mime,
                    "bytes": len(data), "download_url": url, "downloaded_at": int(time.time())}
        except Exception as error:
            failure = f"{type(error).__name__}: {error}"
            if attempt < 2:
                time.sleep(retry_delay(error, attempt))
    return {"status": "failed", "download_url": url, "reason": failure, "failed_at": int(time.time())}


def importer_helpers(path):
    spec = importlib.util.spec_from_file_location("letmecook_recipe_importer", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def localize(records, metadata_cache, downloads, *, cache_dir, image_dir, importer, download_manifest, retry_failed=False, workers=3):
    prepared = []
    urls = set()
    excluded = []
    for record in records:
        try:
            canonical = importer.canonical_url(record.get("source_url"))
            recipe_id = importer.stable_id("recipe", canonical)
            metadata = recipe_metadata(record, metadata_cache)
            if not metadata:
                excluded.append({"source_url": record.get("source_url"), "reason": "No verified actual source image"})
                continue
            prepared.append((record, recipe_id, metadata))
            urls.add(metadata["download_url"])
        except (ValueError, TypeError) as error:
            excluded.append({"source_url": record.get("source_url"), "reason": str(error)})
    pending = [url for url in sorted(urls) if not cached_file_valid(downloads.get(url, {}), cache_dir)
               and (retry_failed or downloads.get(url, {}).get("status") != "failed")]
    with ThreadPoolExecutor(max_workers=max(1, min(3, workers))) as executor:
        futures = {executor.submit(download_image, url, cache_dir): url for url in pending}
        for count, future in enumerate(as_completed(futures), 1):
            url = futures[future]
            try:
                downloads[url] = future.result()
            except Exception as error:
                downloads[url] = {"status": "failed", "download_url": url, "reason": str(error)}
            atomic_json(download_manifest, downloads)
            if count % 20 == 0 or count == len(pending):
                print(f"Image downloads {count}/{len(pending)}", flush=True)
    results = []
    hashes = set()
    seen_ids = set()
    image_dir.mkdir(parents=True, exist_ok=True)
    for record, recipe_id, metadata in prepared:
        entry = downloads.get(metadata["download_url"], {})
        if not cached_file_valid(entry, cache_dir):
            excluded.append({"source_url": record.get("source_url"), "reason": entry.get("reason", "Source image download failed")})
            continue
        if recipe_id in seen_ids:
            continue
        seen_ids.add(recipe_id)
        suffix = IMAGE_TYPES[entry["content_type"]]
        filename = f"{recipe_id}.{suffix}"
        source = cache_dir / entry["cache_file"]
        target = image_dir / filename
        temporary = target.with_name(target.name + ".tmp")
        shutil.copyfile(source, temporary)
        temporary.replace(target)
        result = dict(record)
        for name in ("image_source_url", "image_author", "image_license", "image_kind", "image_changes", "image_license_url", "original_image_url"):
            result[name] = metadata.get(name, "")
        result["image_url"] = "/recipe-images/" + filename
        result["image_sha256"] = entry["sha256"]
        results.append(result)
        hashes.add(entry["sha256"])
    stats = {"input_recipes": len(records), "recipes_with_original_image": len(results), "unique_original_images": len(hashes),
             "local_recipe_image_files": len(results), "source_image_urls": len(urls), "missing_or_failed_images": len(excluded),
             "illustrative_images": 0, "total_image_bytes": sum(downloads.get(url, {}).get("bytes", 0) for url in urls)}
    return results, stats, excluded


def write_output(args, output, stats, excluded):
    stats["output_recipes"] = len(output)
    stats["output_local_recipe_image_files"] = len(output)
    stats["output_unique_original_images"] = len({record["image_sha256"] for record in output})
    atomic_bytes(args.output, ("\n".join(json.dumps(row, ensure_ascii=False) for row in output) + ("\n" if output else "")).encode())
    atomic_json(args.output.with_suffix(".stats.json"), stats)
    atomic_json(args.output.with_suffix(".excluded.json"), excluded)


def resume_output(args, importer):
    """Trust checkpoints only after checking original kind, UUID, MIME and hash."""
    output = []
    seen = set()
    if args.output.exists():
        for line in args.output.read_text().split("\n"):
            if not line.strip():
                continue
            row = json.loads(line)
            source = importer.canonical_url(row.get("source_url"))
            recipe_id = importer.stable_id("recipe", source)
            image_url = str(row.get("image_url", ""))
            filename = image_url.removeprefix("/recipe-images/")
            extension = Path(filename).suffix.lstrip(".")
            mime = next((mime for mime, suffix in IMAGE_TYPES.items() if suffix == extension), "")
            if row.get("image_kind") != "source" or image_url != f"/recipe-images/{recipe_id}.{extension}" or not mime:
                continue
            target = args.image_dir / filename
            if not target.is_file():
                continue
            try:
                image = target.read_bytes()
                validate_image(image, mime)
                if hashlib.sha256(image).hexdigest() != row.get("image_sha256"):
                    continue
            except ValueError:
                continue
            if source not in seen:
                seen.add(source)
                output.append(row)
    excluded = load_json(args.output.with_suffix(".excluded.json")) or []
    if not isinstance(excluded, list):
        excluded = []
    if args.retry_failed:
        excluded = []
    else:
        for failure in excluded:
            try:
                seen.add(importer.canonical_url(failure.get("source_url")))
            except (TypeError, ValueError):
                pass
    if args.limit:
        output = output[:args.limit]
    return output, seen, excluded


def follow_input(args):
    """Repeatedly consume only new complete records; every batch checkpoints output."""
    if args.offline:
        raise ValueError("--follow is a network pipeline; use fixed-input --offline for cached data")
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    metadata_path = args.cache_dir / "metadata.json"
    download_path = args.cache_dir / "downloads.json"
    metadata = load_json(metadata_path)
    downloads = load_json(download_path)
    importer = importer_helpers(args.importer)
    done_path = args.done_file or args.input.with_suffix(".done")
    output, seen, excluded = resume_output(args, importer)
    total_records = len(seen)
    if output:
        print(f"Resumed {len(output)} verified actual images from checkpoint", flush=True)
    last_new = time.monotonic()
    stats = {"input_recipes": total_records, "illustrative_images": 0, "source_image_urls": len(downloads), "recipes_with_original_image": len(output),
             "unique_original_images": len({row["image_sha256"] for row in output}), "local_recipe_image_files": len(output),
             "missing_or_failed_images": len(excluded), "total_image_bytes": sum(entry.get("bytes", 0) for entry in downloads.values())}
    while not args.limit or len(output) < args.limit:
        raw = args.input.read_text() if args.input.exists() else ""
        complete = raw[:raw.rfind("\n") + 1] if "\n" in raw else ""
        candidates = []
        for line in complete.split("\n"):
            if not line.strip():
                continue
            record = json.loads(line)
            source = importer.canonical_url(record.get("source_url"))
            if source not in seen:
                candidates.append((source, record))
        if candidates:
            last_new = time.monotonic()
            # Small batches keep output reviewable and avoid delaying a growing input.
            source_records = candidates[:20]
            batch = [record for source, record in source_records]
            for source, _ in source_records:
                seen.add(source)
            total_records += len(batch)
            titles = [file_title(record.get("source_image_filename")) for record in batch]
            resolve_metadata([title for title in titles if title], metadata, metadata_path,
                             batch_size=max(1, min(50, args.batch_size)), pause=args.pause, retry_failed=args.retry_failed)
            rows, batch_stats, failures = localize(batch, metadata, downloads, cache_dir=args.cache_dir,
                                                  image_dir=args.image_dir, importer=importer, download_manifest=download_path,
                                                  retry_failed=args.retry_failed, workers=args.workers)
            output.extend(rows)
            if args.limit:
                output = output[:args.limit]
            excluded.extend(failures)
            stats.update({"input_recipes": total_records, "recipes_with_original_image": len(output),
                          "unique_original_images": len({record["image_sha256"] for record in output}),
                          "local_recipe_image_files": len(output), "missing_or_failed_images": len(excluded),
                          "source_image_urls": len(downloads), "total_image_bytes": sum(entry.get("bytes", 0) for entry in downloads.values())})
            write_output(args, output, stats, excluded)
            print(f"Localized {len(output)} actual images; consumed {total_records} recipes", flush=True)
            continue
        if done_path.exists():
            stats["input_complete"] = True
            break
        if time.monotonic() - last_new > args.idle_timeout:
            stats["input_idle_timeout"] = True
            break
        time.sleep(max(0.1, args.poll_interval))
    stats["target_reached"] = bool(args.limit and len(output) >= args.limit)
    write_output(args, output, stats, excluded)
    print(json.dumps(stats, indent=2), flush=True)
    if args.limit and len(output) < args.limit:
        raise SystemExit(f"Insufficient actual source images: {len(output)}/{args.limit}. Output is checkpointed; provide additional candidates.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, nargs="?", default=BASE / "all-recipes" / "recipes.jsonl")
    parser.add_argument("--output", type=Path, default=BASE / "recipes-with-images.jsonl")
    parser.add_argument("--image-dir", type=Path, default=PROJECT / "client/public/recipe-images")
    parser.add_argument("--cache-dir", type=Path, default=BASE / "image-cache")
    parser.add_argument("--importer", type=Path, default=PROJECT / "deploy/import-recipes.py")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--pause", type=float, default=0.5)
    parser.add_argument("--retry-failed", action="store_true")
    parser.add_argument("--offline", action="store_true", help="Use cached metadata/downloads only; never access network")
    parser.add_argument("--limit", type=int, default=0, help="Keep at most this many successful image-bearing recipes")
    parser.add_argument("--follow", action="store_true", help="Consume complete JSONL lines as the scraper writes them")
    parser.add_argument("--done-file", type=Path, help="Marker written by the scraper when input is complete")
    parser.add_argument("--poll-interval", type=float, default=1.0)
    parser.add_argument("--idle-timeout", type=float, default=600.0)
    args = parser.parse_args()
    if args.limit < 0 or args.pause < 0:
        parser.error("limit and pause must be nonnegative")
    if args.follow:
        return follow_input(args)
    records = [json.loads(line) for line in args.input.read_text().split("\n") if line.strip()]
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    metadata_path = args.cache_dir / "metadata.json"
    download_path = args.cache_dir / "downloads.json"
    metadata = load_json(metadata_path)
    downloads = load_json(download_path)
    titles = [file_title(record.get("source_image_filename")) for record in records]
    if not args.offline:
        resolve_metadata([title for title in titles if title], metadata, metadata_path,
                         batch_size=max(1, min(50, args.batch_size)), pause=args.pause, retry_failed=args.retry_failed)
    if args.offline:
        # Mark every uncached URL failed to prohibit localize() issuing a request.
        for record in records:
            info = recipe_metadata(record, metadata)
            if info and not cached_file_valid(downloads.get(info["download_url"], {}), args.cache_dir):
                downloads[info["download_url"]] = {"status": "failed", "reason": "Not cached; offline mode"}
    output, stats, excluded = localize(records, metadata, downloads, cache_dir=args.cache_dir, image_dir=args.image_dir,
                                      importer=importer_helpers(args.importer), download_manifest=download_path,
                                      retry_failed=args.retry_failed and not args.offline, workers=args.workers)
    if args.limit:
        output = output[:args.limit]
    stats["output_recipes"] = len(output)
    stats["output_local_recipe_image_files"] = len(output)
    stats["output_unique_original_images"] = len({record["image_sha256"] for record in output})
    atomic_bytes(args.output, ("\n".join(json.dumps(row, ensure_ascii=False) for row in output) + ("\n" if output else "")).encode())
    atomic_json(args.output.with_suffix(".stats.json"), stats)
    atomic_json(args.output.with_suffix(".excluded.json"), excluded)
    print(json.dumps(stats, indent=2), flush=True)


if __name__ == "__main__":
    main()
