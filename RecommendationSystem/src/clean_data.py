import os
from pathlib import Path
import pandas as pd
import re
import math
from bs4 import BeautifulSoup

def clean_html(text):
    if pd.isna(text):
        return ""
    return BeautifulSoup(str(text), "html.parser").get_text(separator=" ")

def normalize_text(text):
    text = clean_html(text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"[^\w\s]", "", text)
    return text.lower().strip()

def combine_fields(row):
    title = row.get("title", "")
    description = row.get("description", "")
    raw_time = row.get("time", 0)
    raw_servings = row.get("servings")
    def known_positive(value):
        try:
            if isinstance(value,bool) or pd.isna(value):return None
            number=float(value)
            return number if math.isfinite(number) and number>0 else None
        except (ValueError,TypeError,OverflowError):return None
    time,servings=known_positive(raw_time),known_positive(raw_servings)
    ingredients = row.get("ingredients", "")
    directions = row.get("directions", "")
    cuisines = row.get("cuisines", "")
    dietary_pref = row.get("dietary_pref", "")

    time_serving_info = (f'Source cooking time: {time:g} minutes.' if time is not None else 'Source cooking time not specified.')+' '+(f'Source servings: {servings:g}.' if servings is not None else 'Source servings not specified.')
    parts = [title, description, time_serving_info, f"Ingredients: {ingredients}", f"Directions: {directions}", f"Cuisines: {cuisines}", f"Dietary: {dietary_pref}"]
    cleaned = [normalize_text(p) for p in parts if pd.notna(p)]
    return " ".join(cleaned)

def clean_and_export(csv_path=None, output_path=None):
    data_dir = Path(os.getenv("RECOMMENDATION_DATA_DIR", "data"))
    data_dir.mkdir(parents=True, exist_ok=True)
    csv_path = csv_path or data_dir / "recipes.csv"
    output_path = output_path or data_dir / "recipes_cleaned.csv"
    df = pd.read_csv(csv_path)
    required = ["id", "title", "description", "time", "servings", "ingredients", "directions", "cuisines", "dietary_pref"]
    for col in required:
        if col not in df.columns:
            df[col] = ""
    df = df[df["id"].notnull()]  # Ensure ID exists
    df["combined_text"] = df.apply(combine_fields, axis=1) if not df.empty else pd.Series(dtype=str)
    df[["id", "combined_text"]].to_csv(output_path, index=False)
    print(f"✅ Cleaned data saved to {output_path}")

if __name__ == "__main__":
    clean_and_export()
