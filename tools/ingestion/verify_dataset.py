#!/usr/bin/env python3
"""Verify a completed recipe JSONL dataset and its original local image files.

Read-only: no network calls, image changes, database queries or imports. JSONL
records are delimited by physical LF, never Python's Unicode splitlines().
Requires Pillow for image decoding. Only an explicitly requested report is saved.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import re
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import uuid
import warnings

from PIL import Image


NAMESPACE = uuid.UUID("ce12a345-93ac-45d0-95e9-7b5764ce902a")
TRACKERS = {"fbclid", "gclid", "mc_cid", "mc_eid"}
FORMATS = {"JPEG": {"jpg", "jpeg"}, "PNG": {"png"}, "WEBP": {"webp"}, "GIF": {"gif"}}
DEFAULT_IMAGE_DIR = Path(__file__).resolve().parents[1] / "LetMeCook/client/public/recipe-images"


def canonical_url(value):
    value = str(value or "").strip()
    parts = urlsplit(value)
    if parts.scheme.lower() not in {"http", "https"} or not parts.hostname or parts.username or parts.password:
        raise ValueError("invalid HTTP(S) URL")
    if any(ord(char) < 32 for char in value):
        raise ValueError("URL contains control characters")
    port = parts.port
    host = parts.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    if port and not ((parts.scheme.lower() == "https" and port == 443) or (parts.scheme.lower() == "http" and port == 80)):
        host += f":{port}"
    query = [(name, val) for name, val in parse_qsl(parts.query, keep_blank_values=True)
             if not name.lower().startswith("utm_") and name.lower() not in TRACKERS]
    return urlunsplit((parts.scheme.lower(), host, parts.path or "/", urlencode(query), ""))


def recipe_uuid(source):
    return str(uuid.uuid5(NAMESPACE, "recipe:" + canonical_url(source)))


def image_urls(value):
    """Support schema.org image URLs, arrays and ImageObject representations."""
    if isinstance(value, str):
        try:
            return {canonical_url(value)}
        except ValueError:
            return set()
    if isinstance(value, list):
        result = set()
        for entry in value:
            result.update(image_urls(entry))
        return result
    if isinstance(value, dict):
        result = set()
        for field in ("url", "contentUrl", "@id"):
            result.update(image_urls(value.get(field)))
        return result
    return set()


def nodes(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            if isinstance(child, (dict, list)):
                yield from nodes(child)
    elif isinstance(value, list):
        for child in value:
            yield from nodes(child)


def is_recipe(node):
    kinds = node.get("@type", [])
    kinds = [kinds] if isinstance(kinds, str) else kinds
    return any(str(kind).rstrip("/").rsplit("/", 1)[-1].rsplit("#", 1)[-1].lower() == "recipe" for kind in kinds)


def source_image_urls(record, source):
    payload = record.get("source_jsonld")
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, (dict, list)):
        raise ValueError("source_jsonld is absent or invalid")
    candidates = set()
    matching_recipe = False
    for node in nodes(payload):
        if not is_recipe(node):
            continue
        page_urls = image_urls(node.get("url")) | image_urls(node.get("@id")) | image_urls(node.get("mainEntityOfPage"))
        if source not in page_urls:
            continue
        matching_recipe = True
        candidates.update(image_urls(node.get("image")))
    if not matching_recipe:
        raise ValueError("source_jsonld Recipe URL does not match this source_url")
    if not candidates:
        raise ValueError("matching source_jsonld Recipe has no original image URL")
    return candidates


def nonempty_recipe_fields(record):
    if not str(record.get("title") or "").strip():
        raise ValueError("empty recipe title")
    directions = record.get("directions")
    if not isinstance(directions, list) or not directions:
        raise ValueError("directions must be a nonempty list")
    for step in directions:
        text = step.get("text") if isinstance(step, dict) else step
        if not str(text or "").strip():
            raise ValueError("empty direction step")
    ingredients = record.get("ingredients")
    if not isinstance(ingredients, list) or not ingredients:
        raise ValueError("ingredients must be a nonempty list")
    for item in ingredients:
        name = item.get("name") if isinstance(item, dict) else item
        if not str(name or "").strip():
            raise ValueError("empty ingredient name")


def verify_record(record, image_dir, min_pixels=32):
    if not isinstance(record, dict):
        raise ValueError("recipe JSON must be an object")
    nonempty_recipe_fields(record)
    source = canonical_url(record.get("source_url"))
    expected_id = recipe_uuid(source)
    for field in ("recipe_id", "id"):
        if record.get(field) is not None and str(record[field]) != expected_id:
            raise ValueError(f"{field} does not match the stable source UUID")
    if record.get("image_kind") != "source":
        raise ValueError("image_kind must be source, with no illustrative fallback")
    original = canonical_url(record.get("image_source_url"))
    if original not in source_image_urls(record, source):
        raise ValueError("image_source_url is not an image of this recipe's source_jsonld")
    local_url = str(record.get("image_url") or "")
    match = re.fullmatch(r"/recipe-images/([0-9a-f-]{36})\.([a-zA-Z0-9]+)", local_url)
    if not match or match.group(1) != expected_id:
        raise ValueError("local image_url must contain this recipe's stable UUID")
    suffix = match.group(2).lower()
    if suffix not in set().union(*FORMATS.values()):
        raise ValueError("unsupported local image extension")
    directory = image_dir.resolve()
    path = directory / local_url.removeprefix("/recipe-images/")
    resolved = path.resolve()
    if not resolved.is_relative_to(directory) or not resolved.is_file():
        raise ValueError("original local image file is missing or outside image directory")
    before = resolved.stat()
    data = resolved.read_bytes()
    if not data:
        raise ValueError("empty local image file")
    digest = hashlib.sha256(data).hexdigest()
    if record.get("image_sha256") and str(record["image_sha256"]).lower() != digest:
        raise ValueError("local image SHA256 does not match stored image_sha256")
    for field in ("image_bytes", "image_size_bytes", "image_file_size", "image_file_size_bytes"):
        if record.get(field) is not None and int(record[field]) != len(data):
            raise ValueError(f"local image byte size does not match {field}")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
        with Image.open(io.BytesIO(data)) as decoded:
            decoded.load()
            width, height, image_format = decoded.width, decoded.height, decoded.format
    if image_format not in FORMATS or suffix not in FORMATS[image_format]:
        raise ValueError("local image extension does not match its decoded format")
    if width < min_pixels or height < min_pixels:
        raise ValueError(f"decoded image is {width}x{height}; minimum is {min_pixels}px per side")
    for field, actual in (("image_width", width), ("image_height", height)):
        if record.get(field) is not None and int(record[field]) != actual:
            raise ValueError(f"decoded image dimension does not match {field}")
    after = resolved.stat()
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
        raise ValueError("image file changed during verification")
    return {"source_url": source, "recipe_id": expected_id, "image_path": str(resolved),
            "image_source_url": original, "image_sha256": digest, "image_bytes": len(data),
            "image_width": width, "image_height": height, "image_format": image_format,
            "hash_metadata_present": bool(record.get("image_sha256"))}


def verify_dataset(input_path, image_dir, expected_count, min_pixels=32, progress_every=1000):
    before = input_path.stat()
    sources, ids, hashes, image_paths, original_urls = set(), set(), set(), set(), set()
    formats, publishers = Counter(), Counter()
    record_count = valid_count = error_count = total_bytes = hash_metadata_count = 0
    minimum_width = minimum_height = None
    errors = []
    # File iteration intentionally ignores U+0085, U+2028 and U+2029 inside JSON.
    with input_path.open(encoding="utf-8-sig") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            record_count += 1
            try:
                record = json.loads(line)
                result = verify_record(record, image_dir, min_pixels)
                if result["source_url"] in sources:
                    raise ValueError("duplicate canonical source_url")
                if result["recipe_id"] in ids:
                    raise ValueError("duplicate stable recipe UUID")
                if result["image_path"] in image_paths:
                    raise ValueError("duplicate local UUID image path")
                sources.add(result["source_url"])
                ids.add(result["recipe_id"])
                image_paths.add(result["image_path"])
                hashes.add(result["image_sha256"])
                original_urls.add(result["image_source_url"])
                formats[result["image_format"]] += 1
                publishers[urlsplit(result["source_url"]).hostname] += 1
                total_bytes += result["image_bytes"]
                hash_metadata_count += result["hash_metadata_present"]
                minimum_width = result["image_width"] if minimum_width is None else min(minimum_width, result["image_width"])
                minimum_height = result["image_height"] if minimum_height is None else min(minimum_height, result["image_height"])
                valid_count += 1
            except (ValueError, TypeError, AttributeError, OSError, EOFError, SyntaxError,
                    Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
                error_count += 1
                if len(errors) < 20:
                    errors.append({"line": line_number, "error": str(error)})
            if progress_every and record_count % progress_every == 0:
                print(f"Verified {record_count} records; {valid_count} valid; {error_count} errors", file=sys.stderr, flush=True)
    after = input_path.stat()
    changed = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
    if changed:
        error_count += 1
        errors.append({"error": "Dataset changed during verification; stop producers and verify a finalized snapshot"})
    if record_count != expected_count:
        error_count += 1
        errors.append({"error": f"Exact count mismatch: expected {expected_count}, read {record_count}"})
    return {"passed": error_count == 0, "input": str(input_path.resolve()), "image_directory": str(image_dir.resolve()),
            "expected_count": expected_count, "record_count": record_count, "valid_recipes": valid_count,
            "unique_canonical_source_urls": len(sources), "unique_recipe_uuids": len(ids),
            "original_local_image_files": len(image_paths), "unique_image_sha256": len(hashes),
            "unique_source_image_urls": len(original_urls), "images_checked_against_stored_sha256": hash_metadata_count,
            "total_image_bytes": total_bytes, "minimum_decoded_dimensions": [minimum_width, minimum_height],
            "decoded_image_formats": dict(formats), "recipe_source_hosts": dict(publishers),
            "error_count": error_count, "first_errors": errors, "dataset_changed": changed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--expected-count", "--count", type=int, default=10000)
    parser.add_argument("--image-dir", type=Path, default=DEFAULT_IMAGE_DIR)
    parser.add_argument("--min-pixels", type=int, default=32)
    parser.add_argument("--progress-every", type=int, default=1000)
    parser.add_argument("--report", type=Path, help="Optional JSON report output")
    args = parser.parse_args()
    if args.expected_count < 1 or args.min_pixels < 1 or args.progress_every < 0:
        parser.error("expected count and minimum dimensions must be positive; progress interval cannot be negative")
    if args.report and (args.report.resolve() == args.input.resolve()
                        or args.report.resolve().is_relative_to(args.image_dir.resolve())):
        parser.error("report cannot overwrite the input dataset or an image file")
    try:
        report = verify_dataset(args.input, args.image_dir, args.expected_count, args.min_pixels, args.progress_every)
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["passed"] else 1
    except (OSError, ValueError) as error:
        print(f"Dataset QA failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
