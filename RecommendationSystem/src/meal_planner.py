"""Canonical seven-dinner plans from public local recipes; no pantry mutations."""
import hashlib
import hmac
import json
import os
import re
import uuid
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from fractions import Fraction

from sqlalchemy import bindparam, text
from src import local_ai as ai

DAYS = 7
ALTERNATIVES = 14
SEARCH_LIMIT = 300
MEASURED_SEARCH_LIMIT = 60
INTENT_KEYS = set(ai.INTENT_SCHEMA['required'])
DIET_EXCLUSIONS = {'dairy-free': 'dairy', 'nut-free': 'nut', 'peanut-free': 'peanut',
                   'egg-free': 'egg', 'soy-free': 'soy', 'sesame-free': 'sesame'}
UNITS = {
    'g': 'g', 'gram': 'g', 'grams': 'g', 'kg': 'kg', 'kilogram': 'kg', 'kilograms': 'kg',
    'ml': 'ml', 'millilitre': 'ml', 'millilitres': 'ml', 'milliliter': 'ml', 'milliliters': 'ml',
    'l': 'l', 'litre': 'l', 'litres': 'l', 'liter': 'l', 'liters': 'l',
    'tsp': 'tsp', 'teaspoon': 'tsp', 'teaspoons': 'tsp',
    'tbsp': 'tbsp', 'tablespoon': 'tbsp', 'tablespoons': 'tbsp',
    'cup': 'cup', 'cups': 'cup', 'oz': 'oz', 'ounce': 'oz', 'ounces': 'oz',
    'lb': 'lb', 'pound': 'lb', 'pounds': 'lb', 'piece': 'piece', 'pieces': 'piece',
    'clove': 'clove', 'cloves': 'clove', 'can': 'can', 'cans': 'can',
    'tin': 'tin', 'tins': 'tin', 'slice': 'slice', 'slices': 'slice',
}
VULGAR = {'¼': '1/4', '½': '1/2', '¾': '3/4', '⅐': '1/7', '⅑': '1/9', '⅒': '1/10',
          '⅓': '1/3', '⅔': '2/3', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5',
          '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8'}
AMBIGUOUS = re.compile(r'\b(to taste|as needed|if required|optional|handful|pinch|plus .*extra|plus extra|for dusting|to serve)\b', re.I)
SWEETS_DRINKS = re.compile(r'\b(brownies?|cookies?|cupcakes?|cheesecakes?|muffins?|sorbet|ice cream|cocktails?|smoothies?|milkshakes?|lemonade|iced tea|hot chocolate|panna cotta|tiramisu)\b', re.I)
STANDALONE_SIDE = re.compile(r'^(?:sauce|gravy|dressing|marinade|seasoning|chutney|stock|dip)\b|\b(?:sauce|gravy|dressing|marinade|seasoning|chutney|stock|dip)(?: recipe)?$', re.I)
MEAL_CONNECTOR = re.compile(r'\b(?:with|in|and|over|served|on)\b|&', re.I)


def _dinner_title(title):
    if SWEETS_DRINKS.search(title):
        return False
    # A condiment's title must not become a whole dinner merely because its source has a broad tag.
    # Dish names such as "chicken with tomato sauce" remain eligible.
    if STANDALONE_SIDE.search(title.strip()) and not MEAL_CONNECTOR.search(title):
        return False
    return True


def _empty_intent():
    return {'keyword': '', **{key: [] for key in ai.ARRAY_FIELDS}, 'maxCookingTime': None}


def _uuid_list(values, limit=1000):
    if not isinstance(values, list) or len(values) > limit:
        raise ai.AIError('Recipe ID list is invalid or too long.')
    try:
        if any(not isinstance(value, str) for value in values):
            raise ValueError()
        return list(dict.fromkeys(str(uuid.UUID(value)) for value in values))
    except (ValueError, AttributeError) as exc:
        raise ai.AIError('Each recipe ID must be a UUID.') from exc


def _settings(body):
    if not isinstance(body, dict):
        raise ai.AIError('Meal plan request must be an object.')
    start = body.get('weekStart')
    try:
        if not isinstance(start, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', start):
            raise ValueError()
        first = date.fromisoformat(start)
        first + timedelta(days=DAYS - 1)
    except (ValueError, OverflowError) as exc:
        raise ai.AIError('Choose a valid week start date.') from exc
    servings, maximum = body.get('servings', 2), body.get('maxCookTime', 45)
    if type(servings) is not int or not 1 <= servings <= 12:
        raise ai.AIError('Servings must be an integer between 1 and 12.')
    if type(maximum) is not int or not 5 <= maximum <= 240:
        raise ai.AIError('Maximum cooking time must be between 5 and 240 minutes.')
    prompt, use_profile = body.get('prompt', ''), body.get('useProfile', True)
    if not isinstance(prompt, str) or len(prompt) > 2000 or type(use_profile) is not bool:
        raise ai.AIError('Recipe request or profile setting is invalid.')
    count = body.get('mealCount', DAYS)
    if type(count) is not int or count not in (1, 3, 7):
        raise ai.AIError('Choose a 1, 3 or 7 dinner plan.')
    use_pantry = body.get('usePantry', False)
    if type(use_pantry) is not bool:
        raise ai.AIError('Pantry setting must be true or false.')
    requirements = _requirements(body)
    for flag in ('useHouseholdPreferences','useLeftovers'):
        if type(body.get(flag,False)) is not bool:raise ai.AIError('Household and leftover settings must be true or false.')
    if (requirements['mustUseIngredients'] or requirements['budget']) and not use_pantry:
        raise ai.AIError('Must-use and budget planning require your measured pantry and price book.', 422)
    return first, servings, {'prompt': prompt.strip(), 'maxCookTime': maximum,
        'dietaryPreferences': ai._terms(body.get('dietaryPreferences', []), 20),
        'excludedIngredients': ai._terms(body.get('excludedIngredients', []), 30),
        'useProfile': use_profile, 'usePantry': use_pantry, 'householdId': body.get('householdId'),
        'mealCount': count,'useHouseholdPreferences':body.get('useHouseholdPreferences',False),
        'useLeftovers':body.get('useLeftovers',False), **requirements}


def _requirements(value):
    names = value.get('mustUseIngredients', [])
    if not isinstance(names, list) or len(names) > 10 or any(not isinstance(name, str) or not name.strip() or len(name) > 200 for name in names):
        raise ai.AIError('Choose up to 10 exact pantry ingredient names.')
    names = list(dict.fromkeys(re.sub(r'\s+', ' ', name.strip().casefold()) for name in names))
    scope = value.get('mustUseScope', 'perMeal')
    if scope not in ('perMeal', 'plan'):
        raise ai.AIError('Must-use scope must be perMeal or plan.')
    budget = value.get('budget')
    if budget is not None:
        if not isinstance(budget, dict) or set(budget) != {'amount', 'currency'} or isinstance(budget['amount'], bool):
            raise ai.AIError('Budget needs an amount and currency.')
        try:
            amount = Decimal(str(budget['amount']))
            if not amount.is_finite() or not 0 < amount <= 1_000_000 or amount != amount.quantize(Decimal('.01')):
                raise ValueError()
        except (InvalidOperation, ValueError, TypeError) as exc:
            raise ai.AIError('Budget must be positive, at most 1000000, and have at most two decimal places.') from exc
        if not isinstance(budget['currency'], str) or not re.fullmatch(r'[A-Z]{3}', budget['currency']):
            raise ai.AIError('Budget currency must be an uppercase three-letter currency code.')
        budget = {'amount': float(amount), 'currency': budget['currency']}
    return {'mustUseIngredients': names, 'mustUseScope': scope, 'budget': budget}


def _merge_requirements(baseline, settings):
    current = _requirements(settings)
    names = list(dict.fromkeys(baseline['mustUseIngredients'] + current['mustUseIngredients']))
    if len(names) > 10:
        raise ai.AIError('The original and added must-use conditions exceed 10 ingredients.', 422)
    per_meal = (baseline['mustUseIngredients'] and baseline['mustUseScope'] == 'perMeal') or (current['mustUseIngredients'] and current['mustUseScope'] == 'perMeal')
    budget = baseline['budget'] or current['budget']
    if baseline['budget'] and current['budget']:
        if baseline['budget']['currency'] != current['budget']['currency']:
            raise ai.AIError('Generate a new plan to change the original budget currency.', 422)
        budget = {**budget, 'amount': min(budget['amount'], current['budget']['amount'])}
    effective = {'mustUseIngredients': names, 'mustUseScope': 'perMeal' if per_meal else current['mustUseScope'], 'budget': budget}
    if (names or budget) and not settings['usePantry']:
        raise ai.AIError('The original pantry requirements cannot be disabled. Generate a new plan instead.', 422)
    return {**settings, **effective}


def _canonical_intent(value):
    if not isinstance(value, dict) or set(value) != INTENT_KEYS:
        raise ai.AIError('Meal plan search conditions are incomplete.', 422)
    result = _empty_intent()
    keyword = value['keyword']
    if not isinstance(keyword, str) or len(keyword) > 120:
        raise ai.AIError('Meal plan dish request is invalid.', 422)
    result['keyword'] = keyword.strip().lower()
    for key in ai.ARRAY_FIELDS:
        # A signed baseline can contain both prompt and manual exclusions.
        result[key] = ai._terms(value[key], 100)
    maximum = value['maxCookingTime']
    if maximum is not None and (type(maximum) is not int or not 1 <= maximum <= 600):
        raise ai.AIError('Parsed cooking time is invalid.', 422)
    result['maxCookingTime'] = maximum
    return result


def _key():
    key = os.getenv('MEAL_PLANNER_SIGNING_KEY', '')
    if len(key) < 32:
        raise ai.AIError('Meal planning is unavailable: the local validation key is not configured.', 503)
    return key.encode('utf-8')


def _signature(parsed, prompt, requirements=None, pricing=None):
    envelope = {'intent': parsed, 'prompt': prompt}
    if requirements is not None:
        envelope['requirements'] = requirements
    if pricing is not None:
        envelope['pricing'] = pricing
    payload = json.dumps(envelope, sort_keys=True,
                         separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    return hmac.new(_key(), payload, hashlib.sha256).hexdigest()


def _verified_intent(value, prompt):
    if not isinstance(value, dict):
        raise ai.AIError('Generate a plan before changing or saving its meals.', 422)
    parsed = _canonical_intent(value.get('_parsed'))
    signature = value.get('_signature')
    requirements = _requirements(value['_requirements']) if '_requirements' in value and isinstance(value['_requirements'], dict) else None
    if '_requirements' in value and requirements is None:
        raise ai.AIError('The original pantry requirements are invalid.', 422)
    pricing = _canonical_pricing(value['_pricing']) if '_pricing' in value else None
    if not isinstance(signature, str) or not hmac.compare_digest(_signature(parsed, prompt, requirements, pricing), signature):
        raise ai.AIError('The original request changed or its conditions are invalid. Generate a new plan.', 422)
    return parsed, requirements or _requirements({}), pricing


def _diet_filters(values, warnings, label):
    diets, exclusions = [], []
    for raw in values:
        value = raw.replace(' ', '-').lower()
        if value in ai.DIETS:
            diets.append(value)
        elif value in DIET_EXCLUSIONS:
            exclusion = DIET_EXCLUSIONS[value]
            exclusions.append(exclusion)
            warnings.append(f"{label} '{raw}' is applied as a listed-ingredient {exclusion} exclusion.")
        else:
            raise ai.AIError(f"Unsupported dietary preference '{raw}'. Choose a supported diet or enter an ingredient exclusion.", 422)
    return diets, exclusions


def _constraints(parsed, settings, profile):
    if not isinstance(profile, dict):
        raise ai.AIError('Meal plan profile context is invalid.')
    if type(profile.get('usedProfile', False)) is not bool:
        raise ai.AIError('Meal plan profile context is invalid.')
    used = settings['useProfile'] and profile.get('usedProfile', False)
    warnings = []
    intent = {key: list(value) if isinstance(value, list) else value for key, value in parsed.items()}
    diets, exclusions = _diet_filters(parsed['dietaryPreferences'] + settings['dietaryPreferences'], warnings, 'Diet preference')
    allergies = settings['excludedIngredients'] + exclusions + parsed['allergies']
    favorites = _uuid_list(profile.get('favoriteRecipeIds', [])) if used else []
    dislikes = _uuid_list(profile.get('dislikedRecipeIds', []))
    favorites = [recipe_id for recipe_id in favorites if recipe_id not in dislikes]
    if used:
        profile_diets, profile_exclusions = _diet_filters(ai._terms(profile.get('dietaryPreferences', []), 50), warnings, 'Saved preference')
        diets += profile_diets
        allergies += ai._terms(profile.get('allergies', []), 50) + profile_exclusions
    if settings.get('useHouseholdPreferences',False):
        household=profile.get('householdRestrictions',{})
        if not isinstance(household,dict) or set(household)-{'dietaryPreferences','allergies'}:
            raise ai.AIError('Trusted household restrictions are invalid.')
        family_diets,family_exclusions=_diet_filters(ai._terms(household.get('dietaryPreferences',[]),50),warnings,'Shared household preference')
        diets+=family_diets
        allergies+=ai._terms(household.get('allergies',[]),50)+family_exclusions
    intent['dietaryPreferences'] = list(dict.fromkeys(diets))
    intent['allergies'] = list(dict.fromkeys(allergies))
    intent['maxCookingTime'] = min(settings['maxCookTime'], parsed['maxCookingTime'] or settings['maxCookTime'])
    if set(intent['ingredients']) & set(intent['allergies']):
        raise ai.AIError('Your request includes and excludes the same ingredient. Please change the request.', 422)
    if intent['allergies']:
        warnings.append('Exclusions check listed ingredients and known aliases, not unlisted allergens or cross-contact. Check the recipe and ingredient labels.')
    if intent['dietaryPreferences']:
        warnings.append('Diet filters require explicit source labels and exclude known listed-ingredient contradictions; hidden ingredients remain unknown.')
    return intent, favorites, dislikes, used, warnings


def _eligible_rows(intent, dislikes, required_ids=()):
    clauses = [ai.public_catalog_clause(), "r.image_kind = 'source'", "r.image_url LIKE '/recipe-images/%'",
        "EXISTS (SELECT 1 FROM public.recipe_ingredients x WHERE x.recipe_id=r.id)",
        "EXISTS (SELECT 1 FROM public.recipe_categories rc JOIN public.categories c ON c.id=rc.category_id WHERE rc.recipe_id=r.id AND lower(c.name) IN ('dinner','main course','lunch','soup'))",
        "NOT EXISTS (SELECT 1 FROM public.recipe_categories rc JOIN public.categories c ON c.id=rc.category_id WHERE rc.recipe_id=r.id AND lower(c.name) IN ('dessert','drink','beverage','breakfast','brunch','snack','side dish','sauce','condiment','dip','salad dressing'))",
        "r.time > 0 AND r.time <= :max_time"]
    parameters = {'max_time': intent['maxCookingTime']}
    for key, positive in [('ingredients', True), ('allergies', False)]:
        for index, term in enumerate(intent[key]):
            parameter = f'{key}{index}'
            parameters[parameter] = ai.ingredient_pattern(term)
            clauses.append(('' if positive else 'NOT ') + f'EXISTS (SELECT 1 FROM public.recipe_ingredients ri JOIN public.ingredients i ON i.id=ri.ingredient_id WHERE ri.recipe_id=r.id AND lower(i.name) ~ :{parameter})')
    for key, table, column, dictionary in [
        ('dietaryPreferences', 'recipe_dietary_pref', 'preference_id', 'dietary_pref'),
        ('cuisines', 'recipe_cuisines', 'cuisine_id', 'cuisines'),
        ('categories', 'recipe_categories', 'category_id', 'categories')]:
        for index, name in enumerate(intent[key]):
            parameter = f'{key}{index}'
            parameters[parameter] = name.replace('-', ' ')
            clauses.append(f"EXISTS (SELECT 1 FROM public.{table} t JOIN public.{dictionary} d ON d.id=t.{column} WHERE t.recipe_id=r.id AND replace(lower(d.name), '-', ' ')=:{parameter})")
    if dislikes:
        clauses.append('r.id::text NOT IN :dislikes')
        parameters['dislikes'] = dislikes
    from src.dietary_guards import append_diet_guards
    append_diet_guards(clauses, parameters, intent['dietaryPreferences'])
    # Apply every authoritative hard restriction before the bounded metadata
    # load. Canonical existing selections are checked by the same predicate
    # even if they fall outside this deterministic candidate window.
    parameters['candidate_limit']=SEARCH_LIMIT
    selection='SELECT r.id::text AS id, r.title, r.description, r.image_url, r.time, r.servings, r.source_url FROM public.recipe r WHERE '+ ' AND '.join(clauses)
    if required_ids:
        parameters['required_ids']=_uuid_list(list(required_ids),100)
        query=text('WITH candidates AS ('+selection+' ORDER BY r.time,r.id LIMIT :candidate_limit), selections AS ('+selection+' AND r.id::text IN :required_ids) SELECT * FROM candidates UNION SELECT * FROM selections').bindparams(bindparam('required_ids',expanding=True))
    else:
        query = text(selection+' ORDER BY r.time,r.id LIMIT :candidate_limit')
    if dislikes:
        query = query.bindparams(bindparam('dislikes', expanding=True))
    with ai._db().connect() as connection:
        rows = connection.execute(query, parameters).mappings().all()
    return [dict(row) for row in rows if _dinner_title(row['title'])]


def _favorite_similarity(rows, favorites):
    if not favorites or not rows:
        return {}
    from torch.nn import functional as functional
    from src.cache_manager import get_cache
    ids, embeddings = get_cache().get_snapshot()
    index = {str(recipe_id): position for position, recipe_id in enumerate(ids)}
    positions = [index[recipe_id] for recipe_id in favorites if recipe_id in index]
    if not positions or embeddings.numel() == 0:
        return {}
    vector = embeddings[positions].mean(dim=0, keepdim=True)
    targets=[row['id'] for row in rows if row['id'] in index]
    scores = functional.cosine_similarity(vector, embeddings[[index[key] for key in targets]], dim=1)
    return {key:float(score) for key,score in zip(targets,scores)}


def _ranked_rows(rows, intent, favorites, available=()):
    ranking_intent = {**intent, 'categories': intent['categories'] or ['dinner']}
    ranked = ai._rank(rows, ranking_intent) if rows else []
    similarity = _favorite_similarity(ranked, favorites)
    favorite_set = set(favorites)
    positions = {row['id']: position for position, row in enumerate(ranked)}
    from src.pantry import affinity
    stock = affinity(ranked, list(available)) if available else {}
    def score(row):
        # Prefer a usable source yield only for closely ranked taste matches.
        # Missing yields remain eligible and their amounts stay marked for review.
        yield_bonus = .025 if _number(row.get('servings')) is not None else 0
        return 1 / (1 + positions[row['id']] / 50) + .35 * (row['id'] in favorite_set) + .2 * similarity.get(row['id'], 0) + yield_bonus + .3 * stock.get(row['id'], 0)
    return sorted(ranked, key=lambda row: (-score(row), row['id']))


def _taste_rank(rows,profile,settings):
    from src.ai_contracts import TasteContext
    if not settings['useProfile'] and not settings.get('useHouseholdPreferences'):return rows
    taste=TasteContext.from_mapping(profile).to_preferences()
    if not any(taste.values()):return rows
    from src.recommend import _get_hybrid_ranker
    ranker=_get_hybrid_ranker()
    if ranker is None:return rows
    visible=ai.public_catalog_ids()
    taste['tasteFeedback']=[item for item in taste['tasteFeedback'] if item['recipeId'] in visible]
    positions={row['id']:index for index,row in enumerate(rows)}
    return sorted(rows,key=lambda row:(-(1/(1+positions[row['id']]/50)+ranker.context_score(row['id'],taste)),row['id']))


def _distinct_rows(rows, excluded=()):
    seen_ids, seen_titles = set(excluded), set()
    result = []
    for row in rows:
        title = re.sub(r'\W+', ' ', row['title'].lower()).strip()
        if row['id'] not in seen_ids and title not in seen_titles:
            result.append(row)
            seen_ids.add(row['id'])
            seen_titles.add(title)
    return result


def _ingredients(recipe_ids):
    if not recipe_ids:
        return {}
    query = text('SELECT ri.recipe_id::text AS recipe_id, i.id::text AS id, i.name, ri.quantity, ri.unit FROM public.recipe_ingredients ri JOIN public.ingredients i ON i.id=ri.ingredient_id WHERE ri.recipe_id::text IN :ids ORDER BY ri.recipe_id, ri.id').bindparams(bindparam('ids', expanding=True))
    result = {recipe_id: [] for recipe_id in recipe_ids}
    with ai._db().connect() as connection:
        rows = connection.execute(query, {'ids': recipe_ids}).mappings().all()
    for row in rows:
        result[row['recipe_id']].append({key: row[key] or '' for key in ['id', 'name', 'quantity', 'unit']})
    return result


def _card(row, ingredients, intent, favorites):
    reasons = [f"Total cooking time: {row['time']} minutes"]
    if intent['ingredients']:
        reasons.append('Required listed ingredients: ' + ', '.join(intent['ingredients']))
    if intent['dietaryPreferences']:
        reasons.append('Source diet labels: ' + ', '.join(intent['dietaryPreferences']))
    if _number(row.get('servings')) is not None:
        reasons.append('Amounts can be scaled from the source servings')
    if row['id'] in favorites:
        reasons.append('Saved in your favourites')
    elif favorites:
        reasons.append('Ranked with your saved recipe preferences')
    return {'id': row['id'], 'title': row['title'], 'imageUrl': row['image_url'],
        'cookingTime': row['time'], 'servings': row['servings'], 'sourceUrl': row['source_url'],
        'matchReasons': reasons, 'ingredients': ingredients.get(row['id'], [])}


def _number(raw):
    raw = str(raw or '').strip()
    for symbol, fraction in VULGAR.items():
        raw = raw.replace(symbol, ' ' + fraction)
    raw = re.sub(r'\s+', ' ', raw).strip()
    try:
        if re.fullmatch(r'\d+\s+\d+/\d+', raw):
            whole, part = raw.split()
            value = Fraction(whole) + Fraction(part)
        elif re.fullmatch(r'\d+(?:\.\d+)?|\d+/\d+', raw):
            value = Fraction(raw)
        else:
            return None
        return value if 0 < value <= 1_000_000_000 else None
    except (ValueError, ZeroDivisionError):
        return None


def _format_number(value):
    if value.denominator == 1:
        return str(value.numerator)
    denominator = value.denominator
    while denominator % 2 == 0:
        denominator //= 2
    while denominator % 5 == 0:
        denominator //= 5
    if denominator == 1:
        # Decimal denominators from source text: keep exact value, never round.
        from decimal import Decimal, localcontext
        with localcontext() as context:
            context.prec = 40
            return format(Decimal(value.numerator) / Decimal(value.denominator), 'f').rstrip('0').rstrip('.')
    whole, remainder = divmod(value.numerator, value.denominator)
    return f'{whole} {remainder}/{value.denominator}' if whole else f'{remainder}/{value.denominator}'


def shopping_list(meals, servings):
    """Only identical ingredient IDs and known equivalent unit spellings add up.

    No mass/volume conversion, density estimate, guessed yields or name ontology.
    Ambiguous lines keep their source amount and recipe attribution individually.
    """
    groups = {}
    for meal in meals:
        if meal.get('reuse'):
            continue  # Cooked, confirmed portions never debit raw stock again.
        recipe = meal['recipe']
        source_servings = _number(recipe.get('servings'))
        for index, ingredient in enumerate(recipe['ingredients']):
            quantity = _number(ingredient.get('quantity'))
            raw_unit = str(ingredient.get('unit') or '').strip()
            unit = UNITS.get(raw_unit.lower())
            ambiguous = AMBIGUOUS.search(' '.join(str(ingredient.get(key) or '') for key in ['name', 'quantity', 'unit']))
            safe = bool(quantity is not None and source_servings is not None and not ambiguous and unit)
            # Missing units may mean counts, a lost measure or malformed source
            # data. Preserve those lines for review instead of guessing a unit.
            if safe:
                amount = quantity * Fraction(servings) / source_servings
                identity = ingredient.get('id') or ingredient['name'].strip().lower()
                key = 'item-' + hashlib.sha256(f'{identity}|{unit}'.encode()).hexdigest()[:24]
                quantity_text = (_format_number(amount) + (' ' + unit if unit else '')).strip()
            else:
                amount = None
                key = f'review-{recipe["id"]}-{index}'
                raw = ' '.join(str(ingredient.get(key) or '').strip() for key in ['quantity', 'unit']).strip()
                quantity_text = (raw or 'Amount not specified') + ' (source amount; review)'
            contribution = {'recipeId': recipe['id'], 'recipeTitle': recipe['title'], 'quantityText': quantity_text, 'quantity': float(amount) if safe else None, 'quantityExact': str(amount) if safe else None, 'unit': unit}
            if key not in groups:
                groups[key] = {'key': key, 'name': ingredient['name'], 'quantityText': quantity_text,
                    'contributions': [], 'requiresReview': not safe, '_amount': Fraction(0) if safe else None, '_unit': unit}
            group = groups[key]
            group['contributions'].append(contribution)
            if safe:
                group['_amount'] += amount
                group['quantityText'] = _format_number(group['_amount']) + (' ' + unit if unit else '')
    result = []
    for group in groups.values():
        group['quantityExact'] = str(group['_amount']) if group['_amount'] is not None else None
        group['quantity'] = float(group.pop('_amount')) if group['_amount'] is not None else None
        if '_amount' in group: group.pop('_amount')
        group['unit'] = group.pop('_unit')
        result.append(group)
    return sorted(result, key=lambda item: (item['name'].casefold(), item['key']))


def _pantry_context(settings, profile):
    if not settings['usePantry']:
        return None
    required = ('pantry', 'priceBook', 'ingredientAliases', 'asOf')
    if any(key not in profile for key in required):
        raise ai.AIError('Measured pantry context is unavailable. Sign in and choose an accessible pantry.', 422)
    if any(not isinstance(profile[key], list) or len(profile[key]) > 1000 for key in required[:3]):
        raise ai.AIError('Measured pantry context is invalid or too large.')
    try:
        date.fromisoformat(profile['asOf'])
    except (ValueError, TypeError):
        raise ai.AIError('Measured pantry date is invalid.')
    return {key: profile[key] for key in required}


def _resolver(context):
    from src.pantry import canonical_name
    aliases = context.get('ingredientAliases', [])
    if not isinstance(aliases, list) or len(aliases) > 1000:
        raise ai.AIError('Reviewed ingredient aliases are invalid.')
    mapping = {canonical_name(row['alias']): canonical_name(row['name']) for row in aliases
               if isinstance(row, dict) and row.get('alias') and row.get('name')}
    return lambda value: mapping.get(canonical_name(value), canonical_name(value))


def _quote_digest(quote):
    payload = {key: quote.get(key) for key in ('id', 'version', 'ingredient', 'unit', 'currency', 'area', 'source', 'observedOn')}
    for key in ('packQuantity', 'packPrice'):
        try:
            payload[key] = format(Decimal(str(quote.get(key))).normalize(), 'f')
        except InvalidOperation:
            payload[key] = None
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def _canonical_pricing(value):
    if not isinstance(value, dict) or set(value) != {'version', 'quotes', 'usedQuoteIds'} or type(value.get('version')) is not int or value['version'] != 1:
        raise ai.AIError('Pinned price observations are invalid. Generate a new plan.', 422)
    quotes, used = value['quotes'], value['usedQuoteIds']
    if not isinstance(quotes, list) or len(quotes) > 1000 or not isinstance(used, list) or len(used) > 500:
        raise ai.AIError('Pinned price observations are too large.', 422)
    result, ids, groups = [], set(), set()
    for quote in quotes:
        if (not isinstance(quote, dict) or set(quote) != {'name', 'unit', 'id', 'version', 'digest'}
                or not isinstance(quote.get('name'), str) or not 1 <= len(quote['name']) <= 200
                or not isinstance(quote.get('unit'), str) or quote['unit'] not in set(UNITS.values()) or not isinstance(quote.get('id'), str) or not 1 <= len(quote['id']) <= 100
                or quote.get('version') is not None and (type(quote['version']) is not int or quote['version'] < 1)
                or not isinstance(quote.get('digest'), str) or not re.fullmatch(r'[0-9a-f]{64}', quote['digest'])):
            raise ai.AIError('Pinned price observation is invalid.', 422)
        group = (quote['name'], quote['unit'])
        if quote['id'] in ids or group in groups:
            raise ai.AIError('Pinned price observations must be distinct.', 422)
        ids.add(quote['id']); groups.add(group); result.append(dict(quote))
    if any(not isinstance(identifier, str) or identifier not in ids for identifier in used) or len(set(used)) != len(used):
        raise ai.AIError('Pinned used price observations are invalid.', 422)
    return {'version': 1, 'quotes': result, 'usedQuoteIds': list(used)}


def _pin_prices(context, budget):
    if context is None:
        return None
    from src.pantry import positive, unit
    resolved = _resolver(context)
    latest = {}
    for quote in context['priceBook']:
        if (not isinstance(quote, dict) or positive(quote.get('packQuantity')) is None or positive(quote.get('packPrice')) is None
                or not unit(quote.get('unit')) or not all(isinstance(quote.get(key), str) and quote[key].strip() for key in ('id', 'ingredient', 'area', 'source', 'observedOn', 'currency'))
                or not re.fullmatch(r'[A-Z]{3}', quote['currency']) or budget and quote['currency'] != budget['currency']):
            continue
        try:
            observed = date.fromisoformat(quote['observedOn'])
            if observed > date.fromisoformat(context['asOf']):
                continue
        except ValueError:
            continue
        group = (resolved(quote['ingredient']), unit(quote['unit']))
        if not group[0]:
            continue
        if group not in latest or (quote['observedOn'], quote['id']) > (latest[group]['observedOn'], latest[group]['id']):
            latest[group] = quote
    value = {'version': 1, 'quotes': [{'name': name, 'unit': measure, 'id': quote['id'],
             'version': quote.get('version'), 'digest': _quote_digest(quote)} for (name, measure), quote in sorted(latest.items())], 'usedQuoteIds': []}
    return _canonical_pricing(value)


def _priced_context(context, pricing):
    if context is None:
        if pricing is not None:
            raise ai.AIError('Pinned prices require the original accessible pantry context.', 422)
        return None
    by_id = {quote.get('id'): quote for quote in context['priceBook'] if isinstance(quote, dict)}
    resolved = _resolver(context)
    matched = []
    for reference in pricing['quotes']:
        current = by_id.get(reference['id'])
        valid = current is not None and current.get('version') == reference['version'] and _quote_digest(current) == reference['digest']
        if valid:
            from src.pantry import unit
            valid = (resolved(current['ingredient']), unit(current['unit'])) == (reference['name'], reference['unit'])
        if not valid and reference['id'] in pricing['usedQuoteIds']:
            raise ai.AIError('A pinned price quote is missing or changed. Refresh prices explicitly and review the new budget before applying.', 422)
        if valid:
            matched.append(current)
    return {**context, 'priceBook': matched}


def _pantry_evidence(meals, shopping, settings, context):
    """Split an actual full-plan stock allocation across source contributions.

    A lot is never spent twice. Sharing a partly covered exact ingredient across
    several meals is proportional to their measured need; expired-for-that-meal
    lots do not provide evidence for that meal. No amount or unit is inferred.
    """
    from src.pantry import coverage
    from src.request_context import checkpoint,current
    checkpoint()
    active=current()
    memo_key=None
    if active is not None:
        memo_key=('pantry-evidence',hashlib.sha256(json.dumps({'meals':meals,'shopping':shopping,'settings':settings,'context':context},sort_keys=True,default=str,separators=(',',':')).encode()).hexdigest())
        if memo_key in active.memo:return active.memo[memo_key]
    measured = coverage({'plan': {'meals': meals, 'shoppingList': shopping}, **context})
    resolved = _resolver(context)
    days = {meal['recipe']['id']: (meal['dayIndex'], meal['date']) for meal in meals}
    evidence = [allocation for allocation in measured['allocations'] if allocation.get('recipeId') in days]
    required = settings['mustUseIngredients']
    selected_ids = set(days)
    satisfied = bool(meals) if required else True
    for name in required:
        matching = [row for row in evidence if row['ingredient'] == resolved(name) and row['quantity'] > 0]
        if settings['mustUseScope'] == 'perMeal':
            satisfied = satisfied and {row['recipeId'] for row in matching} == selected_ids
        else:
            satisfied = satisfied and bool(matching)
    must_use = {'scope': settings['mustUseScope'], 'ingredients': required,
                'satisfied': satisfied, 'allocations': evidence}
    budget = settings['budget']
    price_ids = []
    provenance = True
    for item in measured['shoppingList']:
        if (item.get('quantityMissing') or 0) > 0:
            valid_date = False
            try:
                observed = date.fromisoformat(item.get('priceObservedOn'))
                valid_date = observed <= date.fromisoformat(context['asOf'])
            except (TypeError, ValueError):
                pass
            if not valid_date or not all(isinstance(item.get(key), str) and item[key].strip()
                    for key in ('priceQuoteId', 'priceArea', 'priceSource')):
                provenance = False
            else:
                price_ids.append(item['priceQuoteId'])
    verified = bool(meals and measured['priceCoverage']['complete'] and measured['estimatedCost'] is not None and provenance)
    if budget and measured['currency'] not in (None, budget['currency']):
        verified = False
    within = verified and (not budget or Decimal(str(measured['estimatedCost'])) <= Decimal(str(budget['amount'])))
    budget_status = None if budget is None else {**budget, 'estimatedCost': measured['estimatedCost'],
        'verified': verified, 'withinBudget': bool(within), 'priceQuoteIds': list(dict.fromkeys(price_ids))}
    measured['mealAllocations'] = evidence
    result=(measured,must_use,budget_status)
    if active is not None and len(active.memo)<1024:active.memo[memo_key]=result
    checkpoint()
    return result


def _meals(first, selected, ingredients, intent, favorites):
    return [{'dayIndex': day, 'date': (first + timedelta(days=day)).isoformat(),
             'recipe': _card(row, ingredients, intent, favorites)} for day, row in selected]


def _select_meals(first, servings, settings, ranked, intent, favorites, context, warnings):
    distinct = _distinct_rows(ranked)
    if not (settings['mustUseIngredients'] or settings['budget']):
        return list(enumerate(distinct[:settings['mealCount']])), None
    # Fetch real source amounts before checking exact ingredient names. The
    # bounded search is deterministic; it never claims to be an optimal solver.
    distinct=distinct[:SEARCH_LIMIT]
    ingredients = _ingredients([row['id'] for row in distinct])
    resolved = _resolver(context)
    required = {resolved(name) for name in settings['mustUseIngredients']}
    def source_names(row):
        card = _card(row, ingredients, intent, favorites)
        return {resolved(item['name']) for item in shopping_list([{'recipe': card}], servings)
                if not item['requiresReview'] and item['quantity'] > 0}
    if required:
        names = {row['id']: source_names(row) for row in distinct}
        if settings['mustUseScope'] == 'perMeal':
            distinct = [row for row in distinct if required <= names[row['id']]]
        else:
            positions = {row['id']: position for position, row in enumerate(distinct)}
            distinct.sort(key=lambda row: (-len(required & names[row['id']]), positions[row['id']]))
    if len(distinct) > SEARCH_LIMIT:
        warnings.append(f'Planning evaluated up to {SEARCH_LIMIT} ranked dinner candidates. This bounded search does not guarantee a globally cheapest plan.')
    candidates, selected = distinct[:MEASURED_SEARCH_LIMIT], []
    if len(distinct)>MEASURED_SEARCH_LIMIT:
        warnings.append(f'Measured planning evaluates up to {MEASURED_SEARCH_LIMIT} candidates; this bounded search does not prove a global optimum.')
    if settings['budget']:
        # Cheap feasible starting points leave room for later meals and pack reuse.
        costs = {}
        for row in candidates:
            from src.request_context import checkpoint
            checkpoint()
            meal = _meals(first, [(0, row)], ingredients, intent, favorites)
            _, _, cost = _pantry_evidence(meal, shopping_list(meal, servings), settings, context)
            costs[row['id']] = cost['estimatedCost'] if cost['verified'] else float('inf')
        positions = {row['id']: position for position, row in enumerate(candidates)}
        candidates.sort(key=lambda row: (costs[row['id']], positions[row['id']]))
    covered = set()
    while candidates and len(selected) < settings['mealCount']:
        best, best_score, best_covered = None, None, None
        for row in candidates:
            from src.request_context import checkpoint
            checkpoint()
            trial = selected + [(len(selected), row)]
            meals = _meals(first, trial, ingredients, intent, favorites)
            _, must, cost = _pantry_evidence(meals, shopping_list(meals, servings), settings, context)
            if settings['mustUseScope'] == 'perMeal' and not must['satisfied']:
                continue
            if cost and (not cost['verified'] or not cost['withinBudget']):
                continue
            actual = {resolved(item['ingredient']) for item in must['allocations'] if item['quantity'] > 0}
            progress = len(required & actual) - len(required & covered)
            score = (progress, -candidates.index(row)) if settings['mustUseScope'] == 'plan' else (0, -candidates.index(row))
            if best_score is None or score > best_score:
                best, best_score, best_covered = row, score, actual
            if settings['mustUseScope'] == 'perMeal' or not required or required <= actual:
                break
        if best is None:
            break
        selected.append((len(selected), best))
        candidates.remove(best)
        covered = best_covered
    if required and settings['mustUseScope'] == 'plan':
        # A partial plan must itself still honour all hard must-use conditions.
        # Return the largest valid prefix or no chosen meals, never an apparent
        # complete plan with one required ingredient silently omitted.
        while selected:
            meals = _meals(first, selected, ingredients, intent, favorites)
            _, must, _ = _pantry_evidence(meals, shopping_list(meals, servings), settings, context)
            if must['satisfied']:
                break
            selected.pop()
    return selected, ingredients


def _plan(first, servings, settings, parsed, intent, selected, ranked, favorites, used, warnings, checked, context=None, ingredients=None, pricing=None,reuse=None):
    selected_ids = [row['id'] for _, row in selected]
    selected_titles = {re.sub(r'\W+', ' ', row['title'].lower()).strip() for _, row in selected}
    alternatives = [row for row in _distinct_rows(ranked, selected_ids)
        if re.sub(r'\W+', ' ', row['title'].lower()).strip() not in selected_titles]
    constrained = context is not None and (settings['mustUseIngredients'] or settings['budget'])
    alternatives = alternatives[:MEASURED_SEARCH_LIMIT if constrained else ALTERNATIVES]
    ingredients = ingredients or _ingredients(selected_ids + [row['id'] for row in alternatives])
    if constrained:
        possible = []
        for row in alternatives:
            # Each displayed alternative is a valid swap for at least one slot.
            slots = selected or [(0, None)]
            for day, _ in slots:
                swapped = [(index, row if index == day else current) for index, current in selected] if selected else [(0, row)]
                trial = _meals(first, swapped, ingredients, intent, favorites)
                _, must, budget = _pantry_evidence(trial, shopping_list(trial, servings), settings, context)
                if must['satisfied'] and (not budget or budget['verified'] and budget['withinBudget']):
                    possible.append(row)
                    break
            if len(possible) == ALTERNATIVES:
                break
        alternatives = possible
    else:
        alternatives = alternatives[:ALTERNATIVES]
    meals = _meals(first, selected, ingredients, intent, favorites)
    for meal in meals:
        if reuse and meal['dayIndex'] in reuse:meal['reuse']=reuse[meal['dayIndex']]
    shopping = shopping_list(meals, servings)
    if len(meals) < settings['mealCount']:
        warnings.append(f"Partial plan: {len(meals)} of {settings['mealCount']} dinners. No time, dietary, ingredient, must-use or budget constraints were relaxed.")
    if any(item['requiresReview'] for item in shopping):
        warnings.append('Some shopping amounts or source servings are unclear. Those source lines are marked for review and are not combined or scaled.')
    if reuse:
        warnings.append('Reused cooked portions are a preview of your confirmed records, not a food-safety guarantee. Confirm consumption explicitly; raw ingredients are not debited again.')
    requirements = _requirements(settings)
    measured, must_use, budget = (None, None, None)
    if context is not None:
        measured, must_use, budget = _pantry_evidence(meals, shopping, settings, context)
        warnings += measured['warnings']
        if not must_use['satisfied']:
            warnings.append('Must-use is not satisfied: every required ingredient needs a positive measured pantry allocation in the chosen scope. Unknown amounts, incompatible units and expired stock do not count.')
        if budget and not budget['verified']:
            warnings.append('Budget cannot be verified: every missing amount needs a same-currency pack quote with ID, area, source and observation date. Unknown prices are never counted as zero.')
        elif budget and not budget['withinBudget']:
            warnings.append('The selected dinners exceed the original budget.')
    if pricing is not None:
        used_quotes = list(dict.fromkeys(item['priceQuoteId'] for item in measured['shoppingList'] if item.get('priceQuoteId')))
        pricing = {**pricing, 'usedQuoteIds': used_quotes}
    return {'weekStart': first.isoformat(), 'servings': servings, 'settings': settings,
        'intent': {**intent, '_parsed': parsed, '_requirements': requirements,
            **({'_pricing': pricing} if pricing is not None else {}),
            '_signature': _signature(parsed, settings['prompt'], requirements, pricing)},
        'meals': meals, 'alternatives': [_card(row, ingredients, intent, favorites) for row in alternatives],
        'shoppingList': shopping, 'checkedItems': [item['key'] for item in shopping if item['key'] in checked],
        'warnings': list(dict.fromkeys(warnings)), 'model': ai.TEXT_MODEL, 'local': True,
        'personalization': {'usedProfile': bool(used), 'favoritesUsed': len(set(selected_ids) & set(favorites)),
                            'leftoverMealsUsed':len(reuse or {})},
        'pantryCoverage': measured, 'mustUseStatus': must_use, 'budgetStatus': budget}


def _reuse_selection(settings,profile,first,servings,rows,selected,warnings):
    reuse={}
    if settings['useLeftovers'] and not settings['mustUseIngredients']:
        from src.leftover_planning import allocate
        reused,reuse=allocate(profile,first,servings,rows,settings['mealCount'])
        free=[day for day in range(settings['mealCount']) if day not in reuse]
        fresh=[row for _,row in selected if row['id'] not in {row['id'] for _,row in reused}]
        selected=sorted(reused+list(zip(free,fresh)))
    elif settings['useLeftovers']:
        warnings.append('Leftover reuse is disabled while a raw-ingredient must-use condition is active.')
    return selected,reuse


def _leftover_candidate_ids(settings,profile):
    if not settings['useLeftovers'] or settings['mustUseIngredients']:return []
    from src.leftover_planning import records
    return list(dict.fromkeys(item.recipe_id for item in records(profile)))[:100]



def generate(body):
    first, servings, settings = _settings(body)
    _key()  # Do not spend model work when canonical recalculation cannot be secured.
    parsed = _canonical_intent(ai.parse_intent(settings['prompt'])) if settings['prompt'] else _empty_intent()
    # Bind initial manual constraints as well as the model parse. An unsigned
    # settings edit must not erase an exclusion during a swap or canonical save.
    parsed, _, _, _, _ = _constraints(parsed, settings, {})
    intent, favorites, dislikes, used, warnings = _constraints(parsed, settings, body.get('profile', {}))
    extra=_leftover_candidate_ids(settings,body.get('profile',{}))
    rows = _eligible_rows(intent, dislikes,extra) if extra else _eligible_rows(intent, dislikes)
    available = body.get('profile', {}).get('availableIngredients', [])
    ranked = _ranked_rows(rows, intent, favorites, available) if available else _ranked_rows(rows, intent, favorites)
    ranked = _taste_rank(ranked,body.get('profile',{}),settings)
    context = _pantry_context(settings, body.get('profile', {}))
    pricing = _pin_prices(context, settings['budget'])
    context = _priced_context(context, pricing)
    selected, ingredients = _select_meals(first, servings, settings, ranked, intent, favorites, context, warnings)
    selected,reuse=_reuse_selection(settings,body.get('profile',{}),first,servings,rows,selected,warnings)
    return _plan(first, servings, settings, parsed, intent, selected, ranked, favorites, used, warnings, set(), context, ingredients, pricing,reuse)


def recalculate(body):
    return _recalculate(body)


def refresh_prices(body):
    return _recalculate(body, refresh=True)


def _recalculate(body, refresh=False):
    first, servings, settings = _settings(body)
    parsed, requirements, pricing = _verified_intent(body.get('intent'), settings['prompt'])
    settings = _merge_requirements(requirements, settings)
    parsed, _, _, _, _ = _constraints(parsed, settings, {})
    intent, favorites, dislikes, used, warnings = _constraints(parsed, settings, body.get('profile', {}))
    meals = body.get('meals')
    if not isinstance(meals, list) or len(meals) > settings['mealCount']:
        raise ai.AIError('Dinner selections exceed the requested meal count.')
    selected_ids, selected_days = [], []
    for meal in meals:
        if not isinstance(meal, dict) or type(meal.get('dayIndex')) is not int or not 0 <= meal['dayIndex'] < settings['mealCount']:
            raise ai.AIError('Each dinner needs a day index inside the requested meal count.')
        recipe_id = _uuid_list([meal.get('recipeId')], 1)[0]
        if meal['dayIndex'] in selected_days or recipe_id in selected_ids and not meal.get('leftoverId'):
            raise ai.AIError('Each day and dinner recipe must be unique.', 422)
        selected_days.append(meal['dayIndex'])
        selected_ids.append(recipe_id)
    checked = body.get('checkedItems', [])
    if not isinstance(checked, list) or len(checked) > 500 or any(not isinstance(key, str) or len(key) > 120 for key in checked):
        raise ai.AIError('Shopping checkmarks are invalid.')
    rows = _eligible_rows(intent, dislikes, selected_ids)
    by_id = {row['id']: row for row in rows}
    if any(recipe_id not in by_id for recipe_id in selected_ids):
        raise ai.AIError('A selected dinner is unavailable or no longer meets the public recipe, time, dietary or exclusion conditions. Choose a new alternative.', 422)
    available = body.get('profile', {}).get('availableIngredients', [])
    ranked = _ranked_rows(rows, intent, favorites, available) if available else _ranked_rows(rows, intent, favorites)
    ranked = _taste_rank(ranked,body.get('profile',{}),settings)
    selected = sorted(zip(selected_days, [by_id[recipe_id] for recipe_id in selected_ids]))
    from src.leftover_planning import validate_selected
    if any(meal.get('leftoverId') for meal in meals) and (not settings['useLeftovers'] or settings['mustUseIngredients']):
        raise ai.AIError('Leftover selections require explicit reuse without raw-ingredient must-use conditions.',422)
    reuse=validate_selected(body.get('profile',{}),first,servings,meals)
    titles = [re.sub(r'\W+', ' ', row['title'].lower()).strip() for day, row in selected if day not in reuse]
    if len(titles) != len(set(titles)):
        raise ai.AIError('Choose different dinner recipes for each day.', 422)
    context = _pantry_context(settings, body.get('profile', {}))
    if refresh and context is None:
        raise ai.AIError('Sign in and choose the original pantry to refresh price observations.', 422)
    pricing = _pin_prices(context, settings['budget']) if refresh or pricing is None else pricing
    context = _priced_context(context, pricing)
    result = _plan(first, servings, settings, parsed, intent, selected, ranked, favorites, used, warnings, set(checked), context, pricing=pricing,reuse=reuse)
    if result['mustUseStatus'] and not result['mustUseStatus']['satisfied']:
        raise ai.AIError('The selected dinners no longer have positive measured stock allocations for every must-use condition. Generate a new plan or choose different dinners.', 422)
    if result['budgetStatus'] and (not result['budgetStatus']['verified'] or not result['budgetStatus']['withinBudget']):
        raise ai.AIError('The selected dinners cannot satisfy the original verified budget. Review quantities and pack quotes or generate a new plan.', 422)
    return result


def what_if(body):
    """Explicit deterministic replan preview; callers choose whether to apply it."""
    first, servings, settings = _settings(body)
    parsed, requirements, pricing = _verified_intent(body.get('intent'), settings['prompt'])
    settings = _merge_requirements(requirements, settings)
    parsed, _, _, _, _ = _constraints(parsed, settings, {})
    intent, favorites, dislikes, used, warnings = _constraints(parsed, settings, body.get('profile', {}))
    context = _pantry_context(settings, body.get('profile', {}))
    pricing = _pin_prices(context, settings['budget']) if pricing is None else pricing
    context = _priced_context(context, pricing)
    extra=_leftover_candidate_ids(settings,body.get('profile',{}))
    rows = _eligible_rows(intent, dislikes,extra) if extra else _eligible_rows(intent, dislikes)
    available = body.get('profile', {}).get('availableIngredients', [])
    ranked = _ranked_rows(rows, intent, favorites, available) if available else _ranked_rows(rows, intent, favorites)
    ranked = _taste_rank(ranked,body.get('profile',{}),settings)
    selected, ingredients = _select_meals(first, servings, settings, ranked, intent, favorites, context, warnings)
    selected,reuse=_reuse_selection(settings,body.get('profile',{}),first,servings,rows,selected,warnings)
    return _plan(first, servings, settings, parsed, intent, selected, ranked, favorites, used, warnings, set(), context, ingredients, pricing,reuse)


# Stable public domain API for pantry and other worker modules.
def canonical_intent(*args, **kwargs):
    return _canonical_intent(*args, **kwargs)

def empty_intent(*args, **kwargs):
    return _empty_intent(*args, **kwargs)

def effective_constraints(*args, **kwargs):
    return _constraints(*args, **kwargs)

def rank_recipes(*args, **kwargs):
    return _ranked_rows(*args, **kwargs)

def eligible_recipes(*args, **kwargs):
    return _eligible_rows(*args, **kwargs)

def source_ingredients(*args, **kwargs):
    return _ingredients(*args, **kwargs)

def recipe_card(*args, **kwargs):
    return _card(*args, **kwargs)

def parse_quantity(*args, **kwargs):
    return _number(*args, **kwargs)

def format_quantity(*args, **kwargs):
    return _format_number(*args, **kwargs)


def rank_taste(*args,**kwargs):
    return _taste_rank(*args,**kwargs)
