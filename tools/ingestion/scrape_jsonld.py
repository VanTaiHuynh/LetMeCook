#!/usr/bin/env python3
"""Import public Good Food recipe JSON-LD with the page's original image URL.

Only public recipe pages and published sitemaps are requested. No authentication,
API endpoints, alternate identities, or paywall circumvention is used. The
scraper stops when a page responds 403, obeys Retry-After, and saves each success
so an interrupted run can resume. Photos are downloaded by a separate verifier.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, FIRST_COMPLETED, wait
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
import hashlib
import html
import json
from pathlib import Path
import re
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from scrape_wikibooks import parse_ingredient

HOSTS = {"bbcgoodfood.com", "www.bbcgoodfood.com"}
USER_AGENT = "LetMeCookLocalRecipeImporter/1.0 (local recipe library)"
LICENSE = "Original source — all rights reserved"
CATEGORIES = {"breakfast", "brunch", "lunch", "dinner", "main course", "side dish", "dessert", "snack", "appetizer", "appetiser", "drink", "soup", "salad", "bread", "sauce"}


class BlockedAccess(RuntimeError):
    pass


class RateLimiter:
    def __init__(self, interval: float):
        self.interval, self.next_time, self.lock = interval, 0.0, threading.Lock()
        self.stop = threading.Event()

    def acquire(self):
        with self.lock:
            delay = max(0, self.next_time - time.monotonic())
            if self.stop.wait(delay):
                raise BlockedAccess("Scraper stopped")
            self.next_time = time.monotonic() + self.interval

    def backoff(self, seconds: float):
        with self.lock:
            self.next_time = max(self.next_time, time.monotonic() + seconds)


def retry_delay(value: str | None, fallback: float) -> float:
    if not value:
        return fallback
    try:
        return max(0, float(value))
    except ValueError:
        try:
            stamp = parsedate_to_datetime(value)
            return max(0, (stamp - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError):
            return fallback


def fetch(url: str, limiter: RateLimiter, *, attempts: int = 4) -> tuple[str, str]:
    if urlparse(url).hostname not in HOSTS:
        raise ValueError("Unexpected source host")
    for attempt in range(attempts):
        limiter.acquire()
        request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xml;q=0.9,*/*;q=0.5"})
        try:
            with urlopen(request, timeout=45) as response:
                final_url = response.geturl()
                if urlparse(final_url).hostname not in HOSTS:
                    raise ValueError("Redirected outside the source website")
                encoding = response.headers.get_content_charset() or "utf-8"
                body = response.read(8 * 1024 * 1024 + 1)
                if len(body) > 8 * 1024 * 1024:
                    raise ValueError("Source response exceeds 8 MiB")
                return body.decode(encoding, errors="replace"), final_url
        except HTTPError as error:
            if error.code in {401, 403}:
                limiter.stop.set()
                raise BlockedAccess(f"HTTP {error.code} for {url}") from error
            if error.code == 429:
                delay = retry_delay(error.headers.get("Retry-After"), 30 * (attempt + 1))
                limiter.backoff(delay)
                print(f"HTTP 429: waiting {delay:.1f}s before any further requests", flush=True)
                if attempt + 1 < attempts:
                    continue
            elif 500 <= error.code <= 599 and attempt + 1 < attempts:
                limiter.backoff(2 ** (attempt + 1))
                continue
            raise
        except (URLError, TimeoutError):
            if attempt + 1 >= attempts:
                raise
            limiter.backoff(2 ** (attempt + 1))
    raise RuntimeError("Request retries exhausted")


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.scripts, self.canonical, self.visible = [], None, []
        self.script_buffer, self.in_json = [], False
        self.skip_depth, self.script_depth = 0, 0

    def handle_starttag(self, tag, attrs):
        attr = dict(attrs)
        if tag == "script":
            self.script_depth += 1
            if attr.get("type", "").lower() == "application/ld+json":
                self.in_json, self.script_buffer = True, []
        if tag == "link" and attr.get("rel", "").lower() == "canonical":
            self.canonical = attr.get("href")
        if tag in {"style", "svg", "noscript", "footer", "nav"}:
            self.skip_depth += 1

    def handle_endtag(self, tag):
        if tag == "script":
            if self.in_json:
                self.scripts.append("".join(self.script_buffer))
                self.in_json, self.script_buffer = False, []
            self.script_depth = max(0, self.script_depth - 1)
        if tag in {"style", "svg", "noscript", "footer", "nav"}:
            self.skip_depth = max(0, self.skip_depth - 1)

    def handle_data(self, data):
        if self.in_json:
            self.script_buffer.append(data)
        elif not self.skip_depth and not self.script_depth:
            self.visible.append(data)


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in {"br", "p", "li"}:
            self.parts.append(" ")


def text(value) -> str:
    parser = TextParser()
    parser.feed(html.unescape(str(value or "")))
    return re.sub(r"\s+", " ", "".join(parser.parts)).strip()


def walk_json(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_json(child)


def as_values(value) -> list:
    return value if isinstance(value, list) else [value] if value is not None else []


def has_type(value: dict, wanted: str) -> bool:
    return any(str(t).rsplit("/", 1)[-1] == wanted for t in as_values(value.get("@type")))


def flatten_steps(value, group="") -> list[str]:
    steps = []
    for item in as_values(value):
        if isinstance(item, str):
            clean = text(item)
            if clean:
                steps.append(clean)
        elif isinstance(item, dict):
            if item.get("itemListElement"):
                steps.extend(flatten_steps(item["itemListElement"], text(item.get("name")) or group))
            elif item.get("text") or item.get("description"):
                clean = text(item.get("text") or item.get("description"))
                if clean:
                    steps.append(f"{group}: {clean}" if group else clean)
    return steps


def iso_minutes(value) -> float | None:
    if not value:
        return None
    match = re.fullmatch(r"P(?:(\d+(?:\.\d+)?)D)?T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?", str(value), re.I)
    if not match:
        return None
    days, hours, minutes, seconds = [float(p or 0) for p in match.groups()]
    return round(days * 1440 + hours * 60 + minutes + seconds / 60, 4)


def yield_servings(value) -> tuple[float | None, str]:
    original = "; ".join(text(v) for v in as_values(value))
    for item in as_values(value):
        clean = text(item)
        # Do not substitute the midpoint of a range or confuse a liquid yield with servings.
        if re.search(r"\d\s*[-–—]\s*\d|\d\s+(to|or)\s+\d", clean, re.I):
            continue
        m = re.fullmatch(r"(?:serves?\s+)?(\d+(?:\.\d+)?)\s*(?:servings?|people|persons?)?", clean, re.I)
        if m:
            return float(m[1]), original
    return None, original


def recipe_image(value) -> tuple[str | None, str | None]:
    for item in as_values(value):
        if isinstance(item, str):
            url, author = item, None
        elif isinstance(item, dict):
            url, author = item.get("contentUrl") or item.get("url"), item.get("author") or item.get("creator")
            if isinstance(author, dict):
                author = text(author.get("name"))
            elif author:
                author = text(author)
        else:
            continue
        if isinstance(url, str) and urlparse(url).scheme in {"http", "https"}:
            return url, author
    return None, None


def author_names(value) -> str:
    names = []
    for item in as_values(value):
        name = text(item.get("name")) if isinstance(item, dict) else text(item)
        if name and name not in names:
            names.append(name)
    return ", ".join(names) or "Good Food"


def parse_page(body: str, request_url: str) -> tuple[dict | None, str]:
    page = PageParser()
    page.feed(body)
    recipes = []
    for raw in page.scripts:
        try:
            document = json.loads(raw)
        except json.JSONDecodeError:
            continue
        recipes.extend(node for node in walk_json(document) if has_type(node, "Recipe") and node.get("recipeIngredient"))
    if not recipes:
        return None, "no_recipe_jsonld"
    recipe = recipes[0]
    accessible = recipe.get("isAccessibleForFree")
    if accessible is False or str(accessible).lower() in {"false", "0"}:
        return None, "paid_recipe"
    visible = " ".join(page.visible)
    if re.search(r"this recipe is (?:exclusive|only available)|unlock this recipe|subscriber[- ]only recipe|app[- ]only recipe", visible, re.I):
        return None, "restricted_recipe"
    source_url = page.canonical or recipe.get("url") or request_url
    if not isinstance(source_url, str) or not allowed_recipe_url(source_url):
        return None, "unexpected_canonical"
    ingredient_text = [text(item) for item in as_values(recipe.get("recipeIngredient")) if text(item)]
    directions = flatten_steps(recipe.get("recipeInstructions"))
    name = text(recipe.get("name"))
    image_url, image_author = recipe_image(recipe.get("image"))
    if not name or len(ingredient_text) < 2 or not directions or sum(map(len, directions)) < 60:
        return None, "incomplete_recipe"
    if not image_url:
        return None, "missing_original_image"
    ingredients = []
    for original in ingredient_text:
        # Common JSON-LD quantities include adjacent units: 100g, 300ml, ½tsp.
        normalized = re.sub(r"(?<=\d)(?=(?:kg|mg|ml|cl|g|l|oz|lb|tsp|tbsp)\b)", " ", original, flags=re.I)
        item = parse_ingredient({"text": normalized, "raw": original, "group": ""})
        item["original_text"] = original
        item.pop("source_wikitext", None)
        ingredients.append(item)
    total = iso_minutes(recipe.get("totalTime"))
    prep, cook = iso_minutes(recipe.get("prepTime")), iso_minutes(recipe.get("cookTime"))
    if total is None and (prep is not None or cook is not None):
        total = (prep or 0) + (cook or 0)
    servings, servings_text = yield_servings(recipe.get("recipeYield"))
    categories = sorted({part.lower().strip() for value in as_values(recipe.get("recipeCategory")) for part in str(value).split(",") if part.lower().strip() in CATEGORIES})
    cuisines = sorted({part.lower().strip() for value in as_values(recipe.get("recipeCuisine")) for part in str(value).split(",") if part.strip()})
    diet_map = {"VeganDiet": "vegan", "VegetarianDiet": "vegetarian", "GlutenFreeDiet": "gluten free", "LowLactoseDiet": "low lactose", "HalalDiet": "halal", "KosherDiet": "kosher"}
    diets = sorted({diet_map[str(value).rsplit("/", 1)[-1]] for value in as_values(recipe.get("suitableForDiet")) if str(value).rsplit("/", 1)[-1] in diet_map})
    category_phrase = categories[0].capitalize() if categories else "Recipe"
    description = f"{category_phrase} with {len(ingredients)} ingredients."
    return {
        "title": name, "description": description, "ingredients": ingredients,
        "directions": directions, "time_minutes": total, "prep_time_minutes": prep, "cook_time_minutes": cook,
        "servings": servings, "servings_source_text": servings_text,
        "cuisines": cuisines, "categories": categories, "dietary_preferences": diets,
        "source_url": source_url.split("#", 1)[0], "source_author": author_names(recipe.get("author")),
        "source_license": LICENSE, "source_license_url": None,
        "source_changes": "Description summarized; formatting and ingredient fields normalized.",
        "source_publisher": "Good Food", "source_published": recipe.get("datePublished"), "source_modified": recipe.get("dateModified"),
        "image_source_url": image_url, "image_author": image_author, "image_publisher": "Good Food",
        "image_license": LICENSE, "image_kind": "source", "image_source_verified_from": "recipe JSON-LD image property",
        "image_local_path": None,
        "source_jsonld": recipe,
    }, "eligible"


def allowed_recipe_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.hostname in HOSTS and bool(re.fullmatch(r"/recipes/[^/]+/?", parsed.path)) and not parsed.query


def sitemap_urls(sources: list[str], limiter: RateLimiter, cache_dir: Path) -> list[str]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    recipes, visited = set(), set()
    queue = list(sources)
    while queue:
        location = queue.pop(0)
        if location in visited:
            continue
        visited.add(location)
        if location.startswith(("http://", "https://")):
            cache_path = cache_dir / (hashlib.sha256(location.encode()).hexdigest() + ".xml")
            if cache_path.exists():
                body = cache_path.read_text(encoding="utf-8")
            else:
                body, _ = fetch(location, limiter)
                cache_path.write_text(body, encoding="utf-8")
        else:
            body = Path(location).read_text(encoding="utf-8")
        root = ET.fromstring(body)
        is_index = root.tag.rsplit("}", 1)[-1] == "sitemapindex"
        for element in root.iter():
            if element.tag.rsplit("}", 1)[-1] != "loc" or not element.text:
                continue
            url = element.text.strip()
            if is_index:
                if urlparse(url).hostname in HOSTS and "recipe" in Path(urlparse(url).path).name.lower():
                    queue.append(url)
            elif allowed_recipe_url(url):
                recipes.add(url)
        print(f"Sitemap processed {len(visited)}; recipe URLs {len(recipes):,}", flush=True)
    return sorted(recipes, key=lambda url: hashlib.sha256(url.encode()).hexdigest())


def read_jsonl(path: Path) -> list[dict]:
    records = []
    if path.exists():
        # JSON strings may contain literal U+2028/U+2029; only LF separates records.
        for line in path.read_text(encoding="utf-8").split("\n"):
            if line.strip():
                records.append(json.loads(line))
    return records


def scrape_one(url: str, limiter: RateLimiter):
    try:
        body, final_url = fetch(url, limiter)
        record, status = parse_page(body, final_url)
        return url, record, status, None
    except BlockedAccess:
        raise
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
        return url, None, "request_or_parse_error", str(error)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sitemap", action="append", default=[])
    parser.add_argument("--output", type=Path, default=Path("work/recipes/goodfood/recipes.jsonl"))
    parser.add_argument("--limit", type=int, default=2200)
    parser.add_argument("--concurrency", type=int, default=3, choices=range(1, 4))
    parser.add_argument("--interval", type=float, default=0.25)
    parser.add_argument("--test-html", type=Path)
    parser.add_argument("--test-url", default="https://www.bbcgoodfood.com/recipes/easy-pancakes")
    args = parser.parse_args()
    if args.interval < 0.25:
        parser.error("Interval must be at least 0.25s")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.test_html:
        record, reason = parse_page(args.test_html.read_text(encoding="utf-8"), args.test_url)
        print(json.dumps({"status": reason, "title": record and record["title"], "ingredients": record and len(record["ingredients"]), "steps": record and len(record["directions"]), "original_image": record and record["image_source_url"]}, ensure_ascii=False))
        if record:
            args.output.write_text(json.dumps(record, ensure_ascii=False) + "\n", encoding="utf-8")
        return 0 if record else 2
    if not args.sitemap:
        parser.error("At least one --sitemap is required")
    limiter, started = RateLimiter(args.interval), time.monotonic()
    records = read_jsonl(args.output)
    seen = {r["source_url"] for r in records}
    state_path = args.output.with_suffix(".state.jsonl")
    state = read_jsonl(state_path)
    done_urls = {r["url"] for r in state if r.get("status") not in {"request_or_parse_error", "blocked"}}
    counters = Counter(r["status"] for r in state)
    if len(seen) >= args.limit:
        args.output.with_suffix(".done").write_text(f"{len(seen)} source recipes ready\n")
        print(f"Already have {len(seen):,} source recipes", flush=True)
        return 0
    urls = sitemap_urls(args.sitemap, limiter, args.output.parent / "goodfood-sitemap-cache")
    pending_urls = iter(url for url in urls if url not in seen and url not in done_urls)
    print(f"Starting with {len(seen):,} saved recipes; target {args.limit:,}; sitemap candidates {len(urls):,}", flush=True)
    blocked = None
    with args.output.open("a", encoding="utf-8") as output, state_path.open("a", encoding="utf-8") as state_file, ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = {}
        def schedule_one():
            url = next(pending_urls, None)
            if url:
                futures[executor.submit(scrape_one, url, limiter)] = url
                return True
            return False
        for _ in range(args.concurrency):
            schedule_one()
        while futures and len(seen) < args.limit and not blocked:
            completed, _ = wait(futures, return_when=FIRST_COMPLETED)
            for future in completed:
                requested = futures.pop(future)
                try:
                    url, record, status, error = future.result()
                except BlockedAccess as blocked_error:
                    blocked = str(blocked_error)
                    status, record, url = "blocked", None, requested
                    error = blocked
                counters[status] += 1
                if record and record["source_url"] not in seen and len(seen) < args.limit:
                    output.write(json.dumps(record, ensure_ascii=False) + "\n")
                    output.flush()
                    seen.add(record["source_url"])
                state_file.write(json.dumps({"url": url, "status": status, "error": error, "timestamp": datetime.now(timezone.utc).isoformat()}) + "\n")
                state_file.flush()
                if len(seen) % 25 == 0 or blocked:
                    print(f"Saved {len(seen):,}/{args.limit:,}; processed {sum(counters.values()):,}; elapsed {time.monotonic()-started:.1f}s; {dict(counters)}", flush=True)
                if not blocked and len(seen) < args.limit:
                    schedule_one()
            if blocked:
                limiter.stop.set()
        # Cancel queued work and prevent any new request after the target or a block.
        limiter.stop.set()
        for future in futures:
            future.cancel()
    summary = {"source": "Good Food public recipe JSON-LD", "source_license": LICENSE, "target": args.limit, "saved_recipes": len(seen), "sitemap_candidates": len(urls), "counters": dict(counters), "blocked": blocked, "complete": len(seen) >= args.limit, "elapsed_seconds": round(time.monotonic() - started, 2), "image_method": "Original image URLs supplied by each recipe JSON-LD; local download verification is a separate step"}
    args.output.with_suffix(".summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if summary["complete"]:
        args.output.with_suffix(".done").write_text(f"{len(seen)} source recipes ready\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    return 0 if summary["complete"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
