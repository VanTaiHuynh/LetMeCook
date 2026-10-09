import unittest
from src import pantry

class SubstitutionTests(unittest.TestCase):
 def request(self):return {'recipe':{'id':'recipe','servings':2,'ingredients':[{'ingredient':'butter','quantity':'100','unit':'g'},{'ingredient':'sugar','quantity':'2','unit':'tbsp'}]},'swap':{'fromIngredient':'butter','toIngredient':'olive oil','ratio':0.8,'reviewed':True},'servings':4,'excludedIngredients':[]}
 def test_known_ratio_and_yield_scaled(self):
  result=pantry.substitute(self.request());self.assertTrue(result['supported']);self.assertEqual(result['changed'][0]['quantity'],160);self.assertEqual(result['ingredients'][1]['quantity'],4)
 def test_exclusion_of_target_or_remaining_ingredient_rejected(self):
  for excluded in ['oil','sugar']:
   body=self.request();body['excludedIngredients']=[excluded];self.assertFalse(pantry.substitute(body)['supported'])
 def test_unknown_source_yield_or_quantity_unsupported(self):
  for field in ['servings','quantity','unit']:
   body=self.request()
   if field=='servings':body['recipe'][field]=0
   else:body['recipe']['ingredients'][0][field]=''
   self.assertFalse(pantry.substitute(body)['supported'])
 def test_exact_reviewed_names_no_unreviewed_equivalence(self):
  body=self.request();body['recipe']['ingredients'][0]['ingredient']='salted butter'
  self.assertFalse(pantry.substitute(body)['supported'])
  body['ingredientAliases']=[{'alias':'salted butter','name':'butter'}]
  self.assertTrue(pantry.substitute(body)['supported'])
 def test_reviewed_alias_keeps_ratio_in_returned_ingredients_not_only_changed_summary(self):
  body=self.request();body['recipe']['ingredients'][0]['ingredient']='salted butter'
  body['ingredientAliases']=[{'alias':'salted butter','name':'butter'}]
  result=pantry.substitute(body)
  self.assertTrue(result['supported'])
  self.assertEqual(160,result['changed'][0]['quantity'])
  self.assertEqual(160,result['ingredients'][0]['quantity'])
  self.assertEqual('160 g',result['ingredients'][0]['quantityText'])
  self.assertEqual(4,result['ingredients'][1]['quantity'])
 def test_saved_vegetarian_diet_rejects_animal_replacement(self):
  body=self.request();body['dietaryPreferences']=['vegetarian'];body['swap']['toIngredient']='chicken fat'
  self.assertFalse(pantry.substitute(body)['supported'])
  self.assertEqual([],body['excludedIngredients'])
 def test_saved_vegan_diet_checks_remaining_ingredients_not_only_swap_target(self):
  body=self.request();body['dietaryPreferences']=['vegan'];body['recipe']['ingredients'].append({'ingredient':'cream cheese','quantity':'20','unit':'g'})
  self.assertFalse(pantry.substitute(body)['supported'])
 def test_explicit_vegan_replacement_and_plant_ingredients_are_allowed(self):
  body=self.request();body['dietaryPreferences']=['vegan'];body['swap']['toIngredient']='vegan butter';body['recipe']['ingredients'][1]['ingredient']='peanut butter'
  self.assertTrue(pantry.substitute(body)['supported'])
if __name__=='__main__':unittest.main()
