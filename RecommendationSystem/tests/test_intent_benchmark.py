"""Evaluation semantics fail on missing exclusions, not on fabricated claims."""
import json
from pathlib import Path
import unittest
from evaluation.run_intent_benchmark import score_case,aggregate,regression_gates,loopback


class AuthoredBenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.corpus=json.loads((Path(__file__).parents[1]/'evaluation/intent-en-vi.json').read_text())

    def test_corpus_is_explicitly_authored_balanced_and_has_negation_and_ambiguity(self):
        cases=self.corpus['cases']
        self.assertIn('Authored engineering',self.corpus['provenance'])
        self.assertEqual(30,len(cases));self.assertEqual(15,sum(item['language']=='vi' for item in cases))
        self.assertTrue(any(item['expectedStatus']=='needs_clarification' for item in cases))
        self.assertTrue(any(item['expectedIntent']['allergies'] for item in cases))
        self.assertEqual(len(cases),len({item['id'] for item in cases}))

    def test_missing_exclusion_or_diet_fails_strict_regression_gate(self):
        case=self.corpus['cases'][0]
        value={**case['expectedIntent'],'allergies':[],'dietaryPreferences':[]}
        row=score_case(case,200,{'status':'results','intent':value})
        metrics=aggregate([row]);gates=regression_gates(metrics)
        self.assertFalse(gates['passed']);self.assertIn('hardExclusionRecall',gates['failures']);self.assertIn('sourceDietRecall',gates['failures'])

    def test_correct_label_scores_only_actual_response_not_expected_copied_results(self):
        case=self.corpus['cases'][0]
        row=score_case(case,200,{'status':'results','intent':case['expectedIntent']})
        self.assertTrue(regression_gates(aggregate([row]))['passed'])
        row=score_case(case,503,{'message':'Model unavailable'})
        self.assertFalse(regression_gates(aggregate([row]))['passed'])

    def test_evaluator_refuses_cloud_origin_and_credentials(self):
        for value in ('https://api.example.com','http://user:pass@localhost:9501','http://localhost:9501/path'):
            with self.assertRaises(ValueError):loopback(value)
        self.assertEqual('http://127.0.0.1:9501',loopback('http://127.0.0.1:9501/'))

    def test_unrelated_validation_error_is_not_counted_as_correct_unsupported_diet(self):
        case=next(item for item in self.corpus['cases'] if item['expectedStatus']=='unsupported_diet')
        unrelated=score_case(case,422,{'message':'A different validation failed'})
        supported=score_case(case,422,{'code':'unsupported_diet'})
        self.assertFalse(unrelated['statusCorrect']);self.assertFalse(unrelated['fullIntentExact'])
        self.assertTrue(supported['statusCorrect']);self.assertTrue(supported['fullIntentExact'])


if __name__=='__main__':unittest.main()
