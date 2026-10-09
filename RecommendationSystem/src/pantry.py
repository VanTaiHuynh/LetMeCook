"""Measured pantry coverage and suggestions. Never infer units, prices or safety."""
from datetime import date
from decimal import Decimal, ROUND_CEILING
from fractions import Fraction
import math
import re
from src import local_ai as ai, meal_planner as planner


def canonical_name(value):
    if not isinstance(value, str) or len(value) > 200:
        raise ai.AIError('Ingredient name must contain at most 200 characters.')
    return re.sub(r'\s+', ' ', value.strip().casefold())


def unit(value):
    return planner.UNITS.get(str(value or '').strip().lower())


def positive(value):
    if isinstance(value, bool):
        return None
    try:
        number = Fraction(str(value))
        return number if number > 0 and math.isfinite(float(number)) else None
    except (ValueError, ZeroDivisionError, OverflowError):
        return None


def _dated_allocations(plan, shopping, stock, resolved, as_of, warnings):
    """Allocate dated source demands from one ledger, earliest expiry first.

    A usable lot is shared proportionally across the eligible outstanding meal
    demands. This preserves positive per-meal must-use evidence when a partial
    amount can legitimately be split, without reserving expired stock or using
    the same quantity twice. All state is a preview, never a pantry mutation.
    """
    meals = plan.get('meals')
    if not meals:
        return None
    if not isinstance(meals, list) or len(meals) > 7:
        raise ai.AIError('Dated pantry coverage requires up to seven meals.')
    dates = {}
    for meal in meals:
        if meal.get('reuse'):continue
        if not isinstance(meal, dict) or not isinstance(meal.get('recipe'), dict):
            raise ai.AIError('Dated meal source is invalid.')
        try:
            planned = date.fromisoformat(meal['date'])
        except (KeyError, ValueError, TypeError):
            raise ai.AIError('Each meal needs a valid planned date.')
        recipe_id = meal['recipe'].get('id')
        day = meal.get('dayIndex')
        if not isinstance(recipe_id, str) or recipe_id in dates or type(day) is not int or not 0 <= day <= 6:
            raise ai.AIError('Each dated meal needs a distinct recipe and valid day index.')
        dates[recipe_id] = (planned.isoformat(), day)
    demands, available, allocations = {}, {}, []
    for item in shopping:
        from src.request_context import checkpoint
        checkpoint()
        if not isinstance(item, dict):
            raise ai.AIError('Shopping lines must be objects.')
        needed = positive(item.get('quantityExact', item.get('quantity')))
        measure = unit(item.get('unit'))
        if item.get('requiresReview') or needed is None or not measure:
            continue
        contributions = item.get('contributions', [])
        if not isinstance(contributions, list) or not contributions or len(contributions) > 1000:
            warnings.append(f"{item.get('name', 'Ingredient')}: dated source quantities are incomplete; no stock is subtracted.")
            continue
        source = []
        for contribution in contributions:
            if not isinstance(contribution, dict):
                source = []
                break
            amount = positive(contribution.get('quantityExact', contribution.get('quantity')))
            recipe_id = contribution.get('recipeId')
            if amount is None or recipe_id not in dates or unit(contribution.get('unit')) != measure:
                source = []
                break
            source.append((contribution, amount))
        total = sum((amount for _, amount in source), Fraction(0))
        if not total or not math.isclose(float(total), float(needed), rel_tol=1e-9, abs_tol=1e-12):
            warnings.append(f"{item.get('name', 'Ingredient')}: dated source quantities disagree; no stock is subtracted.")
            continue
        for contribution, amount in source:
            recipe_id = contribution['recipeId']
            planned, day = dates[recipe_id]
            group = (resolved(item.get('name', '')), measure)
            demands.setdefault(group, []).append({'key': item.get('key'), 'remaining': amount * needed / total,
                'recipeId': recipe_id, 'date': planned, 'dayIndex': day})
    for rows in demands.values():
        rows.sort(key=lambda row: (row['date'], row['dayIndex'], row['recipeId'], str(row['key'])))
    for entry in stock:
        from src.request_context import checkpoint
        checkpoint()
        purchased = entry['lot'].get('purchasedOn')
        if purchased:
            try:
                purchased = date.fromisoformat(purchased).isoformat()
            except (ValueError, TypeError):
                raise ai.AIError('Pantry purchase date is invalid.')
        rows = [row for row in demands.get((entry['name'], entry['unit']), []) if row['remaining'] > 0
                and row['date'] <= entry['expiry'] and (not purchased or row['date'] >= purchased)]
        total = sum((row['remaining'] for row in rows), Fraction(0))
        amount = min(entry['remaining'], total)
        if not amount or not total:
            continue
        entry['remaining'] -= amount
        for row in rows:
            share = amount * row['remaining'] / total
            row['remaining'] -= share
            available[row['key']] = available.get(row['key'], Fraction(0)) + share
            allocations.append({'key': row['key'], 'lotId': entry['lot'].get('id'), 'quantity': float(share),
                'unit': entry['unit'], 'version': entry['lot'].get('version'), 'recipeId': row['recipeId'],
                'dayIndex': row['dayIndex'], 'date': row['date'], 'ingredient': entry['name']})
    return available, allocations


def coverage(body):
    if not isinstance(body, dict) or not isinstance(body.get('plan'), dict):
        raise ai.AIError('Provide a canonical meal plan.')
    plan, lots, prices = body['plan'], body.get('pantry', []), body.get('priceBook', [])
    shopping = plan.get('shoppingList', [])
    if not isinstance(shopping, list) or len(shopping) > 500 or not isinstance(lots, list) or len(lots) > 1000 or not isinstance(prices, list) or len(prices) > 1000:
        raise ai.AIError('Pantry or shopping list is too large.')
    try:
        as_of = date.fromisoformat(body.get('asOf', date.today().isoformat()))
    except (ValueError, TypeError):
        raise ai.AIError('Choose a valid pantry date.')
    aliases = body.get('ingredientAliases', [])
    if not isinstance(aliases, list) or len(aliases) > 1000:
        raise ai.AIError('Reviewed aliases are invalid.')
    reviewed = {canonical_name(a['alias']): canonical_name(a['name']) for a in aliases if isinstance(a, dict) and a.get('alias') and a.get('name')}
    def resolved(value):
        name = canonical_name(value)
        return reviewed.get(name, name)
    warnings, stock = [], []
    for lot in lots:
        if not isinstance(lot, dict):
            raise ai.AIError('Pantry lots must be objects.')
        expiry = lot.get('useBy')
        if expiry:
            try:
                if date.fromisoformat(expiry) < as_of:
                    warnings.append(f"{lot.get('ingredient', 'Ingredient')}: its chosen use-by date has passed; excluded from quantity coverage.")
                    continue
            except (ValueError, TypeError):
                raise ai.AIError('Pantry use-by date is invalid.')
        quantity, measure = positive(lot.get('quantity')), unit(lot.get('unit'))
        if quantity is None or not measure:
            warnings.append(f"{lot.get('ingredient', 'Ingredient')}: amount or unit is unknown; review before subtracting stock.")
            continue
        if not expiry:
            warnings.append(f"{lot.get('ingredient', 'Ingredient')}: no use-by date recorded; check its condition yourself.")
        stock.append({'lot': lot, 'remaining': quantity, 'name': resolved(lot.get('ingredient', '')), 'unit': measure, 'expiry': expiry or '9999-12-31'})
    stock.sort(key=lambda item: (item['expiry'], str(item['lot'].get('id', ''))))
    dated = _dated_allocations(plan, shopping, stock, resolved, as_of, warnings)
    result, allocations, priced, priceable, costs, currencies = [], dated[1] if dated else [], 0, 0, [], set()
    price_index = {}
    for price in prices:
        if (isinstance(price, dict) and positive(price.get('packQuantity')) is not None and positive(price.get('packPrice')) is not None
                and re.fullmatch(r'[A-Z]{3}', str(price.get('currency', ''))) and isinstance(price.get('source'), str) and price['source'].strip()):
            price_index.setdefault((resolved(price.get('ingredient', '')), unit(price.get('unit'))), []).append(price)
    for entries in price_index.values():
        entries.sort(key=lambda price: (str(price.get('observedOn', '')), str(price.get('id', ''))), reverse=True)
    all_priced = True
    for item in shopping:
        from src.request_context import checkpoint
        checkpoint()
        if not isinstance(item, dict):
            raise ai.AIError('Shopping lines must be objects.')
        row = dict(item)
        measure = unit(item.get('unit'))
        needed = positive(item.get('quantityExact', item.get('quantity')))
        # Backwards compatible canonical plans still use formatted quantityText.
        if needed is None and not item.get('requiresReview'):
            match = re.fullmatch(r'([0-9]+(?:\.[0-9]+)?|[0-9]+/[0-9]+)\s+([a-z]+)', str(item.get('quantityText', '')))
            if match:
                needed, measure = positive(match[1]), unit(match[2])
        if item.get('requiresReview') or needed is None or not measure:
            row.update({'quantityNeeded': None, 'quantityAvailable': None, 'quantityMissing': None, 'coverage': 'review', 'estimatedCost': None, 'requiresReview': True})
            all_priced = False
            result.append(row)
            continue
        name, remaining, available = resolved(item.get('name', '')), needed, Fraction(0)
        if dated:
            available = min(needed, dated[0].get(item.get('key'), Fraction(0)))
            remaining -= available
        else:
            for entry in stock:
                if entry['name'] != name or entry['unit'] != measure or entry['remaining'] <= 0:
                    continue
                amount = min(remaining, entry['remaining'])
                if amount <= 0:
                    break
                entry['remaining'] -= amount
                available += amount
                remaining -= amount
                allocations.append({'key': item.get('key'), 'lotId': entry['lot'].get('id'), 'quantity': float(amount), 'unit': measure, 'version': entry['lot'].get('version')})
        row.update({'unit': measure, 'quantityNeeded': float(needed), 'quantityAvailable': float(available), 'quantityMissing': float(remaining),
                    'coverage': 'covered' if remaining == 0 else 'partial' if available else 'missing', 'estimatedCost': 0 if remaining == 0 else None})
        if remaining > 0:
            priceable += 1
            candidates = price_index.get((name, measure), [])
            if candidates:
                price = candidates[0]
                packs = (Decimal(remaining.numerator) / Decimal(remaining.denominator) / Decimal(str(price['packQuantity']))).to_integral_value(rounding=ROUND_CEILING)
                cost = (packs * Decimal(str(price['packPrice']))).quantize(Decimal('0.01'))
                row.update({'estimatedCost': float(cost), 'currency': price['currency'], 'priceQuoteId': price.get('id'), 'priceArea': price.get('area'), 'priceSource': price['source'], 'priceObservedOn': price.get('observedOn'), 'packsToBuy': int(packs)})
                currencies.add(price['currency']); costs.append(cost); priced += 1
            else:
                all_priced = False
        result.append(row)
    if len(currencies) > 1:
        all_priced = False
        warnings.append('Prices use different currencies; a combined total is unavailable.')
    if not all_priced:
        warnings.append('Some amounts or prices need review. No complete budget total can be verified.')
    return {'shoppingList': result, 'allocations': allocations, 'estimatedCost': float(sum(costs, Decimal(0))) if all_priced else None,
            'currency': next(iter(currencies)) if len(currencies) == 1 else None,
            'priceCoverage': {'priced': priced, 'required': priceable, 'complete': all_priced}, 'asOf': as_of.isoformat(), 'warnings': list(dict.fromkeys(warnings)),
            'rules': 'Exact ingredient names and compatible unit spellings only. Stock is allocated once across dated meal demands, earliest expiry first; no density or unit conversion is guessed.'}


def affinity(rows, available):
    terms = ai._terms(available, 100)
    if not terms or not rows:
        return {}
    from sqlalchemy import text
    parameters, clauses = {}, []
    for index, term in enumerate(terms):
        parameters[f'term{index}'] = ai.ingredient_pattern(term)
        clauses.append(f'lower(i.name) ~ :term{index}')
    query = text('SELECT ri.recipe_id::text AS id, count(DISTINCT i.id) AS matches FROM public.recipe_ingredients ri JOIN public.ingredients i ON i.id=ri.ingredient_id WHERE ' + '(' + ' OR '.join(clauses) + ') GROUP BY ri.recipe_id')
    with ai._db().connect() as connection:
        return {row['id']: min(1, row['matches'] / len(terms)) for row in connection.execute(query, parameters).mappings()}


def suggest(body):
    if not isinstance(body, dict):
        raise ai.AIError('Provide pantry suggestion settings.')
    maximum = body.get('maxCookTime', 45)
    if type(maximum) is not int or not 5 <= maximum <= 240:
        raise ai.AIError('Cooking time must be between 5 and 240 minutes.')
    prompt = body.get('prompt', '')
    if not isinstance(prompt, str) or len(prompt) > 2000:
        raise ai.AIError('Request is too long.')
    parsed = planner.canonical_intent(ai.parse_intent(prompt)) if prompt.strip() else planner.empty_intent()
    required = ai._terms(body.get('mustUseIngredients', []), 20)
    parsed['ingredients'] = list(dict.fromkeys(parsed['ingredients'] + required))
    settings = {'maxCookTime': maximum, 'dietaryPreferences': ai._terms(body.get('dietaryPreferences', []), 20),
                'excludedIngredients': ai._terms(body.get('excludedIngredients', []), 30), 'useProfile': True, 'prompt': prompt}
    family=body.get('useHouseholdPreferences',False)
    if type(family) is not bool:raise ai.AIError('Choose whether to use shared household preferences.')
    settings['useHouseholdPreferences']=family
    intent, favorites, dislikes, used, warnings = planner.effective_constraints(parsed, settings, body.get('profile', {}))
    rows = planner.rank_recipes(planner.eligible_recipes(intent, dislikes), intent, favorites)
    rows = planner.rank_taste(rows,body.get('profile',{}),settings)
    available = ai._terms(body.get('availableIngredients', []), 100)
    matching = affinity(rows, available)
    positions = {row['id']: index for index, row in enumerate(rows)}
    rows = sorted(rows, key=lambda row: (-(1 / (1 + positions[row['id']] / 50) + .4 * matching.get(row['id'], 0)), row['id']))[:12]
    ingredients = planner.source_ingredients([row['id'] for row in rows])
    recipes = [planner.recipe_card(row, ingredients, intent, favorites) for row in rows]
    if not recipes:
        warnings.append('No dinner meets every requirement. Change a condition explicitly to search again.')
    return {'intent': intent, 'recipes': recipes, 'availableIngredients': available, 'mustUseIngredients': required,
            'coverageByRecipe': {row['id']: {'matchedFraction': matching.get(row['id'], 0)} for row in rows},
            'warnings': warnings, 'local': True, 'model': ai.TEXT_MODEL, 'personalization': {'usedProfile': used}}


def substitute(body):
    if not isinstance(body, dict) or not isinstance(body.get('recipe'), dict) or not isinstance(body.get('swap'), dict):
        raise ai.AIError('Choose a recipe and a reviewed substitution.')
    recipe, swap = body['recipe'], body['swap']
    servings = body.get('servings', 2)
    if type(servings) is not int or not 1 <= servings <= 12:
        raise ai.AIError('Choose 1–12 servings.')
    if swap.get('reviewed') is not True:
        raise ai.AIError('Use a reviewed substitution.', 422)
    origin, target = canonical_name(swap.get('fromIngredient', '')), canonical_name(swap.get('toIngredient', ''))
    if not origin or not target or origin == target:
        raise ai.AIError('The substitution needs two different ingredient names.')
    exclusions = ai._terms(body.get('excludedIngredients', []), 100)
    diets = ai._terms(body.get('dietaryPreferences', []), 20)
    from src.dietary_guards import listed_diet_conflict
    if listed_diet_conflict(target, diets):
        return {'supported': False, 'ingredients': [], 'changed': [], 'warnings': ['The replacement conflicts with a saved dietary preference.'], 'requiresReview': True}
    for excluded in exclusions:
        if re.search(ai.ingredient_pattern(excluded).replace(r'\m',r'\b').replace(r'\M',r'\b'), target):
            return {'supported': False, 'ingredients': [], 'changed': [], 'warnings': ['The replacement conflicts with a saved ingredient exclusion.'], 'requiresReview': True}
    ratio, yield_amount = positive(swap.get('ratio')), positive(recipe.get('servings'))
    ingredients = recipe.get('ingredients')
    if not isinstance(ingredients, list) or len(ingredients) > 100:
        raise ai.AIError('Recipe ingredient data is invalid.')
    aliases = {canonical_name(a['alias']):canonical_name(a['name']) for a in body.get('ingredientAliases', []) if isinstance(a,dict) and a.get('alias') and a.get('name')}
    origin = aliases.get(origin, origin)
    result, changed = [], []
    for ingredient in ingredients:
        if not isinstance(ingredient, dict):
            raise ai.AIError('Recipe ingredient data is invalid.')
        row = dict(ingredient)
        name = canonical_name(ingredient.get('ingredient', ingredient.get('name', '')))
        is_origin = aliases.get(name, name) == origin
        if is_origin:
            quantity, measure = planner.parse_quantity(ingredient.get('quantity')), unit(ingredient.get('unit'))
            if quantity is None or not measure or ratio is None or yield_amount is None or planner.AMBIGUOUS.search(' '.join(str(v or '') for v in ingredient.values())):
                return {'supported': False, 'ingredients': [], 'changed': [], 'warnings': ['The source amount, unit or servings is unclear. Review manually; no quantity is guessed.'], 'requiresReview': True}
            amount = quantity * ratio * Fraction(servings) / yield_amount
            row.update({'ingredient':target,'name':target,'quantity':float(amount),'unit':measure,'quantityText':planner.format_quantity(amount)+' '+measure})
            changed.append({'fromIngredient':name,'toIngredient':target,'quantity':float(amount),'unit':measure})
        if not is_origin:
            quantity, measure = planner.parse_quantity(ingredient.get('quantity')), unit(ingredient.get('unit'))
            if quantity is not None and measure and yield_amount is not None:
                amount = quantity * Fraction(servings) / yield_amount
                row.update({'quantity':float(amount),'unit':measure,'quantityText':planner.format_quantity(amount)+' '+measure})
            else:
                row['requiresReview'] = True
        result.append(row)
    for ingredient in result:
        name = canonical_name(ingredient.get('ingredient', ingredient.get('name', '')))
        name = aliases.get(name, name)
        if any(re.search(ai.ingredient_pattern(excluded).replace(r'\m',r'\b').replace(r'\M',r'\b'), name) for excluded in exclusions):
            return {'supported':False,'ingredients':[],'changed':[],'warnings':['The adapted ingredient list conflicts with a saved exclusion.'],'requiresReview':True}
        if listed_diet_conflict(name, diets):
            return {'supported':False,'ingredients':[],'changed':[],'warnings':['The adapted ingredient list conflicts with a saved dietary preference.'],'requiresReview':True}
    if not changed:
        return {'supported':False,'ingredients':result,'changed':[],'warnings':['The exact reviewed ingredient is not listed in this recipe. No substitution was applied.'],'requiresReview':True}
    return {'supported':True,'ingredients':result,'changed':changed,'sourceRecipeId':recipe.get('id'),
            'warnings':['This is a user-reviewed ingredient preview. The original cooking instructions are unchanged; check the effects on technique, texture and dietary needs before cooking.'],
            'requiresReview':True,'reviewType':swap.get('reviewType','user reviewed; not independently certified')}
