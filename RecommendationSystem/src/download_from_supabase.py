"""Export recipe data from local Supabase without contacting the hosted project."""
import os
from pathlib import Path
import re

from bs4 import BeautifulSoup
import pandas as pd
from sqlalchemy import text
from src.database import get_engine
from src.local_ai import public_catalog_clause
from src.legacy_cache_store import writer_lock


def clean_html_completely(html):
    if not html:
        return ""
    soup = BeautifulSoup(str(html), "html.parser")
    for anchor in soup.find_all("a"):
        anchor.decompose()
    return re.sub(r"\s+", " ", soup.get_text(separator=" ", strip=True)).strip()


QUERY = """
  SELECT
    r.id, r.title, r.description, r.directions, r.time, r.servings,
    STRING_AGG(DISTINCT cu.name, ', ') AS cuisines,
    STRING_AGG(DISTINCT ing.name, ', ') AS ingredients,
    STRING_AGG(DISTINCT d_pref.name, ', ') AS dietary_pref
  FROM recipe r
  LEFT JOIN recipe_cuisines re_cu ON r.id = re_cu.recipe_id
  LEFT JOIN cuisines cu ON re_cu.cuisine_id = cu.id
  LEFT JOIN recipe_ingredients re_in ON r.id = re_in.recipe_id
  LEFT JOIN ingredients ing ON re_in.ingredient_id = ing.id
  LEFT JOIN recipe_dietary_pref re_pref ON r.id = re_pref.recipe_id
  LEFT JOIN dietary_pref d_pref ON re_pref.preference_id = d_pref.id
  WHERE """ + public_catalog_clause('r') + """
  GROUP BY r.id, r.title, r.description, r.directions, r.time, r.servings
  ORDER BY r.id
"""


def export_recipes(output_path=None):
    with writer_lock():
        return _export_recipes(output_path)


def _export_recipes(output_path=None):
    # This is a direct Postgres query, so Supabase REST's row limit does not apply.
    # Fetch all rows in chunks; there is deliberately no SQL LIMIT/early break.
    batch_size = max(1, int(os.getenv("RECIPE_EXPORT_BATCH_SIZE", "1000")))
    data_dir = Path(os.getenv("RECOMMENDATION_DATA_DIR", "data"))
    data_dir.mkdir(parents=True, exist_ok=True)
    output = Path(output_path) if output_path else data_dir / "recipes.csv"
    output.parent.mkdir(parents=True,exist_ok=True)
    temporary = output.with_suffix(".csv.tmp")
    columns = ["id", "title", "description", "directions", "time", "servings", "cuisines", "ingredients", "dietary_pref"]
    count = 0
    wrote_header = False
    engine = get_engine()
    try:
        with engine.connect() as connection:
            connection = connection.execution_options(isolation_level='REPEATABLE READ',stream_results=True, max_row_buffer=batch_size)
            for df in pd.read_sql(text(QUERY), connection, chunksize=batch_size):
                df = df[df["id"].notnull()]
                for col in ["title", "description", "directions"]:
                    df[col] = df[col].fillna("").apply(clean_html_completely)
                for col in ["cuisines", "ingredients", "dietary_pref"]:
                    df[col] = df[col].fillna("")
                df.to_csv(temporary, mode="a" if wrote_header else "w", header=not wrote_header,
                          index=False, encoding="utf-8")
                wrote_header = True
                count += len(df)
        if not wrote_header:
            pd.DataFrame(columns=columns).to_csv(temporary, index=False, encoding="utf-8")
        temporary.replace(output)
    finally:
        engine.dispose()
        temporary.unlink(missing_ok=True)
    print(f"Exported {count} recipes from local Supabase")
    return count


if __name__ == "__main__":
    export_recipes()
