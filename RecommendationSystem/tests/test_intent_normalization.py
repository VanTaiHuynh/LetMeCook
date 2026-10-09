"""Regressions from the first actual pinned-model authored-corpus run.

Model observations are fixture inputs, not quality results for the correction.
The labelled corpus and gate thresholds remain unchanged.
"""
import os
import unittest
from unittest.mock import MagicMock,patch

from src import local_ai as ai,meal_planner as planner


def intent(**fields):
    return {**planner.empty_intent(),**fields}


class ObservedIntentNormalizationTests(unittest.TestCase):
    def test_ambiguous_en_vi_health_goals_do_not_accept_model_invented_diets(self):
        with patch.dict(os.environ,{'MEAL_PLANNER_SIGNING_KEY':'regression-authored-only-'*3}):
            for prompt in ('Something healthy please.','Tôi muốn món gì đó lành mạnh.','A light meal please.'):
                with self.subTest(prompt=prompt),patch.object(ai,'_chat',return_value=intent(dietaryPreferences=['low-calorie','low-fat'])),patch.object(ai,'_db',side_effect=AssertionError('Ambiguous goal must not query catalog')):
                    result=ai.search(prompt)
                self.assertEqual('needs_clarification',result['status'])
                self.assertEqual([],result['intent']['dietaryPreferences'])
                self.assertEqual(1,len(result['clarification']['questions']))

    def test_vietnamese_vegan_phrase_does_not_require_an_extra_vegetarian_source_tag(self):
        observed=intent(ingredients=['tofu'],categories=['dinner'],dietaryPreferences=['vegetarian','vegan'],maxCookingTime=45)
        with patch.object(ai,'_chat',return_value=observed):
            actual=ai.parse_intent('Bữa tối thuần chay với đậu phụ dưới 45 phút.')
        self.assertEqual(['vegan'],actual['dietaryPreferences']);self.assertEqual(['tofu'],actual['ingredients'])
        self.assertEqual(45,actual['maxCookingTime'])

    def test_vegetarian_does_not_become_vegan_from_tofu_and_explicit_two_diets_remain(self):
        with patch.object(ai,'_chat',return_value=intent(ingredients=['tofu'],dietaryPreferences=['vegan'])):
            actual=ai.parse_intent('A vegetarian dinner with tofu.')
        self.assertEqual(['vegetarian'],actual['dietaryPreferences'])
        with patch.object(ai,'_chat',return_value=intent(dietaryPreferences=['vegan'])):
            actual=ai.parse_intent('A vegan and gluten-free dinner.')
        self.assertEqual({'vegan','gluten-free'},set(actual['dietaryPreferences']))

    def test_bare_meal_cuisine_keywords_do_not_duplicate_structured_constraints(self):
        for keyword in ('lunch','italian'):
            observed=intent(keyword=keyword,ingredients=['salmon'],allergies=['peanut'],cuisines=['italian'],categories=['lunch'],maxCookingTime=30)
            with self.subTest(keyword=keyword),patch.object(ai,'_chat',return_value=observed):
                actual=ai.parse_intent('Italian lunch with salmon under 30 minutes, without peanuts.')
            self.assertEqual('',actual['keyword']);self.assertEqual(['salmon'],actual['ingredients'])
            self.assertEqual(['peanut'],actual['allergies']);self.assertEqual(['italian'],actual['cuisines'])
            self.assertEqual(['lunch'],actual['categories']);self.assertEqual(30,actual['maxCookingTime'])

    def test_explicit_soup_recovers_category_while_real_dish_and_cooking_style_stay_keywords(self):
        for prompt,keyword,wanted in (
            ('Soup with carrots and potatoes, without celery.','soup',''),
            ('Súp với cà rốt và khoai tây, không có cần tây.','soup',''),
            ('Chicken soup with carrots, without celery.','chicken soup','chicken soup'),
            ('Stir-fry with carrots, without celery.','stir-fry','stir-fry')):
            with self.subTest(prompt=prompt),patch.object(ai,'_chat',return_value=intent(keyword=keyword,ingredients=['carrot'],allergies=['celery'])):
                actual=ai.parse_intent(prompt)
            self.assertEqual(wanted,actual['keyword']);self.assertEqual(['carrot'],actual['ingredients'])
            self.assertEqual(['celery'],actual['allergies'])
            self.assertEqual(['soup'] if 'soup' in prompt.lower() or 'Súp' in prompt else [],actual['categories'])

    def test_unknown_true_category_remains_strict_and_model_invalid_schema_still_fails(self):
        with patch.object(ai,'_chat',return_value=intent(categories=['supper'],ingredients=['mushroom'])):
            actual=ai.parse_intent('Supper with mushrooms.')
        self.assertEqual(['supper'],actual['categories'])
        with patch.object(ai,'_chat',return_value=intent(dietaryPreferences=['not-a-supported-diet'])):
            with self.assertRaises(ai.AIError) as error:ai.parse_intent('A special dietary dinner.')
        self.assertEqual(422,error.exception.status);self.assertEqual('unsupported_diet',error.exception.code)

    def test_unsupported_requested_labels_have_stable_code_before_model_validation(self):
        for prompt in ('A keto dinner with chicken.','Bữa tối keto với gà.','A paleo dinner with chicken.'):
            with self.subTest(prompt=prompt),patch.object(ai,'_chat',side_effect=AssertionError('Unsupported label must fail before inference')):
                with self.assertRaises(ai.AIError) as error:ai.parse_intent(prompt)
            self.assertEqual(422,error.exception.status);self.assertEqual('unsupported_diet',error.exception.code)

    def test_prompt_diet_grounding_cannot_remove_explicit_settings_or_authoritative_profile(self):
        with patch.object(ai,'_chat',return_value=intent(ingredients=['mushroom'],dietaryPreferences=['low-fat'])):
            parsed=ai.parse_intent('Dinner with mushrooms without peanuts.')
        settings={'useProfile':True,'useHouseholdPreferences':True,'maxCookTime':45,'dietaryPreferences':['gluten-free'],'excludedIngredients':['sesame']}
        profile={'usedProfile':True,'dietaryPreferences':['vegan'],'allergies':['milk'],'householdRestrictions':{'dietaryPreferences':['low-calorie'],'allergies':['soy']}}
        effective,*_=planner.effective_constraints(parsed,settings,profile)
        self.assertEqual({'gluten-free','vegan','low-calorie'},set(effective['dietaryPreferences']))
        self.assertEqual({'peanut','sesame','milk','soy'},set(effective['allergies']))
        self.assertEqual(['mushroom'],effective['ingredients'])


if __name__=='__main__':unittest.main()
