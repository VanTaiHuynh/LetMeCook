"""ai intent domain boundary; no user persistence."""
from src.ai_config import *
from src.ai_errors import AIError
from src.ai_contracts import SearchIntent


class IntentConflict(AIError):
    def __init__(self,intent):
        self.intent=intent
        super().__init__('Your request includes and excludes the same ingredient. Please clarify.',422)


def _terms(value, limit=10):
    from src import local_ai as facade
    if not isinstance(value, list) or len(value) > limit:
        raise AIError("Ingredient/filter lists are invalid or too long.")
    result = []
    for term in value:
        if not isinstance(term, str) or not term.strip() or len(term) > 60:
            raise AIError("Each filter must contain 1–60 characters.")
        term = term.strip().lower()
        term = TRANSLATIONS.get(term, term)
        singular = {"peanuts": "peanut", "eggs": "egg", "mushrooms": "mushroom", "tree nuts": "tree nut", "dairy products": "dairy", "nuts": "nut", "carrots": "carrot", "potatoes": "potato", "tomatoes": "tomato", "onions": "onion", "lemons": "lemon", "limes": "lime", "peppers": "pepper", "peas": "pea", "beans": "bean"}
        term = singular.get(term, term)
        if term not in result:
            result.append(term)
    return result


def parse_intent(prompt, *, clarified=False):
    from src import local_ai as facade
    maximum_prompt=2500 if clarified else 2000
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > maximum_prompt:
        raise AIError("Enter a recipe request of 1–2000 characters.")
    from src.intent_clarification import explicit_guards,ingredient_conflicts,reject_unsupported_diet,unsupported_diet_error
    reject_unsupported_diet(prompt)
    intent = facade._chat(TEXT_MODEL, SYSTEM, prompt.strip(), INTENT_SCHEMA)
    if not isinstance(intent,dict) or set(intent) != set(INTENT_SCHEMA["required"]):
        raise AIError("Local model returned incomplete search constraints.", 502)
    for key in ARRAY_FIELDS:
        intent[key] = facade._terms(intent[key])
    # A model can put a diet in both fields, or only in categories. Preserve
    # that hard restriction in the correct domain rather than looking for a
    # nonexistent meal category or silently removing the diet requirement.
    category_diets = [category.replace(" ", "-") for category in intent["categories"]
                      if category.replace(" ", "-") in DIETS]
    intent["categories"] = [category for category in intent["categories"]
                            if category.replace(" ", "-") not in DIETS]
    intent["dietaryPreferences"] = list(dict.fromkeys(
        [diet.replace(" ", "-") for diet in intent["dietaryPreferences"]] + category_diets))
    if any(diet not in DIETS for diet in intent["dietaryPreferences"]):
        raise unsupported_diet_error()
    keyword = intent["keyword"]
    if not isinstance(keyword, str) or len(keyword) > 120:
        raise AIError("Invalid dish name returned by local model.", 502)
    intent["keyword"] = TRANSLATIONS.get(keyword.strip().lower(), keyword.strip().lower())
    if intent["keyword"] in intent["ingredients"] or intent["keyword"] in intent["allergies"]:
        intent["keyword"] = ""
    maximum = intent["maxCookingTime"]
    if maximum is not None and (type(maximum) is not int or not 1 <= maximum <= 600):
        raise AIError("Cooking time must be between 1 and 600 minutes.", 422)
    intent=SearchIntent.from_mapping(explicit_guards(prompt,intent)).to_dict()
    # A bare meal type/cuisine/diet already has a validated structured field.
    # Keep named dishes and free cooking-style phrases, including "chicken
    # soup", instead of discarding all keyword words containing a category.
    represented=set(intent['categories']+intent['cuisines']+intent['dietaryPreferences'])
    placeholders={'healthy','healthy meal','healthy food','something healthy','light','light meal','something nice','some food','lành mạnh','món lành mạnh','món ăn lành mạnh','món gì đó'}
    if intent['keyword'] in represented or intent['keyword'] in placeholders:
        intent['keyword']=''
    if ingredient_conflicts(intent['ingredients'],intent['allergies']):
        raise IntentConflict(intent)
    return intent
