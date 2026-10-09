#!/usr/bin/env python3
"""Generate a reviewable, idempotent repair of explicit source dietary tags.

No database/network access: original JSONL, recipe fields, licences, authors,
images and imported record hashes are untouched. Only publisher suitableForDiet
evidence is used. SQL refuses non-importer-owned/mismatched recipe rows.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("lmc_import", Path(__file__).with_name("import-recipes.py"))
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def read_evidence(path, expected):
    records, seen, counts, old_counts = [], set(), Counter(), Counter()
    total = 0
    before = path.stat()
    with path.open(encoding="utf-8-sig") as handle:
        # Physical LF iteration preserves U+2028/U+0085 inside JSON strings.
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            raw = json.loads(line)
            source_url = importer.canonical_url(raw.get("source_url"))
            if source_url in seen:
                raise ValueError(f"Duplicate canonical source URL at line {line_number}")
            seen.add(source_url)
            total += 1
            source = raw.get("source_jsonld")
            if not isinstance(source, dict):
                raise ValueError(f"Missing original source_jsonld at line {line_number}")
            declared_url = source.get("url") or source.get("@id")
            if importer.canonical_url(declared_url) != source_url:
                raise ValueError(f"Recipe/source JSON-LD identity mismatch at line {line_number}")
            types = source.get("@type")
            if not (types == "Recipe" or isinstance(types, list) and "Recipe" in types):
                raise ValueError(f"Source JSON-LD is not a Recipe at line {line_number}")
            old_counts.update(set(importer.key(t) for t in raw.get("dietary_preferences", [])))
            names = importer.explicit_source_diets(source)
            if names is None:
                continue
            counts.update(names)
            records.append({
                "recipe_id": importer.stable_id("recipe", source_url), "source_url": source_url,
                "source_record_sha256": hashlib.sha256(json.dumps(raw, ensure_ascii=False,
                    sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
                "suitable_for_diet": source["suitableForDiet"],
                "normalized_names": names,
                "preferences": importer.options(names, "dietary-preference"),
            })
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError("Dataset changed during inspection; use the frozen final copy")
    if total != expected:
        raise ValueError(f"Expected exactly {expected} records, found {total}")
    if not records:
        raise ValueError("Dataset contains no explicit suitableForDiet evidence")
    return records, {"input_record_count": total, "evidence_recipe_count": len(records),
        "current_normalized_tag_counts_in_jsonl": dict(sorted(old_counts.items())),
        "explicit_source_tag_counts": dict(sorted(counts.items()))}


def build_sql(records):
    csv_buffer = io.StringIO(newline="")
    writer = csv.writer(csv_buffer, lineterminator="\n")
    for record in records:
        writer.writerow([json.dumps(record, ensure_ascii=False, separators=(",", ":"))])
    ontology = json.dumps(list(importer.SCHEMA_DIETS.values()), separators=(",", ":"))
    header = """-- Repair ONLY explicit publisher diet evidence; review before applying.
BEGIN;
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';
SELECT pg_advisory_xact_lock(hashtext('letmecook:recipe-import'));
CREATE TABLE IF NOT EXISTS public.imported_recipe_diet_evidence (
  recipe_id uuid PRIMARY KEY REFERENCES public.recipe(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  source_record_sha256 text NOT NULL,
  suitable_for_diet jsonb NOT NULL,
  normalized_names jsonb NOT NULL,
  normalized_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.imported_recipe_diet_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.imported_recipe_diet_evidence FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.imported_recipe_diet_evidence TO service_role;
CREATE TEMP TABLE lmc_diet_evidence(doc jsonb NOT NULL) ON COMMIT DROP;
COPY lmc_diet_evidence(doc) FROM STDIN WITH (FORMAT csv);
"""
    body = r"""\.
CREATE UNIQUE INDEX ON lmc_diet_evidence((doc->>'recipe_id'));
CREATE UNIQUE INDEX ON lmc_diet_evidence((doc->>'source_url'));
DO $$
BEGIN
  IF (SELECT count(*) FROM lmc_diet_evidence) <> __EXPECTED__ OR EXISTS (
    SELECT 1 FROM lmc_diet_evidence d
    LEFT JOIN public.recipe r ON r.id=(d.doc->>'recipe_id')::uuid
    LEFT JOIN public.imported_recipe_sources s ON s.recipe_id=r.id
    WHERE r.id IS NULL OR r.author_id IS NOT NULL OR s.recipe_id IS NULL
      OR r.source_url IS DISTINCT FROM d.doc->>'source_url'
      OR s.source_url IS DISTINCT FROM d.doc->>'source_url'
  ) THEN
    RAISE EXCEPTION 'Diet repair contains unavailable/non-imported/mismatched recipe rows';
  END IF;
END;
$$;
CREATE TEMP TABLE lmc_diet_lookups ON COMMIT DROP AS
SELECT DISTINCT ON (p->>'key') p->>'key' AS key, p->>'name' AS name,(p->>'id')::uuid AS id
FROM lmc_diet_evidence d CROSS JOIN LATERAL jsonb_array_elements(d.doc->'preferences') p
ORDER BY p->>'key',p->>'name';
UPDATE lmc_diet_lookups l SET id=existing.id FROM (
  SELECT DISTINCT ON (normalized) id,normalized FROM (
    SELECT id,regexp_replace(lower(btrim(name)),'\s+',' ','g') AS normalized FROM public.dietary_pref
  ) x ORDER BY normalized,id
) existing WHERE existing.normalized=l.key;
INSERT INTO public.dietary_pref(id,name) SELECT id,name FROM lmc_diet_lookups ON CONFLICT(id) DO NOTHING;
-- Preserve unrelated labels. Replace recognized source-diet labels only, and
-- only for imported recipes whose publisher actually supplied this property.
DELETE FROM public.recipe_dietary_pref j USING public.dietary_pref p,lmc_diet_evidence d
WHERE j.preference_id=p.id AND j.recipe_id=(d.doc->>'recipe_id')::uuid
  AND lower(btrim(p.name)) IN (SELECT jsonb_array_elements_text('__ONTOLOGY__'::jsonb))
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(d.doc->'normalized_names') n
    WHERE n=lower(btrim(p.name)));
INSERT INTO public.recipe_dietary_pref(recipe_id,preference_id)
SELECT (d.doc->>'recipe_id')::uuid,l.id FROM lmc_diet_evidence d
CROSS JOIN LATERAL jsonb_array_elements_text(d.doc->'normalized_names') n
JOIN lmc_diet_lookups l ON l.key=n ON CONFLICT DO NOTHING;
INSERT INTO public.imported_recipe_diet_evidence(recipe_id,source_url,source_record_sha256,suitable_for_diet,normalized_names)
SELECT (doc->>'recipe_id')::uuid,doc->>'source_url',doc->>'source_record_sha256',
  doc->'suitable_for_diet',doc->'normalized_names' FROM lmc_diet_evidence
ON CONFLICT(recipe_id) DO UPDATE SET source_url=EXCLUDED.source_url,
  source_record_sha256=EXCLUDED.source_record_sha256,suitable_for_diet=EXCLUDED.suitable_for_diet,
  normalized_names=EXCLUDED.normalized_names,normalized_at=now()
WHERE imported_recipe_diet_evidence.source_record_sha256 IS DISTINCT FROM EXCLUDED.source_record_sha256
  OR imported_recipe_diet_evidence.suitable_for_diet IS DISTINCT FROM EXCLUDED.suitable_for_diet
  OR imported_recipe_diet_evidence.normalized_names IS DISTINCT FROM EXCLUDED.normalized_names;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM lmc_diet_evidence d
    CROSS JOIN LATERAL jsonb_array_elements_text(d.doc->'normalized_names') n
    WHERE NOT EXISTS (SELECT 1 FROM public.recipe_dietary_pref j JOIN public.dietary_pref p ON p.id=j.preference_id
      WHERE j.recipe_id=(d.doc->>'recipe_id')::uuid AND lower(btrim(p.name))=n)) THEN
    RAISE EXCEPTION 'Diet repair validation failed; changes rolled back';
  END IF;
END;
$$;
SELECT count(*) AS recipes_with_verified_source_diet FROM lmc_diet_evidence;
COMMIT;
""".replace("__EXPECTED__", str(len(records))).replace("__ONTOLOGY__", ontology)
    return header + csv_buffer.getvalue() + body


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--expected-count", type=int, default=10000)
    parser.add_argument("--sql-output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.expected_count < 1:
        parser.error("Expected count must be positive")
    if args.sql_output.resolve() == args.input.resolve() or args.report and args.report.resolve() == args.input.resolve():
        parser.error("Outputs must not overwrite input")
    records, report = read_evidence(args.input, args.expected_count)
    args.sql_output.parent.mkdir(parents=True, exist_ok=True)
    args.sql_output.write_text(build_sql(records), encoding="utf-8")
    report.update({"input": str(args.input.resolve()), "generated_sql": str(args.sql_output.resolve()),
        "applied": False, "method": "Explicit source_jsonld.suitableForDiet URIs; no inferred diet tags"})
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
