import copy
import os
import unittest
from unittest.mock import MagicMock, patch
from src import meal_planner as planner
from src import local_ai as ai

KEY = 'meal-planner-unit-test-key-32-characters'


def recipe(index, title=None, servings=4):
    return {'id': f'00000000-0000-0000-0000-{index:012d}', 'title': title or f'Dinner {index}',
        'description': 'A dinner', 'image_url': f'/recipe-images/{index}.jpg',
        'time': 30, 'servings': servings, 'source_url': 'https://example.com/recipe'}


def ingredient(quantity='200', unit='g', name='rice', ingredient_id='rice-id'):
    return {'id': ingredient_id, 'name': name, 'quantity': quantity, 'unit': unit}


def request(**changes):
    body = {'weekStart': '2026-10-12', 'servings': 2, 'maxCookTime': 45, 'prompt': '',
        'dietaryPreferences': [], 'excludedIngredients': [], 'useProfile': True, 'profile': {}}
    body.update(changes)
    return body


class MealPlannerDietSQLTests(unittest.TestCase):
    def test_public_plan_eligibility_checks_source_labels_and_listed_contradictions(self):
        from src.dietary_guards import diet_block_pattern
        connection, engine = MagicMock(), MagicMock()
        connection.execute.return_value.mappings.return_value.all.return_value = []
        engine.connect.return_value.__enter__.return_value = connection
        parsed = {**planner._empty_intent(), 'maxCookingTime': 45, 'dietaryPreferences': ['vegan']}
        with patch.object(ai, '_db', return_value=engine):
            self.assertEqual([], planner._eligible_rows(parsed, []))
        sql, parameters = connection.execute.call_args.args
        self.assertIn('recipe_dietary_pref', str(sql))
        self.assertIn('r.is_public = true', str(sql))
        self.assertIn('regexp_like(lower(i.name), :diet_contradiction0)', str(sql))
        self.assertEqual(diet_block_pattern('vegan'), parameters['diet_contradiction0'])
        self.assertEqual([], parsed['allergies'])


class MealPlannerTests(unittest.TestCase):
    def test_standalone_sauces_and_condiments_are_not_dinners_but_complete_dishes_remain(self):
        for title in ['Bread sauce', 'Classic gravy', 'Tomato sauce', 'Salad dressing', 'Chicken stock',
                      'Red onion chutney', 'Garlic dip', 'Sauce vierge', 'Spiced marinade']:
            self.assertFalse(planner._dinner_title(title), title)
        for title in ['Chicken with tomato sauce', 'Pasta in mushroom sauce', 'Salmon and herb sauce',
                      'Chicken curry', 'Rice and beans']:
            self.assertTrue(planner._dinner_title(title), title)

    def setUp(self):
        self.key = patch.dict(os.environ, {'MEAL_PLANNER_SIGNING_KEY': KEY})
        self.key.start()
        self.rows = [recipe(index) for index in range(1, 26)]
        self.eligible = patch.object(planner, '_eligible_rows', return_value=self.rows).start()
        self.ranking = patch.object(ai, '_rank', side_effect=lambda rows, intent: rows).start()
        self.similarity = patch.object(planner, '_favorite_similarity', return_value={}).start()
        self.ingredients = patch.object(planner, '_ingredients', side_effect=lambda ids: {rid: [ingredient()] for rid in ids}).start()
        self.parse = patch.object(ai, 'parse_intent', return_value=planner._empty_intent()).start()
        self.addCleanup(patch.stopall)
        self.addCleanup(self.key.stop)

    def recalc_body(self, plan, **changes):
        body = request(**plan['settings'], weekStart=plan['weekStart'], servings=plan['servings'],
            intent=plan['intent'], meals=[{'dayIndex': m['dayIndex'], 'recipeId': m['recipe']['id']} for m in plan['meals']], checkedItems=plan['checkedItems'])
        body.update(changes)
        return body

    def test_generate_seven_unique_dinners_dates_alternatives_and_canonical_quantities(self):
        plan = planner.generate(request())
        self.assertEqual(7, len(plan['meals']))
        self.assertEqual(list(range(7)), [meal['dayIndex'] for meal in plan['meals']])
        self.assertEqual('2026-10-18', plan['meals'][-1]['date'])
        self.assertEqual(7, len({meal['recipe']['id'] for meal in plan['meals']}))
        self.assertEqual(14, len(plan['alternatives']))
        selected = {meal['recipe']['id'] for meal in plan['meals']}
        self.assertFalse(selected & {r['id'] for r in plan['alternatives']})
        self.assertEqual('700 g', plan['shoppingList'][0]['quantityText'])
        self.assertEqual(7, len(plan['shoppingList'][0]['contributions']))
        self.assertFalse(plan['shoppingList'][0]['requiresReview'])
        self.parse.assert_not_called()
        self.assertTrue(plan['local'])

    def test_profile_aliases_allergy_time_and_diet_never_relax(self):
        self.parse.return_value = {**planner._empty_intent(), 'allergies': ['egg'], 'maxCookingTime': 20}
        profile = {'usedProfile': True, 'dietaryPreferences': ['vegan', 'Dairy free'], 'allergies': ['peanuts'],
                   'favoriteRecipeIds': [], 'dislikedRecipeIds': [self.rows[0]['id']]}
        plan = planner.generate(request(prompt='quick dinner without eggs', dietaryPreferences=['gluten free'], excludedIngredients=['sesame'], profile=profile))
        actual, dislikes = self.eligible.call_args.args
        self.assertEqual(20, actual['maxCookingTime'])
        self.assertEqual({'vegan', 'gluten-free'}, set(actual['dietaryPreferences']))
        self.assertEqual({'egg', 'sesame', 'peanut', 'dairy'}, set(actual['allergies']))
        self.assertEqual([self.rows[0]['id']], dislikes)
        self.assertTrue(plan['personalization']['usedProfile'])
        self.assertTrue(any('Saved preference' in w for w in plan['warnings']))

    def test_opt_out_skips_profile_but_dislikes_are_always_required(self):
        profile = {'usedProfile': True, 'dietaryPreferences': ['unsupported'], 'allergies': ['dairy'],
            'favoriteRecipeIds': [self.rows[-1]['id']], 'dislikedRecipeIds': [self.rows[0]['id']]}
        plan = planner.generate(request(useProfile=False, profile=profile))
        actual, dislikes = self.eligible.call_args.args
        self.assertEqual([], actual['allergies'])
        self.assertEqual([], actual['dietaryPreferences'])
        self.assertEqual([self.rows[0]['id']], dislikes)
        self.assertEqual({'usedProfile': False, 'favoritesUsed': 0, 'leftoverMealsUsed': 0}, plan['personalization'])
        self.similarity.assert_called_once()
        self.assertEqual([], self.similarity.call_args.args[1])

    def test_favorite_boost_after_hard_eligibility_and_dislike_conflict(self):
        favorite = self.rows[20]['id']
        plan = planner.generate(request(profile={'usedProfile': True, 'favoriteRecipeIds': [favorite]}))
        self.assertEqual(favorite, plan['meals'][0]['recipe']['id'])
        self.assertEqual(1, plan['personalization']['favoritesUsed'])
        self.assertIn('Saved in your favourites', plan['meals'][0]['recipe']['matchReasons'])
        planner.generate(request(profile={'usedProfile': True, 'favoriteRecipeIds': [favorite], 'dislikedRecipeIds': [favorite]}))
        self.assertEqual([], self.similarity.call_args.args[1])

    def test_unsupported_profile_diet_and_conflicting_request_are_visible_failures(self):
        with self.assertRaises(ai.AIError) as error:
            planner.generate(request(profile={'usedProfile': True, 'dietaryPreferences': ['pescatarian']}))
        self.assertEqual(422, error.exception.status)
        self.parse.return_value = {**planner._empty_intent(), 'ingredients': ['peanut']}
        with self.assertRaises(ai.AIError) as error:
            planner.generate(request(prompt='use peanut', excludedIngredients=['peanuts']))
        self.assertEqual(422, error.exception.status)

    def test_known_yield_bonus_only_breaks_close_rankings_and_favorites_still_matter(self):
        self.rows[0]['servings'] = 0
        plan = planner.generate(request())
        self.assertEqual(self.rows[1]['id'], plan['meals'][0]['recipe']['id'])
        plan = planner.generate(request(profile={'usedProfile': True, 'favoriteRecipeIds': [self.rows[0]['id']]}))
        self.assertEqual(self.rows[0]['id'], plan['meals'][0]['recipe']['id'])
        self.assertTrue(any(item['requiresReview'] for item in plan['shoppingList']))
        self.assertTrue(any('source servings are unclear' in warning for warning in plan['warnings']))

    def test_insufficient_distinct_pool_returns_partial_and_never_fills_by_relaxing(self):
        self.eligible.return_value = [recipe(1, 'Curry'), recipe(2, 'Curry'), recipe(3, 'Soup')]
        plan = planner.generate(request(excludedIngredients=['dairy']))
        self.assertEqual(2, len(plan['meals']))
        self.assertTrue(any('2 of 7' in w for w in plan['warnings']))
        self.assertEqual(1, self.eligible.call_count)
        self.assertEqual(['dairy'], self.eligible.call_args.args[0]['allergies'])
        self.eligible.return_value = []
        plan = planner.generate(request())
        self.assertEqual([], plan['meals'])
        self.assertEqual([], plan['shoppingList'])
        self.assertTrue(any('0 of 7' in w for w in plan['warnings']))

    def test_recalculate_swap_refetches_no_llm_and_preserves_only_known_checkmarks(self):
        plan = planner.generate(request(prompt='dinner', excludedIngredients=['peanut']))
        self.parse.reset_mock()
        body = self.recalc_body(plan, servings=4, weekStart='2026-11-02')
        body['meals'][0]['recipeId'] = plan['alternatives'][0]['id']
        body['meals'][0]['recipe'] = {'title': 'untrusted client snapshot'}
        body['checkedItems'] = [plan['shoppingList'][0]['key'], 'forged-key']
        updated = planner.recalculate(body)
        self.parse.assert_not_called()
        self.assertEqual('2026-11-02', updated['meals'][0]['date'])
        self.assertEqual(plan['alternatives'][0]['title'], updated['meals'][0]['recipe']['title'])
        self.assertEqual('1400 g', updated['shoppingList'][0]['quantityText'])
        self.assertEqual([plan['shoppingList'][0]['key']], updated['checkedItems'])
        self.assertEqual(['peanut'], self.eligible.call_args.args[0]['allergies'])

    def test_signed_initial_manual_exclusions_cannot_be_removed_by_outer_intent_or_settings(self):
        plan = planner.generate(request(excludedIngredients=['dairy'], dietaryPreferences=['vegan'], maxCookTime=30))
        body = self.recalc_body(plan, excludedIngredients=[], dietaryPreferences=[], maxCookTime=240)
        body['intent'] = copy.deepcopy(body['intent'])
        body['intent']['allergies'] = []
        body['intent']['dietaryPreferences'] = []
        body['intent']['maxCookingTime'] = 240
        planner.recalculate(body)
        actual = self.eligible.call_args.args[0]
        self.assertEqual(['dairy'], actual['allergies'])
        self.assertEqual(['vegan'], actual['dietaryPreferences'])
        self.assertEqual(30, actual['maxCookingTime'])

    def test_recalculate_signature_prompt_and_private_unavailable_dislike_rejected(self):
        plan = planner.generate(request(prompt='without milk'))
        for mutation in ['signature', 'parsed', 'prompt', 'missing']:
            body = self.recalc_body(copy.deepcopy(plan))
            if mutation == 'signature': body['intent']['_signature'] = '0' * 64
            if mutation == 'parsed': body['intent']['_parsed']['allergies'] = ['peanut']
            if mutation == 'prompt': body['prompt'] = 'a different request'
            if mutation == 'missing': body['intent'].pop('_parsed')
            with self.assertRaises(ai.AIError) as error:
                planner.recalculate(body)
            self.assertEqual(422, error.exception.status)
        # Simulate DB eligibility changing due to private visibility/filter/dislike.
        self.eligible.return_value = self.rows[1:]
        with self.assertRaises(ai.AIError) as error:
            planner.recalculate(self.recalc_body(plan))
        self.assertEqual(422, error.exception.status)
        self.assertNotIn(self.rows[0]['title'], str(error.exception))

    def test_recalculate_duplicate_days_ids_and_malformed_ids_rejected(self):
        plan = planner.generate(request())
        for change in ['day', 'id', 'range', 'uuid']:
            body = self.recalc_body(copy.deepcopy(plan))
            if change == 'day': body['meals'][1]['dayIndex'] = 0
            if change == 'id': body['meals'][1]['recipeId'] = body['meals'][0]['recipeId']
            if change == 'range': body['meals'][1]['dayIndex'] = 7
            if change == 'uuid': body['meals'][1]['recipeId'] = 'not-a-uuid'
            with self.assertRaises(ai.AIError):
                planner.recalculate(body)

    def test_source_sql_has_public_dinner_original_photo_and_every_hard_constraint(self):
        # Exercise actual SQL builder, not the mocked candidate selection.
        patch.stopall()
        connection, engine = MagicMock(), MagicMock()
        connection.execute.return_value.mappings.return_value.all.return_value = [recipe(1, 'Chicken soup'), recipe(2, 'Chocolate brownies')]
        engine.connect.return_value.__enter__.return_value = connection
        intent = {**planner._empty_intent(), 'ingredients': ['chicken', 'carrot'], 'allergies': ['dairy', 'fish.*|peanut'], 'dietaryPreferences': ['vegan'], 'maxCookingTime': 25}
        with patch.object(ai, '_db', return_value=engine):
            rows = planner._eligible_rows(intent, [recipe(3)['id']])
        statement, parameters = connection.execute.call_args.args
        sql = str(statement)
        self.assertIn('r.is_public = true', sql)
        for side_category in ["'side dish'", "'sauce'", "'condiment'", "'dip'", "'salad dressing'"]:
            self.assertIn(side_category, sql)
        self.assertIn("r.image_kind = 'source'", sql)
        self.assertIn("'main course'", sql)
        self.assertIn("'dessert','drink'", sql)
        self.assertIn('NOT IN', sql)
        self.assertIn('ingredients0', parameters)
        self.assertIn('ingredients1', parameters)
        self.assertIn('allergies0', parameters)
        self.assertIn('milk', parameters['allergies0'])
        self.assertIn(r'fish\.\*\|peanut', parameters['allergies1'])
        self.assertEqual(25, parameters['max_time'])
        self.assertEqual('vegan', parameters['dietaryPreferences0'])
        self.assertEqual(['Chicken soup'], [row['title'] for row in rows])

    def test_quantity_fractions_exact_units_no_mass_volume_guessing_or_ambiguous_merge(self):
        first, second = recipe(1), recipe(2)
        first['ingredients'] = [ingredient('1 1/2', 'tablespoons', 'oil'), ingredient('100', 'gram', 'rice'), ingredient('1/2', 'cup', 'milk', 'milk-id')]
        second['ingredients'] = [ingredient('½', 'tbsp', 'oil'), ingredient('1', 'kg', 'rice'), ingredient('to taste', '', 'salt', 'salt-id'), ingredient('100', 'ml', 'milk', 'milk-id')]
        # Oil and rice intentionally have distinct IDs to match source identity.
        for item in first['ingredients'] + second['ingredients']:
            if item['name'] == 'oil': item['id'] = 'oil-id'
        items = planner.shopping_list([{'recipe': first}, {'recipe': second}], 2)
        oil = [item for item in items if item['name'] == 'oil']
        self.assertEqual(['1 tbsp'], [item['quantityText'] for item in oil])
        self.assertEqual({'50 g', '0.5 kg'}, {item['quantityText'] for item in items if item['name'] == 'rice'})
        self.assertEqual({'0.25 cup', '50 ml'}, {item['quantityText'] for item in items if item['name'] == 'milk'})
        salt = next(item for item in items if item['name'] == 'salt')
        self.assertTrue(salt['requiresReview'])
        self.assertIn('to taste', salt['quantityText'])

    def test_unknown_servings_ranges_units_and_extra_amounts_preserved_for_review(self):
        recipes = [recipe(1, servings=0), recipe(2)]
        recipes[0]['ingredients'] = [ingredient('200', 'g')]
        recipes[1]['ingredients'] = [ingredient('1-2', 'g'), ingredient('2', 'packs'), ingredient('100', 'ml', 'milk plus a little extra', 'milk-id'), ingredient('2', '', 'oil', 'oil-id')]
        items = planner.shopping_list([{'recipe': r} for r in recipes], 8)
        self.assertEqual(5, len(items))
        self.assertTrue(all(item['requiresReview'] for item in items))
        self.assertTrue(any(item['quantityText'].startswith('200 g') for item in items))
        self.assertTrue(any(item['quantityText'].startswith('1-2 g') for item in items))
        self.assertTrue(any(item['quantityText'].startswith('2 packs') for item in items))
        self.assertTrue(any(item['name'] == 'oil' and item['quantityText'].startswith('2 (source amount') for item in items))

    def test_validation_bounds_and_missing_persistent_key_before_model_work(self):
        for changes in [{'weekStart': '2026-02-30'}, {'weekStart': '20261012'}, {'servings': True}, {'servings': 13}, {'maxCookTime': 4}, {'maxCookTime': 241}, {'prompt': 'x'*2001}]:
            with self.assertRaises(ai.AIError):
                planner.generate(request(**changes))
        with patch.dict(os.environ, {'MEAL_PLANNER_SIGNING_KEY': ''}):
            with self.assertRaises(ai.AIError) as error:
                planner.generate(request(prompt='dinner'))
            self.assertEqual(503, error.exception.status)
        self.parse.assert_not_called()

    def pantry_profile(self, lots=None, prices=None, aliases=None):
        return {'pantry': lots if lots is not None else [self.lot()], 'priceBook': prices or [],
                'ingredientAliases': aliases or [], 'asOf': '2026-10-08'}

    def lot(self, **changes):
        return {'id': 'rice-lot', 'version': 2, 'ingredient': 'rice', 'quantity': 60,
                'unit': 'g', 'useBy': '2026-11-30', **changes}

    def price(self, **changes):
        return {'id': 'rice-quote', 'ingredient': 'rice', 'packQuantity': 250, 'packPrice': 2,
                'unit': 'g', 'currency': 'CAD', 'area': 'Toronto', 'source': 'Reviewed receipt',
                'observedOn': '2026-10-08', **changes}

    def test_preview_one_and_three_meals_has_real_scaled_quantities_and_day_bounds(self):
        for count in (1, 3):
            plan = planner.generate(request(mealCount=count))
            self.assertEqual(count, len(plan['meals']))
            self.assertEqual(f'{count * 100} g', plan['shoppingList'][0]['quantityText'])
            self.assertEqual(count, plan['settings']['mealCount'])
            body = self.recalc_body(plan)
            body['meals'][0]['dayIndex'] = count
            with self.assertRaises(ai.AIError):
                planner.recalculate(body)
        for count in (0, 2, 4, 8, True, '3'):
            with self.assertRaises(ai.AIError):
                planner.generate(request(mealCount=count))

    def test_per_meal_must_use_positive_measured_stock_is_shared_without_double_spending(self):
        plan = planner.generate(request(mealCount=3, usePantry=True, mustUseIngredients=['rice'],
            profile=self.pantry_profile()))
        status = plan['mustUseStatus']
        self.assertTrue(status['satisfied'])
        self.assertEqual('perMeal', status['scope'])
        allocations = status['allocations']
        self.assertEqual({0, 1, 2}, {row['dayIndex'] for row in allocations})
        self.assertTrue(all(row['quantity'] > 0 for row in allocations))
        self.assertAlmostEqual(60, sum(row['quantity'] for row in allocations))
        self.assertEqual(240, plan['pantryCoverage']['shoppingList'][0]['quantityMissing'])

    def test_plan_scope_can_use_different_ingredients_once_while_per_meal_cannot(self):
        self.ingredients.side_effect = lambda ids: {rid: [ingredient(name='rice' if rid == self.rows[0]['id'] else 'beans',
            ingredient_id='rice-id' if rid == self.rows[0]['id'] else 'beans-id')] for rid in ids}
        lots = [self.lot(), self.lot(id='beans-lot', ingredient='beans', quantity=100)]
        plan = planner.generate(request(mealCount=3, usePantry=True, mustUseIngredients=['rice', 'beans'],
            mustUseScope='plan', profile=self.pantry_profile(lots=lots)))
        self.assertEqual(3, len(plan['meals']))
        self.assertTrue(plan['mustUseStatus']['satisfied'])
        plan = planner.generate(request(mealCount=3, usePantry=True, mustUseIngredients=['rice', 'beans'],
            mustUseScope='perMeal', profile=self.pantry_profile(lots=lots)))
        self.assertEqual([], plan['meals'])
        self.assertFalse(plan['mustUseStatus']['satisfied'])

    def test_unknown_expired_or_incompatible_stock_and_fuzzy_names_never_satisfy_must_use(self):
        for lot in [self.lot(quantity=None), self.lot(quantity=0), self.lot(unit='cup'),
                    self.lot(useBy='2026-10-10'), self.lot(ingredient='brown rice')]:
            plan = planner.generate(request(mealCount=1, usePantry=True, mustUseIngredients=['rice'],
                profile=self.pantry_profile(lots=[lot])))
            self.assertEqual([], plan['meals'], lot)
            self.assertFalse(plan['mustUseStatus']['satisfied'])
            self.assertTrue(any('Must-use is not satisfied' in warning for warning in plan['warnings']))
        plan = planner.generate(request(mealCount=1, usePantry=True, mustUseIngredients=['brown rice'],
            profile=self.pantry_profile(lots=[self.lot(ingredient='brown rice')],
                aliases=[{'alias': 'brown rice', 'name': 'rice'}])))
        self.assertTrue(plan['mustUseStatus']['satisfied'])

    def test_budget_uses_pack_ceiling_quote_provenance_and_never_unknown_price_zero(self):
        profile = self.pantry_profile(lots=[], prices=[self.price()])
        plan = planner.generate(request(mealCount=3, usePantry=True, budget={'amount': 4, 'currency': 'CAD'}, profile=profile))
        self.assertEqual(3, len(plan['meals']))
        self.assertEqual(4, plan['budgetStatus']['estimatedCost'])
        self.assertTrue(plan['budgetStatus']['verified'])
        self.assertTrue(plan['budgetStatus']['withinBudget'])
        self.assertEqual(['rice-quote'], plan['budgetStatus']['priceQuoteIds'])
        self.assertEqual(2, plan['pantryCoverage']['shoppingList'][0]['packsToBuy'])
        plan = planner.generate(request(mealCount=3, usePantry=True, budget={'amount': 2, 'currency': 'CAD'}, profile=profile))
        self.assertEqual(2, len(plan['meals']))
        self.assertTrue(any('2 of 3' in warning for warning in plan['warnings']))
        for price in [self.price(area=None), self.price(id=None), self.price(source=''),
                      self.price(observedOn=None), self.price(observedOn='bad'), self.price(observedOn='2026-11-01'), self.price(currency='USD')]:
            plan = planner.generate(request(mealCount=1, usePantry=True, budget={'amount': 4, 'currency': 'CAD'},
                profile=self.pantry_profile(lots=[], prices=[price])))
            self.assertEqual([], plan['meals'], price)
        plan = planner.generate(request(mealCount=1, usePantry=True, budget={'amount': 4, 'currency': 'CAD'},
            profile=self.pantry_profile(lots=[], prices=[])))
        self.assertEqual([], plan['meals'])
        self.assertFalse(plan['budgetStatus']['verified'])
        self.assertFalse(plan['budgetStatus']['withinBudget'])

    def test_plan_scope_partial_does_not_choose_meals_when_one_required_stock_is_missing(self):
        plan = planner.generate(request(mealCount=3, usePantry=True, mustUseIngredients=['rice', 'beans'],
            mustUseScope='plan', profile=self.pantry_profile()))
        self.assertEqual([], plan['meals'])
        self.assertFalse(plan['mustUseStatus']['satisfied'])

    def test_must_use_alternatives_are_actual_valid_swaps(self):
        self.ingredients.side_effect = lambda ids: {rid: [ingredient(name='rice' if rid in [row['id'] for row in self.rows[:4]] else 'beans',
            ingredient_id='rice-id' if rid in [row['id'] for row in self.rows[:4]] else 'beans-id')] for rid in ids}
        plan = planner.generate(request(mealCount=3, usePantry=True, mustUseIngredients=['rice'],
            profile=self.pantry_profile()))
        self.assertEqual([self.rows[3]['id']], [row['id'] for row in plan['alternatives']])
        body = self.recalc_body(plan, profile=self.pantry_profile())
        body['meals'][0]['recipeId'] = plan['alternatives'][0]['id']
        self.assertTrue(planner.recalculate(body)['mustUseStatus']['satisfied'])

    def test_recalculate_signed_requirements_cannot_be_removed_tampered_or_disabled(self):
        profile = self.pantry_profile(prices=[self.price()])
        plan = planner.generate(request(mealCount=3, usePantry=True, mustUseIngredients=['rice'],
            budget={'amount': 4, 'currency': 'CAD'}, profile=profile))
        body = self.recalc_body(plan, mustUseIngredients=[], mustUseScope='plan', budget=None, profile=profile)
        result = planner.recalculate(body)
        self.assertEqual(['rice'], result['settings']['mustUseIngredients'])
        self.assertEqual('perMeal', result['settings']['mustUseScope'])
        self.assertEqual(4, result['settings']['budget']['amount'])
        self.parse.reset_mock()
        for mutation in ('missing', 'tampered', 'disabled', 'stock', 'currency', 'servings'):
            changed = copy.deepcopy(body)
            if mutation == 'missing': changed['intent'].pop('_requirements')
            if mutation == 'tampered': changed['intent']['_requirements']['budget']['amount'] = 100
            if mutation == 'disabled': changed['usePantry'] = False
            if mutation == 'stock': changed['profile']['pantry'] = []
            if mutation == 'currency': changed['budget'] = {'amount': 4, 'currency': 'USD'}
            if mutation == 'servings': changed['servings'] = 12
            with self.assertRaises(ai.AIError) as error:
                planner.recalculate(changed)
            self.assertEqual(422, error.exception.status, mutation)
        self.parse.assert_not_called()

    def test_legacy_signed_plan_upgrades_without_allowing_new_envelope_stripping(self):
        plan = planner.generate(request(mealCount=1))
        legacy = copy.deepcopy(plan)
        legacy['intent'].pop('_requirements')
        legacy['intent']['_signature'] = planner._signature(legacy['intent']['_parsed'], legacy['settings']['prompt'])
        result = planner.recalculate(self.recalc_body(legacy))
        self.assertIn('_requirements', result['intent'])
        tampered = self.recalc_body(result)
        tampered['intent'].pop('_requirements')
        with self.assertRaises(ai.AIError):
            planner.recalculate(tampered)

    def test_new_setting_bounds_and_missing_trusted_context_are_explicit_errors(self):
        for fields in [{'mustUseIngredients': ['rice']}, {'mustUseScope': 'week'}, {'mustUseIngredients': ['rice'] * 11},
                       {'budget': {'amount': 0, 'currency': 'CAD'}}, {'budget': {'amount': True, 'currency': 'CAD'}},
                       {'budget': {'amount': 2.123, 'currency': 'CAD'}}, {'budget': {'amount': 1000001, 'currency': 'CAD'}},
                       {'budget': {'amount': 2, 'currency': 'cad'}}, {'budget': {'amount': 'NaN', 'currency': 'CAD'}}]:
            with self.assertRaises(ai.AIError):
                planner.generate(request(**fields))
        with self.assertRaises(ai.AIError) as error:
            planner.generate(request(usePantry=True, mustUseIngredients=['rice']))
        self.assertEqual(422, error.exception.status)

    def test_price_quotes_are_pinned_until_explicit_refresh_without_silent_latest_repricing(self):
        old = self.price(version=1)
        profile = self.pantry_profile(lots=[], prices=[old])
        plan = planner.generate(request(mealCount=3, usePantry=True, budget={'amount': 4, 'currency': 'CAD'}, profile=profile))
        new = self.price(id='rice-quote-new', version=1, packPrice=.5)
        changed = self.pantry_profile(lots=[], prices=[old, new])
        body = self.recalc_body(plan, profile=changed)
        result = planner.recalculate(body)
        self.assertEqual(4, result['budgetStatus']['estimatedCost'])
        self.assertEqual(['rice-quote'], result['budgetStatus']['priceQuoteIds'])
        refreshed = planner.refresh_prices(body)
        self.assertEqual(1, refreshed['budgetStatus']['estimatedCost'])
        self.assertEqual(['rice-quote-new'], refreshed['budgetStatus']['priceQuoteIds'])
        self.assertNotEqual(plan['intent']['_signature'], refreshed['intent']['_signature'])

    def test_missing_modified_or_forged_pin_rejects_until_deliberate_valid_refresh(self):
        old = self.price(version=1)
        profile = self.pantry_profile(lots=[], prices=[old])
        plan = planner.generate(request(mealCount=3, usePantry=True, budget={'amount': 4, 'currency': 'CAD'}, profile=profile))
        for prices in [[], [self.price(id='replacement', version=1)], [self.price(version=2)], [self.price(version=1, area='Other')]]:
            body = self.recalc_body(plan, profile=self.pantry_profile(lots=[], prices=prices))
            for action in [planner.recalculate, planner.what_if]:
                with self.assertRaises(ai.AIError) as error:
                    action(body)
                self.assertEqual(422, error.exception.status)
                self.assertIn('pinned', str(error.exception))
        for mutation in ['strip', 'digest', 'quotes', 'used']:
            body = self.recalc_body(copy.deepcopy(plan), profile=profile)
            if mutation == 'strip': body['intent'].pop('_pricing')
            if mutation == 'digest': body['intent']['_pricing']['quotes'][0]['digest'] = '0' * 64
            if mutation == 'quotes': body['intent']['_pricing']['quotes'] = []
            if mutation == 'used': body['intent']['_pricing']['usedQuoteIds'] = []
            with self.assertRaises(ai.AIError):
                planner.recalculate(body)
        body = self.recalc_body(plan, profile=self.pantry_profile(lots=[], prices=[self.price(id='replacement', version=1)]))
        self.assertEqual(['replacement'], planner.refresh_prices(body)['budgetStatus']['priceQuoteIds'])
        body['profile']['priceBook'] = [self.price(id='replacement', version=1, packPrice=3)]
        with self.assertRaises(ai.AIError) as error:
            planner.refresh_prices(body)
        self.assertEqual(422, error.exception.status)

    def test_legacy_pantry_signature_is_upgraded_but_new_pricing_cannot_be_stripped(self):
        profile = self.pantry_profile(lots=[], prices=[self.price()])
        plan = planner.generate(request(mealCount=1, usePantry=True, budget={'amount': 4, 'currency': 'CAD'}, profile=profile))
        plan['intent'].pop('_pricing')
        plan['intent']['_signature'] = planner._signature(plan['intent']['_parsed'], plan['settings']['prompt'], plan['intent']['_requirements'])
        upgraded = planner.recalculate(self.recalc_body(plan, profile=profile))
        self.assertEqual(['rice-quote'], upgraded['intent']['_pricing']['usedQuoteIds'])
        forged = self.recalc_body(copy.deepcopy(upgraded), profile=profile)
        forged['intent'].pop('_pricing')
        with self.assertRaises(ai.AIError):
            planner.recalculate(forged)

    def test_what_if_explicit_preview_replans_tighter_time_without_llm_or_original_mutation(self):
        plan = planner.generate(request(mealCount=3, prompt='no dairy', maxCookTime=25, excludedIngredients=['dairy']))
        original = copy.deepcopy(plan)
        fast = [recipe(index) for index in range(100, 110)]
        for row in fast: row['time'] = 15
        self.eligible.return_value = fast
        self.parse.reset_mock()
        preview = planner.what_if(self.recalc_body(plan, maxCookTime=15, excludedIngredients=[]))
        self.assertEqual(original, plan)
        self.assertNotEqual([meal['recipe']['id'] for meal in plan['meals']], [meal['recipe']['id'] for meal in preview['meals']])
        self.assertEqual(15, preview['intent']['maxCookingTime'])
        self.assertEqual(['dairy'], preview['intent']['allergies'])
        self.parse.assert_not_called()
        self.assertEqual([], preview['checkedItems'])
        self.eligible.return_value = []
        empty = planner.what_if(self.recalc_body(preview, maxCookTime=240))
        self.assertEqual(15, empty['intent']['maxCookingTime'])
        self.assertEqual([], empty['meals'])
        self.assertTrue(any('0 of 3' in warning for warning in empty['warnings']))

    def test_what_if_keeps_original_must_use_budget_and_price_pins(self):
        profile = self.pantry_profile(prices=[self.price(version=1)])
        plan = planner.generate(request(mealCount=3, usePantry=True, mustUseIngredients=['rice'],
            budget={'amount': 4, 'currency': 'CAD'}, profile=profile))
        preview = planner.what_if(self.recalc_body(plan, mustUseIngredients=[], budget=None, maxCookTime=20, profile=profile))
        self.assertEqual(['rice'], preview['settings']['mustUseIngredients'])
        self.assertEqual(4, preview['settings']['budget']['amount'])
        self.assertTrue(preview['mustUseStatus']['satisfied'])
        self.assertTrue(preview['budgetStatus']['withinBudget'])
        self.assertEqual(plan['intent']['_pricing']['quotes'], preview['intent']['_pricing']['quotes'])

    def test_per_slot_expiry_uses_early_stock_and_preserves_late_positive_allocations(self):
        early = self.lot(id='early', quantity=100, useBy='2026-10-12')
        late = self.lot(id='late', quantity=60, useBy='2026-10-14')
        plan = planner.generate(request(mealCount=3, usePantry=True, mustUseIngredients=['rice'],
            profile=self.pantry_profile(lots=[late, early])))
        self.assertEqual(3, len(plan['meals']))
        self.assertTrue(plan['mustUseStatus']['satisfied'])
        rows = plan['mustUseStatus']['allocations']
        self.assertEqual({0}, {row['dayIndex'] for row in rows if row['lotId'] == 'early'})
        self.assertAlmostEqual(100, sum(row['quantity'] for row in rows if row['lotId'] == 'early'))
        self.assertAlmostEqual(60, sum(row['quantity'] for row in rows if row['lotId'] == 'late'))
        self.assertEqual(140, plan['pantryCoverage']['shoppingList'][0]['quantityMissing'])


if __name__ == '__main__':
    unittest.main()
