import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("lmc_import", Path(__file__).resolve().parents[1]/"import-recipes.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class PublisherDietEvidenceTests(unittest.TestCase):
    def test_single_string_multiple_uris_restores_all_explicit_tags(self):
        source = {"suitableForDiet": "https://schema.org/VeganDiet, https://schema.org/VegetarianDiet, https://schema.org/GlutenFreeDiet"}
        self.assertEqual(importer.explicit_source_diets(source), ["gluten free", "vegan", "vegetarian"])

    def test_arrays_objects_dedup_and_unknown_non_schema_rejected(self):
        source = {"suitableForDiet": [{"@id": "http://schema.org/LowFatDiet"},
            "https://schema.org/LowCalorieDiet, https://schema.org/LowFatDiet",
            "https://example.com/VeganDiet", "https://schema.org/UnknownDiet", "vegan"]}
        self.assertEqual(importer.explicit_source_diets(source), ["low calorie", "low fat"])
        self.assertIsNone(importer.explicit_source_diets({}))
        self.assertEqual(importer.explicit_source_diets({"suitableForDiet": []}), [])

    def test_normalization_preserves_quoted_provenance_and_physical_lf_records(self):
        source = {"suitableForDiet": "https://schema.org/VeganDiet, https://schema.org/VegetarianDiet"}
        original = {"source_url": "https://example.test/recipe/one#Recipe", "title": "Soup\u2028with \"beans\"",
            "description": "A\u0085B", "directions": ["Stir 'beans'; -- no SQL execution"],
            "ingredients": [{"name": "Beans", "quantity": "", "unit": ""}],
            "source_jsonld": source, "source_author": "Author's name", "source_license": "all rights reserved",
            "dietary_preferences": ["vegetarian"]}
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/"unicode.jsonl"
            p.write_text(json.dumps(original,ensure_ascii=False)+"\n",encoding="utf-8")
            records,duplicates=importer.read_recipes(p,1)
        self.assertEqual(duplicates,0)
        self.assertEqual([t["name"] for t in records[0]["dietary_preferences"]],["vegan","vegetarian"])
        self.assertEqual(records[0]["source_author"],"Author's name")
        self.assertEqual(records[0]["source_license"],"all rights reserved")
        self.assertEqual(original["source_jsonld"],source)
        self.assertEqual(records[0]["ingredients"][0]["quantity"],"")
        sql=importer.build_sql(records)
        self.assertIn("COPY lmc_import_data(doc)",sql)
        self.assertIn("INSERT INTO lmc_import_expected VALUES (1)",sql)


if __name__ == "__main__":
    unittest.main()
