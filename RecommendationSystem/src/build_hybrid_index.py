"""Explicit public-only index maintenance CLI; never runs during app imports."""
import argparse
from datetime import datetime, timezone
import json
import sys
import time

from src.embedding_runtime import OllamaEmbeddingRuntime, EmbeddingRuntimeError
from src.hybrid_index import build_index, hybrid_status, HybridIndexError


def public_catalog_query():
    # Reuse the current, fail-closed demo/public predicate; never derive access
    # from a prior cache, CSV, model, source label or caller-provided recipe list.
    from src.local_ai import public_catalog_clause
    return '''SELECT r.id::text AS id, r.is_public, r.title, r.description, r.directions,
        coalesce(r.time,0) AS "cookingTime", coalesce(r.servings,0) AS servings,
        coalesce(r.view_count,0) AS "viewCount", coalesce(r.rating_average,0) AS "ratingAverage",
        coalesce(r.rating_count,0) AS "ratingCount",
        ARRAY(SELECT DISTINCT i.name FROM public.recipe_ingredients ri JOIN public.ingredients i
              ON i.id=ri.ingredient_id WHERE ri.recipe_id=r.id ORDER BY i.name) AS ingredients,
        ARRAY(SELECT DISTINCT c.name FROM public.recipe_cuisines rc JOIN public.cuisines c
              ON c.id=rc.cuisine_id WHERE rc.recipe_id=r.id ORDER BY c.name) AS cuisines,
        ARRAY(SELECT DISTINCT c.name FROM public.recipe_categories rc JOIN public.categories c
              ON c.id=rc.category_id WHERE rc.recipe_id=r.id ORDER BY c.name) AS categories,
        ARRAY(SELECT DISTINCT d.name FROM public.recipe_dietary_pref rd JOIN public.dietary_pref d
              ON d.id=rd.preference_id WHERE rd.recipe_id=r.id ORDER BY d.name) AS "dietaryPreferences"
        FROM public.recipe r WHERE ''' + public_catalog_clause() + " ORDER BY r.id ASC LIMIT :limit"


def fetch_public_documents(limit, engine=None):
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 50000:
        raise HybridIndexError("Public index fetch limit must be between 1 and 50000")
    from bs4 import BeautifulSoup
    from sqlalchemy import text
    from src.database import get_engine
    own_engine = engine is None
    engine = engine or get_engine()
    try:
        with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
            with connection.begin():
                connection.exec_driver_sql("SET TRANSACTION READ ONLY")
                rows = [dict(row) for row in connection.execute(text(public_catalog_query()), {"limit": limit}).mappings()]
        for row in rows:
            for field in ("title", "description", "directions"):
                row[field] = BeautifulSoup(row.get(field) or "", "html.parser").get_text(separator=" ", strip=True)
        return rows
    finally:
        if own_engine:
            engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=10000)
    parser.add_argument("--expected-count", type=int, help="Fail before embedding/publishing unless the public row count matches")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--index-dir")
    parser.add_argument("--expected-digest", help="Full actual /api/tags SHA-256 digest; must match every embedding batch")
    parser.add_argument("--timeout", type=float, default=90)
    parser.add_argument("--dry-run", action="store_true", help="Validate current public catalog/model only; do not publish")
    parser.add_argument("--no-resume", action="store_true", help="Start a separate staging build instead of resuming matching committed batches")
    args = parser.parse_args()
    if not 1 <= args.limit <= 50000 or not 1 <= args.batch_size <= 32:
        parser.error("Limit must be1..50000, batch size1..32")
    if args.expected_count is not None and not 1 <= args.expected_count <= args.limit:
        parser.error("Expected count must be1..limit")
    started = time.monotonic()
    try:
        runtime = OllamaEmbeddingRuntime(expected_digest=args.expected_digest, timeout=args.timeout)
        encoder = runtime.metadata(args.expected_digest)
        rows = fetch_public_documents(args.limit)
        if args.expected_count is not None and len(rows) != args.expected_count:
            raise HybridIndexError("Current public catalog does not match the explicitly required count")
        from src.hybrid_index import prepare_documents
        prepare_documents(rows)
        if args.dry_run:
            print(json.dumps({"status": "validated-not-built", "publicRecipes": len(rows),
                              "encoder": encoder, "existingIndex": hybrid_status(args.index_dir)}))
            return 0
        progress_at = [0]

        def progress(done, total):
            if done == total or done - progress_at[0] >= 128:
                print(json.dumps({"completed": done, "total": total}), file=sys.stderr, flush=True)
                progress_at[0] = done

        snapshot = build_index(rows, runtime, args.index_dir, args.batch_size,
                               expected_digest=encoder["digest"], progress=progress, resume=not args.no_resume)
        print(json.dumps({"status": "published", "generation": snapshot.manifest["generation"],
            "publicRecipes": len(snapshot.recipe_ids), "encoder": dict(snapshot.manifest["encoder"]),
            "documentFingerprint": snapshot.manifest["catalog"]["documentFingerprint"],
            "completedAt": datetime.now(timezone.utc).isoformat(), "seconds": time.monotonic() - started}))
        return 0
    except (HybridIndexError, EmbeddingRuntimeError) as error:
        # Messages are static validation failures, never DB passwords/recipe/user text.
        print(json.dumps({"status": "failed", "message": str(error),
                          "atomicPublication": True, "existingIndex": hybrid_status(args.index_dir)}), file=sys.stderr)
        return 1
    except Exception as error:
        # DB/driver/filesystem exceptions can contain credentials or source rows;
        # do not print their text or a traceback into a maintenance report.
        print(json.dumps({"status": "failed", "message": "Public index maintenance failed; check local services and retry.",
                          "failureType": type(error).__name__, "atomicPublication": True,
                          "existingIndex": hybrid_status(args.index_dir)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
