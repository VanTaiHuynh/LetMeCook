#!/usr/bin/env python3
"""Normalize recipe JSONL, generate a transactional SQL import, optionally apply it.

No packages, credentials, cloud APIs or network access are required. SQL input
uses psql COPY CSV, so source strings never become executable SQL statements.
The --limit argument specifies the exact number of unique, complete recipes.
Re-running the same source URLs updates only importer-owned recipes and keeps
their views.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
from html.parser import HTMLParser
import io
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import uuid


NAMESPACE = uuid.UUID("ce12a345-93ac-45d0-95e9-7b5764ce902a")
UNITS = {
    "cup", "cups", "tsp", "tsp.", "teaspoon", "teaspoons", "tbsp", "tbsp.",
    "tablespoon", "tablespoons", "g", "gram", "grams", "kg", "kilogram",
    "kilograms", "ml", "milliliter", "milliliters", "l", "liter", "liters",
    "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds", "clove", "cloves",
    "can", "cans", "package", "packages", "pinch", "pinches", "slice", "slices",
    "bunch", "bunches", "sprig", "sprigs", "stick", "sticks", "quart", "quarts",
    "pint", "pints",
}
TRACKERS = {"fbclid", "gclid", "mc_cid", "mc_eid"}
SCHEMA_DIETS = {
    "DiabeticDiet": "diabetic", "GlutenFreeDiet": "gluten free",
    "HalalDiet": "halal", "KosherDiet": "kosher", "LowCalorieDiet": "low calorie",
    "LowFatDiet": "low fat", "LowLactoseDiet": "low lactose",
    "LowSaltDiet": "low salt", "VeganDiet": "vegan", "VegetarianDiet": "vegetarian",
}


def explicit_source_diets(source_recipe):
    """Return only recognized schema.org suitableForDiet evidence, never inferred tags.

    Some publishers put several comma-separated URIs in a single JSON string.
    Strings, arrays and JSON-LD @id/url objects are supported. An absent property
    returns None so independent normalized/manual inputs retain their tags.
    """
    if not isinstance(source_recipe, dict) or "suitableForDiet" not in source_recipe:
        return None
    names = set()

    def visit(value):
        if isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, dict):
            visit(value.get("@id") or value.get("url"))
        elif isinstance(value, str):
            for token in value.split(","):
                parts = urlsplit(token.strip())
                if (parts.scheme.lower() in {"http", "https"}
                        and parts.hostname in {"schema.org", "www.schema.org"}
                        and not parts.username and not parts.password
                        and not parts.query and not parts.fragment):
                    name = SCHEMA_DIETS.get(parts.path.strip("/"))
                    if name:
                        names.add(name)

    visit(source_recipe.get("suitableForDiet"))
    return sorted(names)


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden += 1
        elif tag in {"br", "p", "li", "div", "h1", "h2", "h3"}:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in {"script", "style"} and self.hidden:
            self.hidden -= 1
        elif tag in {"p", "li", "div"}:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def clean_text(value):
    if value is None:
        return ""
    parser = TextParser()
    parser.feed(str(value).replace("\x00", ""))
    return re.sub(r"\s+", " ", "".join(parser.parts)).strip()


def key(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", clean_text(value))).casefold()


def stable_id(kind, value):
    return str(uuid.uuid5(NAMESPACE, f"{kind}:{value}"))


def canonical_url(value, *, required=True):
    value = str(value or "").strip()
    if not value and not required:
        return ""
    parts = urlsplit(value)
    if parts.scheme.lower() not in {"https", "http"} or not parts.hostname or parts.username or parts.password:
        raise ValueError("source_url/image_url must be an HTTP(S) URL without credentials")
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


def number(value, default=0):
    if value is None or value == "":
        return default
    if isinstance(value, str):
        match = re.search(r"\d+(?:\.\d+)?", value)
        if not match:
            return default
        value = match.group()
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) and result >= 0 else default


def minutes(value):
    if isinstance(value, str) and value.upper().startswith("P"):
        match = re.fullmatch(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", value.upper())
        if match:
            day, hour, minute, second = [float(v or 0) for v in match.groups()]
            return int(day * 1440 + hour * 60 + minute + second / 60)
    return min(int(number(value)), 2147483647)


def options(value, kind):
    if isinstance(value, str):
        value = [value]
    result = {}
    for item in value or []:
        name = clean_text(item.get("name", "") if isinstance(item, dict) else item)
        normalized = key(name)
        if normalized:
            result.setdefault(normalized, {"name": name, "key": normalized, "id": stable_id(kind, normalized)})
    return list(result.values())


def ingredient(value):
    if isinstance(value, dict):
        name = clean_text(value.get("name"))
        quantity = clean_text(value.get("quantity"))
        unit = clean_text(value.get("unit"))
    else:
        name = clean_text(value)
        quantity, unit = "", ""
        # Conservative parsing: keep the full remaining name instead of making
        # up an ingredient when a source uses an unfamiliar quantity format.
        match = re.match(r"^(\d+(?:\.\d+|/\d+)?(?:\s+\d+/\d+)?|[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])\s+(.+)$", name)
        if match:
            quantity, name = match.groups()
            parts = name.split(" ", 1)
            if len(parts) == 2 and parts[0].lower() in UNITS:
                unit, name = parts
    normalized = key(name)
    if not normalized:
        return None
    return {"name": name, "key": normalized, "id": stable_id("ingredient", normalized),
            "quantity": quantity, "unit": unit}


def normalize(record):
    source_url = canonical_url(record.get("source_url"))
    title = clean_text(record.get("title"))
    raw_directions = record.get("directions") or []
    if isinstance(raw_directions, str):
        raw_directions = [raw_directions]
    directions = [clean_text(item.get("text", "") if isinstance(item, dict) else item) for item in raw_directions]
    directions = [item for item in directions if item]
    ingredients = []
    seen = set()
    for raw in record.get("ingredients") or []:
        item = ingredient(raw)
        if item:
            fingerprint = (item["key"], item["quantity"], item["unit"])
            if fingerprint not in seen:
                ingredients.append(item)
                seen.add(fingerprint)
    if not title or not directions or not ingredients:
        raise ValueError("recipe requires title, at least one direction and at least one ingredient")
    recipe_id = stable_id("recipe", source_url)
    for index, item in enumerate(ingredients):
        item["link_id"] = stable_id("recipe-ingredient", f"{recipe_id}:{index}:{item['key']}:{item['quantity']}:{item['unit']}")
    image = str(record.get("image_url") or "").strip()
    image = image if image.startswith("/") and not image.startswith("//") else canonical_url(image, required=False)
    description = clean_text(record.get("description"))
    source_diets = explicit_source_diets(record.get("source_jsonld"))
    normalized = {
        "recipe_id": recipe_id, "source_url": source_url,
        "source_license": clean_text(record.get("source_license")) or None,
        "source_author": clean_text(record.get("source_author")) or None,
        "image_source_url": canonical_url(record.get("image_source_url"), required=False) or None,
        "image_author": clean_text(record.get("image_author")) or None,
        "image_license": clean_text(record.get("image_license")) or None,
        "image_kind": clean_text(record.get("image_kind")) or None,
        "title": title, "description": f"<p>{html.escape(description)}</p>" if description else "",
        "directions": "".join(f"<li>{html.escape(step)}</li>" for step in directions),
        "ingredients": ingredients, "servings": min(number(record.get("servings")), 1e6),
        "time_minutes": minutes(record.get("time_minutes")), "image_url": image,
        "categories": options(record.get("categories"), "category"),
        "cuisines": options(record.get("cuisines"), "cuisine"),
        "dietary_preferences": options(
            source_diets if source_diets is not None else record.get("dietary_preferences"),
            "dietary-preference"),
    }
    normalized["record_hash"] = hashlib.sha256(json.dumps(normalized, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return normalized


def read_recipes(path, limit, require_original_images=False):
    result, seen = [], set()
    duplicate_count = 0
    with path.open(encoding="utf-8-sig") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                record = normalize(json.loads(line))
                if require_original_images:
                    filename = record["image_url"].removeprefix("/recipe-images/")
                    if (not record["image_url"].startswith("/recipe-images/") or "/" in filename
                            or Path(filename).stem != record["recipe_id"] or not record["image_source_url"]
                            or record["image_kind"] != "source"):
                        raise ValueError("recipe requires a local /recipe-images/UUID.ext source image with image_source_url and image_kind='source'")
            except (ValueError, TypeError, AttributeError) as error:
                raise ValueError(f"Invalid input at line {line_no}: {error}") from error
            if record["source_url"] in seen:
                duplicate_count += 1
                continue
            result.append(record)
            seen.add(record["source_url"])
            if len(result) == limit:
                break
    if len(result) != limit:
        raise ValueError(f"Need exactly {limit} unique complete recipes; input provides {len(result)}")
    return result, duplicate_count


SQL_HEADER = r"""-- Generated from normalized source data. Execute with psql -X -v ON_ERROR_STOP=1.
BEGIN;
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '10min';
SELECT pg_advisory_xact_lock(hashtext('letmecook:recipe-import'));
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS source_license text;
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS source_author text;
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS image_source_url text;
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS image_author text;
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS image_license text;
ALTER TABLE public.recipe ADD COLUMN IF NOT EXISTS image_kind text;
CREATE UNIQUE INDEX IF NOT EXISTS lmc_recipe_source_url ON public.recipe(source_url)
WHERE source_url IS NOT NULL AND source_url <> '';
CREATE TABLE IF NOT EXISTS public.imported_recipe_sources (
  recipe_id uuid PRIMARY KEY REFERENCES public.recipe(id) ON DELETE CASCADE,
  source_url text NOT NULL UNIQUE,
  record_hash text NOT NULL,
  imported_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.imported_recipe_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.imported_recipe_sources FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.imported_recipe_sources TO service_role;
CREATE TEMP TABLE lmc_import_expected (
  expected_count integer NOT NULL CHECK (expected_count > 0)
) ON COMMIT DROP;
INSERT INTO lmc_import_expected VALUES (__LMC_EXPECTED_COUNT__);
CREATE TEMP TABLE lmc_import_data (doc jsonb NOT NULL) ON COMMIT DROP;
COPY lmc_import_data(doc) FROM STDIN WITH (FORMAT csv);
"""

SQL_BODY = r"""\.
CREATE TEMP TABLE lmc_import_recipes ON COMMIT DROP AS
SELECT (doc->>'recipe_id')::uuid AS id, doc->>'source_url' AS source_url, doc
FROM lmc_import_data;
ALTER TABLE lmc_import_recipes ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX ON lmc_import_recipes(source_url);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM lmc_import_recipes i JOIN public.recipe r
      ON r.id = i.id OR r.source_url = i.source_url
    LEFT JOIN public.imported_recipe_sources s ON s.recipe_id = r.id
    WHERE r.id <> i.id OR r.author_id IS NOT NULL OR s.recipe_id IS NULL
       OR s.source_url <> i.source_url
  ) THEN
    RAISE EXCEPTION 'Import would overwrite a recipe outside the importer; no changes applied';
  END IF;
END;
$$;
CREATE TEMP TABLE lmc_import_lookups (
  kind text NOT NULL, key text NOT NULL, name text NOT NULL, id uuid NOT NULL,
  PRIMARY KEY (kind, key)
) ON COMMIT DROP;
INSERT INTO lmc_import_lookups(kind,key,name,id)
SELECT DISTINCT ON (kind, item->>'key') kind, item->>'key', item->>'name', (item->>'id')::uuid
FROM lmc_import_data d
CROSS JOIN LATERAL (VALUES ('ingredient', d.doc->'ingredients'),
  ('category', d.doc->'categories'), ('cuisine', d.doc->'cuisines'),
  ('preference', d.doc->'dietary_preferences')) lookup_groups(kind, items)
CROSS JOIN LATERAL jsonb_array_elements(lookup_groups.items) AS item
ORDER BY kind, item->>'key', item->>'name';

-- Reuse an existing equivalent ingredient/tag, including the starter seed,
-- instead of creating duplicate names. Only new names get stable UUIDs.
DO $$
DECLARE pair record;
BEGIN
  FOR pair IN SELECT * FROM (VALUES ('ingredient','ingredients'), ('category','categories'),
    ('cuisine','cuisines'), ('preference','dietary_pref')) AS pairs(kind, table_name) LOOP
    EXECUTE format($query$
      UPDATE lmc_import_lookups l SET id = existing.id
      FROM (SELECT DISTINCT ON (normalized) id, normalized
            FROM (SELECT id, regexp_replace(lower(btrim(name)), '\s+', ' ', 'g') AS normalized
                  FROM public.%I) source ORDER BY normalized, id) existing
      WHERE l.kind = %L AND l.key = existing.normalized
    $query$, pair.table_name, pair.kind);
    EXECUTE format($query$
      INSERT INTO public.%I(id,name)
      SELECT id,name FROM lmc_import_lookups WHERE kind = %L
      ON CONFLICT (id) DO NOTHING
    $query$, pair.table_name, pair.kind);
  END LOOP;
END;
$$;

INSERT INTO public.recipe(id,title,description,servings,image_url,is_public,directions,time,
  source_url,source_license,source_author,image_source_url,image_author,image_license,image_kind)
SELECT id,doc->>'title',doc->>'description',(doc->>'servings')::real,
  doc->>'image_url',true,doc->>'directions',(doc->>'time_minutes')::integer,
  source_url,doc->>'source_license',doc->>'source_author',doc->>'image_source_url',
  doc->>'image_author',doc->>'image_license',doc->>'image_kind'
FROM lmc_import_recipes
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, description = EXCLUDED.description,
  servings = EXCLUDED.servings, image_url = EXCLUDED.image_url,
  directions = EXCLUDED.directions, time = EXCLUDED.time,
  source_url = EXCLUDED.source_url, source_license = EXCLUDED.source_license,
  source_author = EXCLUDED.source_author, image_source_url = EXCLUDED.image_source_url,
  image_author = EXCLUDED.image_author, image_license = EXCLUDED.image_license,
  image_kind = EXCLUDED.image_kind;

INSERT INTO public.imported_recipe_sources(recipe_id,source_url,record_hash)
SELECT id,source_url,doc->>'record_hash' FROM lmc_import_recipes
ON CONFLICT (recipe_id) DO UPDATE SET record_hash = EXCLUDED.record_hash, imported_at = now();

-- Replace only this batch's imported recipe links; accounts, real user recipes,
-- reviews, favourites and browsing history survive.
DELETE FROM public.recipe_ingredients WHERE recipe_id IN (SELECT id FROM lmc_import_recipes);
DELETE FROM public.recipe_categories WHERE recipe_id IN (SELECT id FROM lmc_import_recipes);
DELETE FROM public.recipe_cuisines WHERE recipe_id IN (SELECT id FROM lmc_import_recipes);
DELETE FROM public.recipe_dietary_pref WHERE recipe_id IN (SELECT id FROM lmc_import_recipes);
INSERT INTO public.recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit)
SELECT (item->>'link_id')::uuid, r.id, lookup.id, item->>'quantity', item->>'unit'
FROM lmc_import_recipes r CROSS JOIN LATERAL jsonb_array_elements(r.doc->'ingredients') AS item
JOIN lmc_import_lookups lookup ON lookup.kind = 'ingredient' AND lookup.key = item->>'key';
INSERT INTO public.recipe_categories(recipe_id,category_id)
SELECT r.id, lookup.id FROM lmc_import_recipes r
CROSS JOIN LATERAL jsonb_array_elements(r.doc->'categories') AS item
JOIN lmc_import_lookups lookup ON lookup.kind = 'category' AND lookup.key = item->>'key';
INSERT INTO public.recipe_cuisines(recipe_id,cuisine_id)
SELECT r.id, lookup.id FROM lmc_import_recipes r
CROSS JOIN LATERAL jsonb_array_elements(r.doc->'cuisines') AS item
JOIN lmc_import_lookups lookup ON lookup.kind = 'cuisine' AND lookup.key = item->>'key';
INSERT INTO public.recipe_dietary_pref(recipe_id,preference_id)
SELECT r.id, lookup.id FROM lmc_import_recipes r
CROSS JOIN LATERAL jsonb_array_elements(r.doc->'dietary_preferences') AS item
JOIN lmc_import_lookups lookup ON lookup.kind = 'preference' AND lookup.key = item->>'key';

DO $$
DECLARE requested integer; loaded integer; expected integer;
BEGIN
  SELECT expected_count INTO expected FROM lmc_import_expected;
  SELECT count(*) INTO requested FROM lmc_import_recipes;
  SELECT count(*) INTO loaded FROM lmc_import_recipes i
    JOIN public.imported_recipe_sources s ON s.recipe_id = i.id AND s.source_url = i.source_url
    JOIN public.recipe r ON r.id = i.id;
  IF requested <> expected OR loaded <> expected THEN
    RAISE EXCEPTION 'Import count mismatch: % expected, % staged, % loaded', expected, requested, loaded;
  END IF;
END;
$$;
-- Drop only the four synthetic recipes generated by this deployment's seed,
-- after validating the real import. If a user edited/claimed one, preserve it.
DELETE FROM public.recipe WHERE id IN (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid,
  '10000000-0000-4000-8000-000000000003'::uuid,
  '10000000-0000-4000-8000-000000000004'::uuid
) AND title LIKE 'Demo:%' AND author_id IS NULL
  AND (SELECT count(*) FROM lmc_import_recipes) = (SELECT expected_count FROM lmc_import_expected);
NOTIFY pgrst, 'reload schema';
SELECT count(*) AS batch_imported, count(DISTINCT source_url) AS unique_sources FROM lmc_import_recipes;
COMMIT;
"""


def build_sql(records):
    if not records:
        raise ValueError("Cannot generate an empty import")
    if len({record["source_url"] for record in records}) != len(records):
        raise ValueError("Import batch contains duplicate canonical source URLs")
    if len({record["recipe_id"] for record in records}) != len(records):
        raise ValueError("Import batch contains duplicate recipe IDs")
    csv_buffer = io.StringIO(newline="")
    writer = csv.writer(csv_buffer, lineterminator="\n")
    for record in records:
        writer.writerow([json.dumps(record, ensure_ascii=False, separators=(",", ":"))])
    header = SQL_HEADER.replace("__LMC_EXPECTED_COUNT__", str(len(records)))
    return header + csv_buffer.getvalue() + SQL_BODY


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Normalized recipe JSONL")
    parser.add_argument("--limit", default=10000, type=int, help="Exact number of unique recipes to import (default 10000)")
    parser.add_argument("--sql-output", type=Path, help="Reviewable SQL file; default is INPUT.import.sql")
    parser.add_argument("--apply", action="store_true", help="Apply after generating SQL via local Docker psql")
    parser.add_argument("--require-original-images", action="store_true", help="Require an original source image downloaded locally for every recipe")
    parser.add_argument("--image-dir", type=Path, default=Path(__file__).resolve().parent.parent / "client/public/recipe-images",
                        help="Directory of downloaded images for --require-original-images")
    parser.add_argument("--container", default="supabase_db_letmecook", help="Local Supabase database container")
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("--limit must be positive")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*", args.container):
        parser.error("Invalid container name")
    try:
        records, duplicates = read_recipes(args.input, args.limit, args.require_original_images)
        if args.require_original_images:
            for record in records:
                image = args.image_dir / record["image_url"].removeprefix("/recipe-images/")
                if not image.is_file() or image.stat().st_size == 0:
                    raise ValueError(f"Original local image missing or empty for recipe {record['recipe_id']}: {image}")
        output = args.sql_output or args.input.with_suffix(".import.sql")
        if output.resolve() == args.input.resolve():
            raise ValueError("SQL output cannot overwrite the input JSONL")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(build_sql(records), encoding="utf-8")
        print(f"Prepared {len(records)} unique recipes; skipped {duplicates} duplicate URLs. SQL: {output}")
        if args.apply:
            with output.open("rb") as sql_input:
                subprocess.run(["docker", "exec", "-i", args.container, "psql", "-X",
                                "--set", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
                               stdin=sql_input, check=True)
            print(f"Imported {len(records)} recipes transactionally into local Supabase.")
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Import failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
