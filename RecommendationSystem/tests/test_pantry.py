import unittest
from src import pantry
from src.local_ai import AIError

class CoverageTests(unittest.TestCase):
    def plan(self, lines):
        return {'plan': {'shoppingList': lines}, 'asOf': '2026-10-08', 'pantry': [], 'priceBook': []}
    def line(self, quantity=200, measure='g', name='tomato', key='a'):
        return {'key':key,'name':name,'quantity':quantity,'unit':measure,'requiresReview':False}
    def lot(self, **changes):
        return {'id':'lot1','version':2,'ingredient':'tomato','quantity':300,'unit':'grams','useBy':'2026-10-09',**changes}
    def test_stock_not_counted_twice(self):
        body=self.plan([self.line(key='a'),self.line(key='b')]);body['pantry']=[self.lot()]
        data=pantry.coverage(body)
        self.assertEqual([x['quantityMissing'] for x in data['shoppingList']],[0,100])
        self.assertEqual(sum(x['quantity'] for x in data['allocations']),300)
    def test_expired_and_incompatible_units_unchanged(self):
        body=self.plan([self.line()]);body['pantry']=[self.lot(useBy='2026-10-07'),self.lot(unit='cup')]
        data=pantry.coverage(body);self.assertEqual(data['shoppingList'][0]['quantityMissing'],200);self.assertEqual(data['allocations'],[])
    def test_different_ingredient_not_equated(self):
        body=self.plan([self.line(name='red onion')]);body['pantry']=[self.lot(ingredient='onion')]
        self.assertEqual(pantry.coverage(body)['shoppingList'][0]['quantityMissing'],200)
    def test_unknown_amount_never_subtracted(self):
        body=self.plan([{**self.line(),'requiresReview':True,'quantityText':'to taste'}]);body['pantry']=[self.lot()]
        result=pantry.coverage(body);self.assertEqual(result['shoppingList'][0]['coverage'],'review');self.assertIsNone(result['estimatedCost'])
    def test_pack_price_rounds_up_with_provenance(self):
        body=self.plan([self.line(quantity=600)])
        body['priceBook']=[{'ingredient':'tomato','packQuantity':500,'unit':'g','packPrice':2.5,'currency':'CAD','source':'Receipt #1','observedOn':'2026-10-08'}]
        result=pantry.coverage(body);self.assertEqual(result['estimatedCost'],5);self.assertEqual(result['shoppingList'][0]['packsToBuy'],2)
    def test_partial_prices_and_currency_mix_no_total(self):
        body=self.plan([self.line(),self.line(name='rice',key='b')]);body['priceBook']=[{'ingredient':'tomato','packQuantity':200,'unit':'g','packPrice':2,'currency':'CAD','source':'Receipt'}]
        result=pantry.coverage(body);self.assertIsNone(result['estimatedCost']);self.assertEqual(result['priceCoverage']['priced'],1)
        body['priceBook'].append({'ingredient':'rice','packQuantity':200,'unit':'g','packPrice':2,'currency':'USD','source':'Receipt'})
        self.assertIsNone(pantry.coverage(body)['estimatedCost'])
    def test_first_expiring_stock_allocated_first(self):
        body=self.plan([self.line(quantity=100)]);body['pantry']=[self.lot(id='later'),self.lot(id='earlier',useBy='2026-10-08')]
        self.assertEqual(pantry.coverage(body)['allocations'][0]['lotId'],'earlier')
    def test_bounds_and_invalid_dates_rejected(self):
        for body in [{'plan':{},'pantry':[{}]*1001}, {'plan':{},'asOf':'wrong'}, {'plan':{},'pantry':[self.lot(useBy='bad')]}]:
            with self.assertRaises(AIError):pantry.coverage(body)
    def test_dated_lots_are_used_only_in_valid_slots_and_never_twice(self):
        body=self.plan([{**self.line(quantity=300),'contributions':[
            {'recipeId':'a','quantity':100,'unit':'g'}, {'recipeId':'b','quantity':100,'unit':'g'}, {'recipeId':'c','quantity':100,'unit':'g'}]}])
        body['plan']['meals']=[{'dayIndex':i,'date':f'2026-10-{12+i}','recipe':{'id':rid}} for i,rid in enumerate(['a','b','c'])]
        body['pantry']=[self.lot(id='early',quantity=100,useBy='2026-10-12'),self.lot(id='late',quantity=60,useBy='2026-10-14')]
        result=pantry.coverage(body);self.assertEqual(140,result['shoppingList'][0]['quantityMissing'])
        self.assertEqual({0},{row['dayIndex'] for row in result['allocations'] if row['lotId']=='early'})
        self.assertEqual({1,2},{row['dayIndex'] for row in result['allocations'] if row['lotId']=='late'})
        self.assertEqual(160,sum(row['quantity'] for row in result['allocations']))
        self.assertEqual([100,60],[lot['quantity'] for lot in body['pantry']])
    def test_future_purchase_or_inconsistent_contributions_cannot_supply_stock(self):
        body=self.plan([{**self.line(quantity=100),'contributions':[{'recipeId':'a','quantity':100,'unit':'g'}]}])
        body['plan']['meals']=[{'dayIndex':0,'date':'2026-10-12','recipe':{'id':'a'}}]
        body['pantry']=[self.lot(useBy='2026-10-15',purchasedOn='2026-10-13')]
        self.assertEqual([],pantry.coverage(body)['allocations'])
        body['pantry']=[self.lot(useBy='2026-10-15')];body['plan']['shoppingList'][0]['contributions'][0]['quantity']=200
        self.assertEqual([],pantry.coverage(body)['allocations'])

if __name__=='__main__':unittest.main()
