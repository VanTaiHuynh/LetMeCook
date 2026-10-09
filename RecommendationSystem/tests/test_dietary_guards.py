import unittest
from src import dietary_guards as guards


class DietaryGuardTests(unittest.TestCase):
    def test_vegetarian_rejects_known_animal_ingredients_despite_source_label(self):
        for name in ['Parma ham per portion', 'chicken stock', 'anchovies', 'prawns',
                     'beef mince', 'fish sauce', 'gelatine', 'Worcestershire sauce',
                     'chicken eggplant curry', 'duck eggplant stir-fry']:
            self.assertTrue(guards.listed_diet_conflict(name, ['vegetarian']), name)
        for name in ['tomato', 'chickpeas', 'eggplant', 'cream cheese', 'duck eggs',
                     'oyster mushrooms', "lamb’s lettuce", 'vegetable suet']:
            self.assertFalse(guards.listed_diet_conflict(name, ['vegetarian']), name)

    def test_vegan_rejects_additional_dairy_egg_and_bee_products(self):
        for name in ['whole milk', 'cream cheese', 'butter', 'whey protein', 'duck eggs',
                     'egg noodles', 'mayonnaise', 'honey', 'chicken stock']:
            self.assertTrue(guards.listed_diet_conflict(name, ['vegan']), name)
        for name in ['peanut butter', 'coconut milk', 'coconut  milk', 'oat milk',
                     'soy yoghurt', 'cream of tartar', 'butter beans', 'eggplant',
                     'chickpeas', 'honeydew melon']:
            self.assertFalse(guards.listed_diet_conflict(name, ['vegan']), name)

    def test_explicit_plant_alternatives_are_local_to_the_matched_clause(self):
        for name in ['vegan butter', 'vegan cream cheese', 'plant-based chicken pieces',
                     'sliced vegan ham', 'dairy-free milk', 'egg-free mayonnaise',
                     'butter (vegan)', '(vegan) butter', 'coconut milk and vegan cream']:
            self.assertFalse(guards.listed_diet_conflict(name, ['vegan']), name)
        for name in ['vegan cheese and ham', 'coconut milk with cream',
                     'ham or vegetarian alternative', 'butter or vegan alternative',
                     'vegan sausages with pork', 'coconut milk, butter',
                     'vegan butter plus honey', 'cream and egg-free mayonnaise',
                     'oat milk or regular milk', 'vegan cheese & ham',
                     'vegan butter + honey', 'vegan cheese (contains milk)',
                     'vegan cheese (milk, salt)', 'vegan-ish ham', 'vegan? chicken']:
            self.assertTrue(guards.listed_diet_conflict(name, ['vegan']), name)
        self.assertFalse(guards.listed_diet_conflict('vegetarian sausages', ['vegetarian']))
        self.assertTrue(guards.listed_diet_conflict('vegetarian sausages', ['vegan']))

    def test_ingredient_word_boundaries_and_unrelated_diets_do_not_invent_restrictions(self):
        for name in ['hamper', 'codling apples', 'beefsteak tomatoes', 'butternut squash']:
            self.assertFalse(guards.listed_diet_conflict(name, ['vegetarian', 'vegan']), name)
        self.assertFalse(guards.listed_diet_conflict('Parma ham', ['gluten-free']))
        self.assertIsNone(guards.diet_block_pattern('low-fat'))

    def test_sql_filters_are_added_before_ranking_using_identical_patterns(self):
        clauses, parameters = ['r.is_public = true'], {}
        guards.append_diet_guards(clauses, parameters, ['vegetarian', 'gluten-free'])
        self.assertEqual(2, len(clauses))
        self.assertIn('NOT EXISTS', clauses[1])
        self.assertIn('regexp_like(lower(i.name)', clauses[1])
        self.assertEqual({'diet_contradiction0': guards.diet_block_pattern('vegetarian')}, parameters)


if __name__ == '__main__':
    unittest.main()
