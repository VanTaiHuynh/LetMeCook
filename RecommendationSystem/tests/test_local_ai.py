import base64
import io
import unittest
from unittest.mock import patch, MagicMock
from PIL import Image
from src import local_ai as ai


def intent(**overrides):
    value = {"keyword": "", **{key: [] for key in ai.ARRAY_FIELDS}, "maxCookingTime": None}
    value.update(overrides)
    return value


class LocalAITests(unittest.TestCase):
    def test_untranslated_common_terms_are_canonicalized(self):
        with patch.object(ai, "_chat", return_value=intent(ingredients=["gà", "nấm"], allergies=["đậu phộng"])):
            parsed = ai.parse_intent("món gà với nấm không có đậu phộng")
        self.assertEqual(["chicken", "mushroom"], parsed["ingredients"])
        self.assertEqual(["peanut"], parsed["allergies"])

    def test_misrouted_diets_move_to_validated_diet_field_without_relaxing_constraints(self):
        for diet in ai.DIETS:
            with self.subTest(diet=diet):
                output = intent(ingredients=["mushrooms"], allergies=["peanuts"],
                    cuisines=["italian"], categories=[diet.replace("-", " "), "dinner", "supper"],
                    dietaryPreferences=[diet], maxCookingTime=30)
                with patch.object(ai, "_chat", return_value=output):
                    parsed = ai.parse_intent(f"A {diet} dinner with mushrooms under 30 minutes, without peanuts")
                self.assertEqual([diet], parsed["dietaryPreferences"])
                self.assertEqual(["dinner", "supper"], parsed["categories"])
                self.assertEqual(["mushroom"], parsed["ingredients"])
                self.assertEqual(["peanut"], parsed["allergies"])
                self.assertEqual(["italian"], parsed["cuisines"])
                self.assertEqual(30, parsed["maxCookingTime"])

    def test_diet_present_only_in_categories_is_preserved_and_unknown_diet_still_rejected(self):
        with patch.object(ai, "_chat", return_value=intent(categories=["chay", "dinner"])):
            parsed = ai.parse_intent("Món chay cho bữa tối")
        self.assertEqual(["vegetarian"], parsed["dietaryPreferences"])
        self.assertEqual(["dinner"], parsed["categories"])
        with patch.object(ai, "_chat", return_value=intent(
                categories=["vegetarian", "dinner"], dietaryPreferences=["pescatarian"])):
            with self.assertRaises(ai.AIError) as error:
                ai.parse_intent("A pescatarian dinner")
        self.assertEqual(422, error.exception.status)

    def test_canonical_diet_duplicates_are_removed_after_cross_field_transfer(self):
        with patch.object(ai, "_chat", return_value=intent(
                categories=["gluten free", "gluten-free", "dinner"],
                dietaryPreferences=["gluten free", "gluten-free", "vegetarian"])):
            parsed = ai.parse_intent("A gluten-free vegetarian dinner")
        self.assertEqual(["gluten-free", "vegetarian"], parsed["dietaryPreferences"])
        self.assertEqual(["dinner"], parsed["categories"])

    def test_misrouted_vegetarian_live_prompt_keeps_all_hard_sql_filters(self):
        from src.dietary_guards import diet_block_pattern
        connection, engine = MagicMock(), MagicMock()
        connection.execute.return_value.mappings.return_value.all.return_value = []
        engine.connect.return_value.__enter__.return_value = connection
        output = intent(ingredients=["mushrooms"], allergies=["peanuts"],
            categories=["vegetarian", "dinner", "supper"],
            dietaryPreferences=["vegetarian"], maxCookingTime=30)
        with patch.object(ai, "_db", return_value=engine), patch.object(ai, "_chat", return_value=output):
            result = ai.search("A vegetarian dinner with mushrooms under 30 minutes, without peanuts.")
        sql, parameters = connection.execute.call_args.args
        self.assertEqual(["vegetarian"], result["intent"]["dietaryPreferences"])
        self.assertEqual(["dinner", "supper"], result["intent"]["categories"])
        self.assertEqual("vegetarian", parameters["dietaryPreferences0"])
        self.assertEqual("dinner", parameters["categories0"])
        self.assertEqual("supper", parameters["categories1"])
        self.assertNotIn("vegetarian", [value for key, value in parameters.items() if key.startswith("categories")])
        self.assertEqual(ai.ingredient_pattern("mushroom"), parameters["ingredients0"])
        self.assertEqual(ai.ingredient_pattern("peanut"), parameters["allergies0"])
        self.assertEqual(diet_block_pattern("vegetarian"), parameters["diet_contradiction0"])
        self.assertEqual(30, parameters["max_time"])
        self.assertIn("public.recipe_dietary_pref", str(sql))
        self.assertIn("public.recipe_categories", str(sql))
        self.assertIn("AND NOT EXISTS", str(sql))
        self.assertIn("r.time > 0 AND r.time <= :max_time", str(sql))

    def test_model_schema_failures_are_not_silently_accepted(self):
        for output in [{"keyword": "chicken"}, intent(dietaryPreferences=["healthy"]), intent(maxCookingTime=-1), intent(ingredients=[42])]:
            with patch.object(ai, "_chat", return_value=output):
                with self.assertRaises(ai.AIError):
                    ai.parse_intent("chicken")

    def test_conflicting_photo_ingredient_never_relaxes_exclusion(self):
        with patch.object(ai, "parse_intent", return_value=intent(allergies=["peanut"])):
            with self.assertRaises(ai.AIError) as error:
                ai.search("without peanuts", ["peanuts"])
        self.assertEqual(422, error.exception.status)

    def test_photo_magic_bytes_and_size_validated_before_inference(self):
        for photo in ["not base64", base64.b64encode(b"<html>not a photo</html>").decode(), "a" * 7_000_001]:
            with patch.object(ai, "_chat", side_effect=AssertionError("Should not infer")):
                with self.assertRaises(ai.AIError):
                    ai.vision(photo)

    def test_photo_exif_removed_and_confirmation_required(self):
        photo = Image.new("RGB", (50, 50), "green")
        exif = Image.Exif()
        exif[0x010E] = "private location metadata"
        out = io.BytesIO()
        photo.save(out, "JPEG", exif=exif)
        def inference(model, system, content, schema, images):
            with Image.open(io.BytesIO(base64.b64decode(images[0]))) as actual:
                self.assertFalse(actual.getexif())
            return {"observations": [{"name": "broccoli", "confidence": "medium"}]}
        with patch.object(ai, "_chat", side_effect=inference):
            result = ai.vision(base64.b64encode(out.getvalue()).decode())
        self.assertTrue(result["requiresConfirmation"])
        self.assertEqual(["broccoli"], result["ingredients"])

    def test_every_ingredient_is_a_separate_exists_and_private_rows_are_excluded(self):
        connection = MagicMock()
        connection.execute.return_value.mappings.return_value.all.return_value = []
        engine = MagicMock()
        engine.connect.return_value.__enter__.return_value = connection
        with patch.object(ai, "_db", return_value=engine), patch.object(ai, "parse_intent", return_value=intent(
                ingredients=["mushroom", "tofu"], allergies=["peanut"], dietaryPreferences=["vegan"], maxCookingTime=30)):
            result = ai.search("test constraints")
        sql, parameters = connection.execute.call_args.args
        self.assertIn("r.is_public = true", str(sql))
        self.assertIn("AND EXISTS", str(sql))
        self.assertIn("AND NOT EXISTS", str(sql))
        self.assertIn("ingredients0", parameters)
        self.assertIn("ingredients1", parameters)
        self.assertEqual(30, parameters["max_time"])
        self.assertEqual(0, result["totalMatches"])
        self.assertEqual(["peanut"], result["intent"]["allergies"])

    def test_user_regex_is_escaped_not_executed(self):
        pattern = ai.ingredient_pattern("fish.*|peanut")
        self.assertIn(r"fish\.\*\|peanut", pattern)

    def test_source_diet_label_is_required_and_contradictions_are_filtered_separately(self):
        from src.dietary_guards import diet_block_pattern
        connection, engine = MagicMock(), MagicMock()
        connection.execute.return_value.mappings.return_value.all.return_value = []
        engine.connect.return_value.__enter__.return_value = connection
        with patch.object(ai, '_db', return_value=engine), patch.object(ai, 'parse_intent', return_value=intent(dietaryPreferences=['vegetarian'])):
            result = ai.search('vegetarian dinner')
        sql, parameters = connection.execute.call_args.args
        self.assertIn('recipe_dietary_pref', str(sql))
        self.assertIn('NOT EXISTS', str(sql))
        self.assertIn('regexp_like(lower(i.name), :diet_contradiction0)', str(sql))
        self.assertEqual(diet_block_pattern('vegetarian'), parameters['diet_contradiction0'])
        self.assertEqual([], result['intent']['allergies'])

    def test_visible_plural_ingredients_and_nut_exclusions_are_canonical(self):
        self.assertEqual(["carrot", "potato", "nut"], ai._terms(["carrots", "potatoes", "nuts"]))
        self.assertIn("cashews?", ai.ingredient_pattern("nut"))

    def test_single_flight_returns_busy_without_model_call(self):
        ai._gate.acquire()
        try:
            with patch.object(ai, "_ollama", side_effect=AssertionError("No call when busy")):
                with self.assertRaises(ai.AIError) as error:
                    ai._chat(ai.TEXT_MODEL, "system", "user", ai.INTENT_SCHEMA)
            self.assertEqual(429, error.exception.status)
        finally:
            ai._gate.release()


if __name__ == "__main__":
    unittest.main()
