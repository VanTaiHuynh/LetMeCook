"""Known listed-ingredient contradictions; source diet labels remain required.

Patterns use the common Python/Java/PostgreSQL regexp subset. They do not infer
an unlabelled recipe's diet, hidden ingredients or cross-contact safety.
"""
import re

WORD_LEFT = r'(?<![a-z0-9_])'
WORD_RIGHT = r'(?![a-z0-9_])'
SEPARATOR = r'(?:[,;/&+(:.]|\s(?:and|or|with|plus|containing|contains|including)\s)'
START = r'(?:^|' + SEPARATOR + r')\s*'
DESCRIPTORS = r'(?:(?:fresh|dried|raw|cooked|sliced|smoked|grated|shredded|plain|organic|unsweetened|tinned|canned|homemade)\s+)*'
PLANT = r'(?:vegan|plant[- ]based)'
VEGETARIAN_PLANT = r'(?:vegan|vegetarian|plant[- ]based|meat[- ]free|mock)'
DAIRY_PLANT = r'(?:vegan|plant[- ]based|dairy[- ]free|non[- ]dairy)'
EGG_PLANT = r'(?:vegan|plant[- ]based|egg[- ]free)'


def _protected(term, prefixes=(), suffix=''):
    # Occurrence-local exemptions: coconut milk must not exempt later cream.
    # A bounded whitespace spelling also supports the source's raw SQL names.
    previous = ''.join(r'(?<!' + re.escape(prefix) + r'\s' * count + ')'
                       for prefix in prefixes for count in (1, 2, 3))
    return previous + WORD_LEFT + term + WORD_RIGHT + suffix


MEATS = [r'beef', r'veal', r'pork', r'bacon', r'ham', r'prosciutto', r'pancetta',
         r'salami', r'chorizo', r'pepperoni', r'guanciale', r'lard', r'dripping',
         r'venison', r'mutton', r'rabbit', r'goat', r'offal', r'liver', r'p[âa]t[ée]',
         r'foie\s+gras', r'meat', r'meatballs?', r'sausages?', r'gelatin(?:e)?',
         r'rennet', r'carmine', r'cochineal', r'shellac']
BIRDS = [r'chickens?', r'turkey', r'duck', r'goose', r'geese', r'quail', r'pheasant', r'guinea\s+fowl']
SEAFOOD = [r'fish', r'salmon', r'tuna', r'cod', r'haddock', r'mackerel', r'trout',
           r'sardines?', r'herring', r'plaice', r'sea\s+bass', r'anchov(?:y|ies)',
           r'bonito', r'katsuobushi', r'nam\s+pla', r'shrimps?', r'prawns?',
           r'lobsters?', r'crayfish', r'mussels?', r'clams?', r'scallops?', r'squid',
           r'octopus', r'calamari', r'cuttlefish', r'surimi', r'caviar', r'roe',
           r'worcestershire']
PLANT_MILKS = ('coconut', 'oat', 'soy', 'soya', 'almond', 'rice', 'cashew', 'pea',
               'hemp', 'hazelnut', 'macadamia')
PLANT_BUTTERS = ('peanut', 'nut', 'almond', 'cashew', 'hazelnut', 'coconut',
                 'cocoa', 'apple', 'shea')


def _animal(vegan=False):
    parts = [_protected(term) for term in MEATS + SEAFOOD]
    for term in BIRDS:
        # Bird eggs are vegetarian, but the vegan egg guard still excludes them.
        suffix = r'(?!\s+eggs?(?![a-z0-9_]))' if not vegan else ''
        if term == r'chickens?':
            suffix += r'(?!\s+of\s+the\s+woods)'
        parts.append(_protected(term, suffix=suffix))
    parts += [_protected(r'lambs?', suffix=r"(?!['’]s\s+lettuce|\s+lettuce)"),
              _protected(r'oysters?', suffix=r'(?!\s+mushrooms?)'),
              _protected(r'crabs?', suffix=r'(?!\s+apples?)'),
              _protected(r'suet', ('vegetable',))]
    return '(?:' + '|'.join(parts) + ')'


def _dairy():
    parts = [_protected(r'milk', PLANT_MILKS),
             _protected(r'cream', PLANT_MILKS, r'(?!\s+of\s+(?:tartar|coconut))'),
             _protected(r'butter', PLANT_BUTTERS, r'(?!\s+beans?)'),
             _protected(r'yogh?urt', PLANT_MILKS)]
    parts += [_protected(term) for term in [r'dairy', r'cheese', r'ghee', r'whey',
              r'casein', r'caseinate', r'lactose', r'buttermilk', r'mascarpone',
              r'mozzarella', r'parmesan', r'cheddar', r'feta', r'ricotta', r'halloumi']]
    return '(?:' + '|'.join(parts) + ')'


def _clause(blocked, qualifier):
    # Qualifiers apply only within their own clause, never across "and/or/with".
    # A bare later "vegetarian alternative" cannot erase earlier real ham.
    prefix = r'(?!(?:' + DESCRIPTORS + r')\(?\s*' + qualifier + WORD_RIGHT + r'(?:\s|\)))'
    postfix = r'(?!(?:(?!' + SEPARATOR + r').)*\(\s*' + qualifier + r'\s*\)\s*(?:$|' + SEPARATOR + r'))'
    content = r'(?:(?!' + SEPARATOR + r').)*?'
    return START + prefix + postfix + content + blocked


def diet_block_pattern(diet):
    value = re.sub(r'\s+', '-', str(diet).strip().casefold())
    if value == 'vegetarian':
        return _clause(_animal(), VEGETARIAN_PLANT)
    if value == 'vegan':
        eggs = '(?:' + '|'.join(_protected(term) for term in [r'eggs?', r'albumen', r'mayonnaise', r'meringue']) + ')'
        bees = '(?:' + '|'.join(_protected(term) for term in [r'honey', r'beeswax', r'royal\s+jelly', r'bee\s+pollen']) + ')'
        return '(?:' + '|'.join([_clause(_animal(True), PLANT), _clause(_dairy(), DAIRY_PLANT),
                                _clause(eggs, EGG_PLANT), _clause(bees, PLANT)]) + ')'
    return None


def listed_diet_conflict(name, diets):
    value = re.sub(r'\s+', ' ', str(name or '').strip().casefold())
    return any(pattern and re.search(pattern, value)
               for pattern in (diet_block_pattern(diet) for diet in diets))


def append_diet_guards(clauses, parameters, diets):
    """Add NOT EXISTS before ranking/pagination; keep explicit label EXISTS too."""
    for index, diet in enumerate(diets):
        pattern = diet_block_pattern(diet)
        if pattern:
            parameter = f'diet_contradiction{index}'
            parameters[parameter] = pattern
            clauses.append('NOT EXISTS (SELECT 1 FROM public.recipe_ingredients ri '
                'JOIN public.ingredients i ON i.id=ri.ingredient_id '
                f'WHERE ri.recipe_id=r.id AND regexp_like(lower(i.name), :{parameter}))')
