"""ai catalog domain boundary; no user persistence."""
import re,time
from sqlalchemy import text
from src.ai_config import *
from src.ai_errors import AIError


def ingredient_pattern(term):
    from src import local_ai as facade
    options = ALIASES.get(term, [re.escape(term) + ("s?" if term[-1:].isalpha() and not term.endswith("s") else "")])
    return r"\m(" + "|".join(options) + r")\M"


def public_catalog_clause(alias="r"):
    from src import local_ai as facade
    """Current DB setting, fail closed if missing; never cache permission decisions."""
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", alias):
        raise ValueError("Invalid internal recipe alias")
    approved = (f"{alias}.demo_permission_confirmed = true AND "
                f"length(btrim(coalesce({alias}.demo_permission_note,''))) > 0 AND "
                f"{alias}.image_kind = 'source' AND {alias}.image_url LIKE '/recipe-images/%'")
    enabled = "coalesce((SELECT (settings->>'publicDemo')::boolean FROM public.lmc_platform_settings WHERE id=true), true)"
    return f"{alias}.is_public = true AND (NOT {enabled} OR ({approved}))"


def public_catalog_ids():
    from src import local_ai as facade
    with facade._db().connect() as connection:
        return {str(row[0]) for row in connection.execute(text(
            "SELECT r.id::text FROM public.recipe r WHERE " + facade.public_catalog_clause()))}


def search(prompt, confirmed_ingredients=None, clarification_context=None, clarification_answers=None):
    from src import local_ai as facade
    started = time.monotonic()
    confirmed = facade._terms(confirmed_ingredients or [], 20)
    from src import intent_clarification as clarify
    from src.ai_intent import IntentConflict
    from src.ai_contracts import results_envelope
    from src.request_context import checkpoint
    original=None
    parse_prompt=prompt
    if clarification_context is not None:
        original,parse_prompt=clarify.resume(prompt,clarification_context,clarification_answers)
    elif clarification_answers is not None:
        raise AIError('Clarification answers require their signed context.')
    try:
        intent = (facade.parse_intent(parse_prompt,clarified=True) if original is not None else facade.parse_intent(parse_prompt)) if parse_prompt and parse_prompt.strip() else {
            "keyword": "", **{key: [] for key in ARRAY_FIELDS}, "maxCookingTime": None}
    except IntentConflict as error:
        intent=error.intent
    if original is not None:intent=clarify.preserve(original,intent)
    intent["ingredients"] = list(dict.fromkeys(intent["ingredients"] + confirmed))
    if clarify.ingredient_conflicts(confirmed,intent['allergies']):
        raise AIError("A confirmed photo ingredient conflicts with an exclusion. Remove it before searching.", 422)
    questions=clarify.reasons(parse_prompt,intent)
    if questions:
        if original is not None:raise AIError('The clarified request still conflicts. Edit the original request explicitly to start a new search.',422)
        return clarify.response(prompt,intent,questions)
    if not any(intent.get(key) for key in INTENT_SCHEMA['required']):
        raise AIError('Describe a dish or confirm at least one ingredient.',422)
    checkpoint()
    clauses = [facade.public_catalog_clause()]
    params = {}
    for key, positive in [("ingredients", True), ("allergies", False)]:
        for index, term in enumerate(intent[key]):
            parameter = f"{key}{index}"
            params[parameter] = facade.ingredient_pattern(term)
            clauses.append(("" if positive else "NOT ") +
                f"EXISTS (SELECT 1 FROM public.recipe_ingredients ri JOIN public.ingredients i ON i.id=ri.ingredient_id WHERE ri.recipe_id=r.id AND lower(i.name) ~ :{parameter})")
    for key, table, column, dictionary in [
        ("dietaryPreferences", "recipe_dietary_pref", "preference_id", "dietary_pref"),
        ("cuisines", "recipe_cuisines", "cuisine_id", "cuisines"),
        ("categories", "recipe_categories", "category_id", "categories")]:
        for index, name in enumerate(intent[key]):
            parameter = f"{key}{index}"
            params[parameter] = name.replace("-", " ")
            clauses.append(f"EXISTS (SELECT 1 FROM public.{table} t JOIN public.{dictionary} d ON d.id=t.{column} WHERE t.recipe_id=r.id AND replace(lower(d.name), '-', ' ')=:{parameter})")
    from src.dietary_guards import append_diet_guards
    append_diet_guards(clauses, params, intent['dietaryPreferences'])
    if intent["maxCookingTime"] is not None:
        clauses.append("r.time > 0 AND r.time <= :max_time")
        params["max_time"] = intent["maxCookingTime"]
    with facade._db().connect() as connection:
        rows = connection.execute(text("SELECT r.id::text, r.title, r.description, r.image_url, r.time, r.servings, r.source_url FROM public.recipe r WHERE " + " AND ".join(clauses)), params).mappings().all()
    warnings = []
    if intent["allergies"]:
        warnings.append("Exclusions filter listed ingredients and known aliases. Unlisted allergens and cross-contact remain unknown; check the original recipe and labels.")
    if intent["dietaryPreferences"]:
        warnings.append("Diet labels are explicitly supplied by the recipe source; unlabelled recipes and known listed-ingredient contradictions are excluded. Hidden ingredients remain unknown.")
    if intent["cuisines"]:
        warnings.append("Cuisine tags have limited source coverage. No cuisine is inferred by AI.")
    if len(rows) > 0:
        ranked = facade._rank(rows, intent)
    else:
        ranked = []
        warnings.append("No recipes satisfy all constraints. Adjust a constraint explicitly; exclusions are never relaxed automatically.")
    query_words = " ".join([intent["keyword"], *intent["ingredients"]]).strip()
    cards = []
    for row in ranked[:24]:
        reasons = []
        if intent["ingredients"]:
            reasons.append("Listed ingredients include: " + ", ".join(intent["ingredients"]))
        if intent["dietaryPreferences"]:
            reasons.append("Source diet labels: " + ", ".join(intent["dietaryPreferences"]))
        if intent["maxCookingTime"]:
            reasons.append(f"Total cooking time: {row['time']} minutes")
        if query_words:
            reasons.append("Ranked by semantic similarity to your request")
        cards.append({"id": row["id"], "title": row["title"], "description": row["description"],
            "imageUrl": row["image_url"], "cookingTime": row["time"], "servings": row["servings"],
            "sourceUrl": row["source_url"], "sourceName": "Good Food" if "bbcgoodfood.com" in (row["source_url"] or "") else "Recipe source",
            "matchReasons": reasons})
    checkpoint()
    return results_envelope(intent=intent, recipes=cards, totalMatches=len(rows),
        elapsedMs=round((time.monotonic() - started) * 1000), model=TEXT_MODEL,
        local=True, warnings=warnings, ranking='MiniLM semantic ranking over public recipes satisfying every explicit constraint')


def _rank(rows, intent):
    from src import local_ai as facade
    query = " ".join([intent["keyword"], *intent["ingredients"], *intent["cuisines"], *intent["categories"]]).strip()
    if not query:
        return sorted(rows, key=lambda row: (row["title"], row["id"]))
    import torch
    from torch.nn import functional as functional
    from src.cache_manager import get_cache
    from src.embed_with_sbert import get_model
    ids, embeddings = get_cache().get_snapshot()
    if not ids or embeddings.numel() == 0:
        raise AIError("Local recipe embeddings are unavailable. Rebuild the recommendation cache.", 503)
    index = {recipe_id: position for position, recipe_id in enumerate(ids)}
    vector = get_model().encode([query], convert_to_tensor=True, device="cpu", show_progress_bar=False)
    positions=[index[row['id']] for row in rows if row['id'] in index]
    scores = functional.cosine_similarity(vector, embeddings[positions], dim=1) if positions else []
    score_map={ids[position]:float(score) for position,score in zip(positions,scores)}
    def score(row):
        similarity = score_map.get(row['id'],-1.0)
        keyword = intent["keyword"]
        return similarity + (0.15 if keyword and keyword in row["title"].lower() else 0)
    return sorted(rows, key=lambda row: (-score(row), row["id"]))
