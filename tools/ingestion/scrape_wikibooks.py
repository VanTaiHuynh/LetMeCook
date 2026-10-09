#!/usr/bin/env python3
"""Extract attributable English recipes from an official Wikibooks XML dump.

No network traffic is performed. Install mwparserfromhell separately and set
PYTHONPATH if it lives outside the interpreter's normal site-packages.

Example:
  PYTHONPATH=work/python-libs python3 work/recipes/scrape_wikibooks.py \
      --dump work/recipes/enwikibooks.xml.bz2 --output work/recipes --limit 2000
"""
from __future__ import annotations

import argparse
import bz2
from collections import Counter
import csv
from fractions import Fraction
import hashlib
import html
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import quote, urlencode
import xml.etree.ElementTree as ET

import mwparserfromhell

SOURCE = "https://en.wikibooks.org"
LICENSE = "CC BY-SA 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
AUTHOR = "Wikibooks contributors"
CHANGE_NOTICE = "Adapted from Wikibooks; formatting and ingredient fields normalized."
HEADING = re.compile(r"^(={2,6})\s*(.*?)\s*\1\s*$", re.M)
INGREDIENT_HEADING = re.compile(r"^(ingredients?|components)(\b|$)", re.I)
METHOD_HEADING = re.compile(r"^(procedure|preparation|preparations|method|methods|directions|instructions|steps|cooking procedure|cooking instructions|preparation method|preparation instructions|to prepare)(\b|$)", re.I)
FRACTIONS = {"¼": "1/4", "½": "1/2", "¾": "3/4", "⅐": "1/7", "⅑": "1/9", "⅒": "1/10", "⅓": "1/3", "⅔": "2/3", "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6", "⅚": "5/6", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8"}
# Only spellings explicitly present in the source are normalized.
UNITS = {
    "tsp": "teaspoon", "tsp.": "teaspoon", "teaspoon": "teaspoon", "teaspoons": "teaspoon",
    "tbsp": "tablespoon", "tbsp.": "tablespoon", "tbsps": "tablespoon", "tablespoon": "tablespoon", "tablespoons": "tablespoon",
    "cup": "cup", "cups": "cup", "oz": "ounce", "oz.": "ounce", "ounce": "ounce", "ounces": "ounce",
    "lb": "pound", "lb.": "pound", "lbs": "pound", "pound": "pound", "pounds": "pound",
    "g": "gram", "gram": "gram", "grams": "gram", "kg": "kilogram", "kilogram": "kilogram", "kilograms": "kilogram",
    "ml": "millilitre", "milliliter": "millilitre", "milliliters": "millilitre", "millilitre": "millilitre", "millilitres": "millilitre",
    "l": "litre", "liter": "litre", "liters": "litre", "litre": "litre", "litres": "litre",
    "pinch": "pinch", "pinches": "pinch", "clove": "clove", "cloves": "clove", "slice": "slice", "slices": "slice",
    "can": "can", "cans": "can", "jar": "jar", "jars": "jar", "bunch": "bunch", "bunches": "bunch",
    "package": "package", "packages": "package", "packet": "packet", "packets": "packet", "stick": "stick", "sticks": "stick",
    "sprig": "sprig", "sprigs": "sprig", "pint": "pint", "pints": "pint", "quart": "quart", "quarts": "quart",
    "gallon": "gallon", "gallons": "gallon", "dash": "dash", "dashes": "dash",
}
CUISINES = {
    "american": ["united states", "american"], "british": ["united kingdom", "british", "england", "english", "scotland", "scottish"],
    "french": ["france", "french"], "italian": ["italy", "italian"], "chinese": ["china", "chinese"],
    "indian": ["india", "indian"], "japanese": ["japan", "japanese"], "korean": ["korea", "korean"],
    "mexican": ["mexico", "mexican"], "thai": ["thailand", "thai"], "vietnamese": ["vietnam", "vietnamese"],
    "greek": ["greece", "greek"], "spanish": ["spain", "spanish"], "turkish": ["turkey", "turkish"],
    "nigerian": ["nigeria", "nigerian"], "ethiopian": ["ethiopia", "ethiopian"], "moroccan": ["morocco", "moroccan"],
    "ghanaian": ["ghana", "ghanaian"], "cameroonian": ["cameroon", "cameroonian"], "rwandan": ["rwanda", "rwandan"],
    "kenyan": ["kenya", "kenyan"], "filipino": ["philippines", "philippine", "filipino"],
    "indonesian": ["indonesia", "indonesian"], "malaysian": ["malaysia", "malaysian"], "canadian": ["canada", "canadian"],
    "german": ["germany", "german"], "polish": ["poland", "polish"], "portuguese": ["portugal", "portuguese"],
    "brazilian": ["brazil", "brazilian"], "peruvian": ["peru", "peruvian"], "lebanese": ["lebanon", "lebanese"],
}
DISH_CATEGORIES = {
    "breakfast": ["breakfast"], "dessert": ["dessert", "desserts"], "appetizer": ["appetizer", "appetizers", "appetiser", "appetisers"],
    "snack": ["snack", "snacks"], "bread": ["bread", "breads"], "drink": ["drink", "drinks", "beverage", "beverages"],
    "soup": ["soup", "soups"], "salad": ["salad", "salads"], "main course": ["main course", "main courses", "main dish", "main dishes"],
    "side dish": ["side dish", "side dishes"], "sauce": ["sauce", "sauces"], "cake": ["cake", "cakes"], "cookie": ["cookie", "cookies", "biscuits"],
}
DIETS = {
    "vegan": ["vegan"], "vegetarian": ["vegetarian"], "gluten free": ["gluten-free", "gluten free"],
    "dairy free": ["dairy-free", "dairy free"], "kosher": ["kosher"], "halal": ["halal"],
}


def plain_text(value: str, *, keep_newlines: bool = False) -> str:
    """Strip wiki markup while retaining meaningful template parameter text."""
    code = mwparserfromhell.parse(value)
    for tag in list(code.filter_tags(recursive=True)):
        if str(tag.tag).strip().lower() in {"ref", "references", "gallery", "noinclude", "script", "style"}:
            try:
                code.replace(tag, "")
            except ValueError:
                pass
    for link in list(code.filter_wikilinks(recursive=True)):
        if re.match(r"^\s*:?(category|file|image)\s*:", str(link.title), re.I):
            try:
                code.replace(link, "")
            except ValueError:
                pass
    for template in list(reversed(code.filter_templates(recursive=True))):
        name = str(template.name).strip().lower().replace("template:", "")
        params = [str(p.value).strip() for p in template.params if str(p.name).strip().isdigit()]
        replacement = None
        if name in {"frac", "fraction"}:
            if len(params) >= 3:
                replacement = f"{params[0]} {params[1]}/{params[2]}"
            elif len(params) == 2:
                replacement = f"{params[0]}/{params[1]}"
            elif len(params) == 1:
                replacement = f"1/{params[0]}"
        elif name in {"convert", "cvt"} and len(params) >= 2:
            replacement = " ".join(params[:2])
        elif name in {"lang", "color", "font color"} and len(params) >= 2:
            replacement = params[-1]
        elif name in {"nowrap", "nobr", "small", "large", "larger", "plainlist"} and params:
            replacement = " ".join(params)
        elif name in {"cookbook", "recipe", "recipe summary", "recipebox", "recipe box", "cookbook recipe", "infobox recipe", "commons", "commonscat", "wikipedia", "cookbook navigation", "cookbook header", "cookbookfooter", "cookbookfooter2", "cookbook footer", "cookbook top", "cookbook-bottom", "clear", "reflist", "notelist", "stub", "cookbookstub"} or name.startswith("cookbook/"):
            replacement = ""
        if replacement is not None:
            try:
                code.replace(template, replacement)
            except ValueError:
                pass
    result = html.unescape(code.strip_code(normalize=True, collapse=False, keep_template_params=True))
    result = re.sub(r"\bCookbook:", "", result)
    result = result.replace("\u00a0", " ").replace("\u200b", "")
    if keep_newlines:
        return "\n".join(re.sub(r"[ \t]+", " ", line).strip() for line in result.splitlines()).strip()
    return re.sub(r"\s+", " ", result).strip()


def section_content(text: str, heading_pattern: re.Pattern) -> tuple[str, str] | None:
    headings = list(HEADING.finditer(text))
    for i, heading in enumerate(headings):
        heading_name = plain_text(heading[2])
        if heading_pattern.search(heading_name):
            end = len(text)
            for nxt in headings[i + 1:]:
                if len(nxt[1]) <= len(heading[1]):
                    end = nxt.start()
                    break
            return heading_name, text[heading.end():end].strip()
    return None


def section_items(text: str, *, ingredients: bool) -> list[dict]:
    items, group, current, paragraphs = [], "", None, []
    def flush_paragraph():
        nonlocal paragraphs
        if paragraphs:
            raw = " ".join(paragraphs).strip()
            cleaned = plain_text(raw)
            if cleaned:
                items.append({"text": cleaned, "raw": raw, "group": group})
            paragraphs = []
    for line in text.splitlines():
        if not line.strip():
            if not ingredients:
                flush_paragraph()
            current = None
            continue
        heading = HEADING.fullmatch(line.strip())
        if heading:
            if not ingredients:
                flush_paragraph()
            group, current = plain_text(heading[2]), None
            continue
        match = re.match(r"^\s*([*#]+)\s*(.+)$", line)
        if match:
            if not ingredients:
                flush_paragraph()
            raw = match[2].strip()
            cleaned = plain_text(raw)
            if cleaned and not cleaned.endswith(":"):
                current = {"text": cleaned, "raw": raw, "group": group}
                items.append(current)
            elif cleaned:
                group, current = cleaned.rstrip(":"), None
        elif current is not None and line.lstrip().startswith((":", " ")):
            raw = re.sub(r"^\s*[:*#]+\s*", "", line).strip()
            cleaned = plain_text(raw)
            if cleaned:
                current["text"] += " " + cleaned
                current["raw"] += "\n" + raw
        elif ingredients:
            cleaned = plain_text(line)
            if cleaned.endswith(":"):
                group, current = cleaned.rstrip(":"), None
        elif not line.lstrip().startswith(("{{", "[[Category:", "{|", "|", "}}", "<!--")):
            paragraphs.append(line.strip())
    if not ingredients:
        flush_paragraph()
    return items


def number_value(value: str) -> float | None:
    value = value.strip().replace("⁄", "/")
    try:
        parts = value.split()
        result = sum(float(Fraction(part)) for part in parts)
        return round(result, 6)
    except (ValueError, ZeroDivisionError):
        return None


def parse_ingredient(item: dict) -> dict:
    text = item["text"]
    expanded = text
    for symbol, fraction in FRACTIONS.items():
        expanded = re.sub(rf"(?<=\d){re.escape(symbol)}", " " + fraction, expanded)
        expanded = expanded.replace(symbol, fraction)
    quantity, unit, name = None, "", text
    # Quantity ranges, approximate quantities, and dual measures are preserved raw.
    match = re.match(r"^(\d+(?:\.\d+)?(?:\s+\d+/\d+|/\d+)?)\s+(.+)$", expanded)
    if match and not re.match(r"^[–—\-]|^(to|or)\s+\d", match[2], re.I):
        quantity = number_value(match[1])
        rest = match[2].strip()
        unit_match = re.match(r"^([A-Za-z.]+)\s+(.+)$", rest)
        if unit_match and unit_match[1].lower() in UNITS:
            unit = UNITS[unit_match[1].lower()]
            name = re.sub(r"^of\s+", "", unit_match[2], flags=re.I).strip()
        else:
            name = rest
    if not name:
        quantity, unit, name = None, "", text
    return {"name": name, "quantity": quantity, "unit": unit, "original_text": text, "source_wikitext": item["raw"], "group": item["group"] or None}


def metadata(code) -> dict[str, str]:
    result = {}
    for template in code.filter_templates(recursive=False):
        name = str(template.name).strip().lower().replace("template:", "")
        if name in {"cookbook", "recipe", "recipe summary", "recipebox", "recipe box", "cookbook recipe", "infobox recipe"}:
            for param in template.params:
                key = str(param.name).strip().lower().replace("_", " ")
                result[key] = str(param.value).strip()
    return result


def source_categories(code) -> list[str]:
    return sorted({str(link.title).strip().split(":", 1)[1].replace("_", " ").strip() for link in code.filter_wikilinks() if re.match(r"^\s*Category\s*:", str(link.title), re.I)})


def image_filenames(code, meta: dict) -> list[str]:
    candidates = []
    for key in ("image", "image1", "image file", "imagefile", "picture", "photo"):
        value = meta.get(key, "")
        if value:
            candidates.append(value)
    candidates.extend(str(link.title) for link in code.filter_wikilinks() if re.match(r"^\s*(File|Image)\s*:", str(link.title), re.I))
    names = []
    for candidate in candidates:
        m = re.search(r"(?:File:|Image:|\[\[)?([^\[\]{}|\n]+?\.(?:jpe?g|png|webp|gif))(?=[\]|\s]*|$)", candidate, re.I)
        if not m:
            continue
        name = re.sub(r"^\s*(File|Image)\s*:\s*", "", m[1], flags=re.I).strip().replace("_", " ")
        if name.lower().startswith(("http:", "https:")) or re.search(r"(wikibooks|wikimedia|logo|^flag|^icon|stub)", name, re.I):
            continue
        if name and name not in names:
            names.append(name)
    return names


def known_tags(categories: list[str], meta: dict) -> tuple[list[str], list[str], list[str]]:
    tags = [cat.lower().strip() for cat in categories]
    tags += [plain_text(meta[key]).lower().strip() for key in ("category", "categories", "cuisine", "country", "origin", "diet", "dietary") if meta.get(key)]
    cuisines, dishes, diets = set(), set(), set()
    for tag in tags:
        for cuisine, names in CUISINES.items():
            if any(tag in {name, f"{name} recipes", f"{name} cuisine", f"recipes from {name}", f"recipes of {name}", f"cuisine of {name}"} for name in names):
                cuisines.add(cuisine)
        for dish, names in DISH_CATEGORIES.items():
            if any(tag in {name, f"{name} recipes", f"recipes for {name}"} for name in names):
                dishes.add(dish)
        for diet, names in DIETS.items():
            if any(tag in {name, f"{name} recipes", f"recipes for {name}"} for name in names):
                diets.add(diet)
    return sorted(cuisines), sorted(dishes), sorted(diets)


def time_minutes(meta: dict) -> tuple[float | None, str | None]:
    for key in ("time", "total time", "totaltime", "cooking time", "cooktime", "minutes"):
        if not meta.get(key):
            continue
        text = plain_text(meta[key])
        # Explicit source ranges or overnight instructions are not replaced by estimates.
        if re.search(r"\d\s*[-–—]\s*\d|\d\s+(to|or)\s+\d", text, re.I):
            return None, text
        matches = list(re.finditer(r"(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b", text, re.I))
        if matches:
            return sum(float(m[1]) * (60 if m[2].lower().startswith("h") else 1) for m in matches), text
        if key == "minutes" and re.fullmatch(r"\d+(?:\.\d+)?", text):
            return float(text), text
        return None, text
    return None, None


def servings_value(meta: dict) -> tuple[float | None, str | None]:
    for key in ("servings", "serves", "serving", "yield"):
        if not meta.get(key):
            continue
        text = plain_text(meta[key])
        if re.search(r"\d\s*[-–—]\s*\d|\d\s+(to|or)\s+\d", text, re.I):
            return None, text
        # 'Yield' units such as 2 litres are not an asserted number of servings.
        if key == "yield" and not re.search(r"servings?|people|persons?", text, re.I):
            return None, text
        match = re.match(r"^(?:[Ss]erves?\s+)?(\d+(?:\.\d+)?)(?:\s|$)", text)
        return (float(match[1]) if match else None), text
    return None, None


def extract_page(page) -> tuple[dict | None, str]:
    get = lambda name: page.findtext(f"{{*}}{name}")
    title, ns, page_id = get("title") or "", get("ns") or "", get("id") or ""
    if not title.startswith("Cookbook:") or ns != "102":
        return None, "not_cookbook_namespace"
    if page.find("{*}redirect") is not None:
        return None, "redirect"
    revision = page.find("{*}revision")
    if revision is None:
        return None, "missing_revision"
    text = revision.findtext("{*}text") or ""
    if re.match(r"\s*#redirect\b", text, re.I):
        return None, "redirect"
    ingredient_section = section_content(text, INGREDIENT_HEADING)
    method_section = section_content(text, METHOD_HEADING)
    if not ingredient_section or not method_section:
        return None, "missing_ingredient_or_method_section"
    code = mwparserfromhell.parse(text)
    meta, categories = metadata(code), source_categories(code)
    recipe_category = any(cat.lower() == "recipes" or re.search(r"\brecipes\b", cat, re.I) for cat in categories)
    infobox_recipe = any(str(t.name).strip().lower() in {"cookbook", "recipe", "recipe summary", "recipebox", "recipe box", "cookbook recipe", "infobox recipe"} for t in code.filter_templates(recursive=False))
    if not recipe_category and not infobox_recipe:
        return None, "not_classified_as_recipe"
    raw_ingredients = section_items(ingredient_section[1], ingredients=True)
    instructions = section_items(method_section[1], ingredients=False)
    ingredients = [parse_ingredient(item) for item in raw_ingredients if len(item["text"]) >= 2]
    # Reject stubs, indexes, and incomplete source pages rather than pad the dataset.
    if len(ingredients) < 2:
        return None, "insufficient_ingredients"
    instructions = [item for item in instructions if len(item["text"]) >= 12]
    if not instructions or sum(len(item["text"]) for item in instructions) < 60:
        return None, "insufficient_instructions"
    if any(token in title.lower() for token in ("/print version", "/printable version", "/policy", "/recipe template")):
        return None, "non_recipe_page"
    first_heading = HEADING.search(text)
    description = plain_text(text[:first_heading.start()] if first_heading else "", keep_newlines=True)
    # Keep all lead attribution/notices rather than invent a marketing description.
    revision_id = revision.findtext("{*}id") or ""
    cuisines, dishes, diets = known_tags(categories, meta)
    minutes, time_text = time_minutes(meta)
    servings, servings_text = servings_value(meta)
    files = image_filenames(code, meta)
    result = {
        "title": title.split(":", 1)[1].replace("_", " "),
        "description": description,
        "ingredients": ingredients,
        "directions": [f"{item['group']}: {item['text']}" if item["group"] else item["text"] for item in instructions],
        "directions_source_wikitext": [item["raw"] for item in instructions],
        "time_minutes": minutes,
        "time_source_text": time_text,
        "servings": servings,
        "servings_source_text": servings_text,
        "cuisines": cuisines,
        "categories": dishes,
        "dietary_preferences": diets,
        "source_categories": categories,
        "source_metadata": meta,
        "image_source_filename": files[0] if files else None,
        "image_source_filenames": files,
        "image_reuse_verified": False,
        "source_url": f"{SOURCE}/wiki/{quote(title.replace(' ', '_'), safe=':()')}",
        "source_revision_url": f"{SOURCE}/w/index.php?{urlencode({'title': title, 'oldid': revision_id})}",
        "source_history_url": f"{SOURCE}/w/index.php?{urlencode({'title': title, 'action': 'history'})}",
        "source_page_id": int(page_id),
        "source_revision_id": int(revision_id) if revision_id else None,
        "source_revision_timestamp": revision.findtext("{*}timestamp"),
        "source_author": AUTHOR,
        "source_license": LICENSE,
        "source_license_url": LICENSE_URL,
        "source_changes": CHANGE_NOTICE,
        "source_wikitext": text,
    }
    return result, "eligible"


def write_jsonl(path: Path, records: list[dict]):
    with path.open("w", encoding="utf-8") as stream:
        for record in records:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dump", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=2000)
    parser.add_argument("--source-dump-url", default="https://dumps.wikimedia.org/enwikibooks/latest/enwikibooks-latest-pages-articles.xml.bz2")
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("--limit must be positive")
    args.output.mkdir(parents=True, exist_ok=True)
    records, seen_ids, seen_titles, counters = [], set(), set(), Counter()
    started = time.monotonic()
    print(f"Reading {args.dump} offline", flush=True)
    opener = bz2.open if args.dump.suffix == ".bz2" else open
    with opener(args.dump, "rb") as source:
        context = ET.iterparse(source, events=("start", "end"))
        _, root = next(context)
        for event, element in context:
            if event != "end" or element.tag.rsplit("}", 1)[-1] != "page":
                continue
            counters["pages_scanned"] += 1
            try:
                record, status = extract_page(element)
            except (ValueError, TypeError, OverflowError) as error:
                counters["parse_error"] += 1
                print(f"Rejected page {element.findtext('{*}title')!r}: {error}", file=sys.stderr, flush=True)
                record, status = None, None
            if status:
                counters[status] += 1
            if record:
                title_key = record["title"].casefold()
                if record["source_page_id"] in seen_ids or title_key in seen_titles:
                    counters["duplicate_source_or_title"] += 1
                else:
                    seen_ids.add(record["source_page_id"])
                    seen_titles.add(title_key)
                    records.append(record)
            # Release parsed wiki pages, including revision text, as soon as processed.
            element.clear()
            root.clear()
            if counters["pages_scanned"] % 20000 == 0:
                print(f"Scanned {counters['pages_scanned']:,} pages; eligible {len(records):,}", flush=True)
    # Prefer actual source image references, then a deterministic diverse sample.
    records.sort(key=lambda r: (not bool(r["image_source_filename"]), hashlib.sha256(str(r["source_page_id"]).encode()).hexdigest()))
    selected = records[:args.limit]
    write_jsonl(args.output / "all-recipes.jsonl", records)
    summary = {
        "source": "English Wikibooks Cookbook",
        "source_dump_url": args.source_dump_url,
        "source_dump_file": str(args.dump),
        "source_dump_bytes": args.dump.stat().st_size,
        "source_license": LICENSE,
        "source_license_url": LICENSE_URL,
        "source_author": AUTHOR,
        "source_changes": CHANGE_NOTICE,
        "counters": dict(sorted(counters.items())),
        "eligible_unique_recipes": len(records),
        "eligible_with_source_image_filename": sum(bool(r["image_source_filename"]) for r in records),
        "selected_recipes": len(selected),
        "selected_with_source_image_filename": sum(bool(r["image_source_filename"]) for r in selected),
        "requested_recipes": args.limit,
        "missing_time_selected": sum(r["time_minutes"] is None for r in selected),
        "missing_servings_selected": sum(r["servings"] is None for r in selected),
        "image_downloads": 0,
        "selection": "Source image references first, then deterministic SHA256 ordering of source page IDs",
        "elapsed_seconds": round(time.monotonic() - started, 2),
        "complete": len(selected) == args.limit,
    }
    (args.output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.output / "LICENSE-SOURCE.txt").write_text(
        f"Imported recipe text: {LICENSE}\n{LICENSE_URL}\nAttribution: {AUTHOR}, source URL and history per recipe.\n"
        f"{CHANGE_NOTICE}\nSource licensing policy: {SOURCE}/wiki/Wikibooks:Copyrights\n"
        "Original contributor notices and complete source wikitext are retained in each record.\n"
        "Source image filenames are unverified references only; no image is downloaded or assumed licensed.\n",
        encoding="utf-8",
    )
    if len(selected) != args.limit:
        print(f"FAIL: Only {len(selected):,} qualified recipes, requested {args.limit:,}. Full candidates saved; no final recipes.jsonl produced.", file=sys.stderr, flush=True)
        return 2
    write_jsonl(args.output / "recipes.jsonl", selected)
    with (args.output / "recipes.csv").open("w", encoding="utf-8", newline="") as stream:
        fields = ["title", "description", "ingredients", "directions", "time_minutes", "servings", "cuisines", "categories", "dietary_preferences", "image_source_filename", "source_url", "source_revision_url", "source_history_url", "source_author", "source_license", "source_license_url", "source_changes"]
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for record in selected:
            writer.writerow({key: json.dumps(record[key], ensure_ascii=False) if isinstance(record[key], (list, dict)) else record[key] for key in fields})
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
