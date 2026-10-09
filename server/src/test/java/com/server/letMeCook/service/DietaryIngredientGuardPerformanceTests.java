package com.server.letMeCook.service;

import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class DietaryIngredientGuardPerformanceTests {
    @Test
    void necessaryTermPrefilterCannotDropContradictionsAcrossTermsAndMixedClauses() {
        List<String> positives = List.of("beef", "veal", "pork", "bacon", "ham", "prosciutto", "pancetta", "salami",
                "chorizo", "pepperoni", "guanciale", "lard", "dripping", "venison", "mutton", "rabbit", "goat", "offal", "liver", "pâté", "pate",
                "foie gras", "meat", "meatball", "meatballs", "sausage", "sausages", "gelatin", "gelatine", "rennet", "carmine", "cochineal", "shellac",
                "fish", "salmon", "tuna", "cod", "haddock", "mackerel", "trout", "sardine", "sardines", "herring", "plaice", "sea bass", "anchovy", "anchovies",
                "bonito", "katsuobushi", "nam pla", "shrimp", "shrimps", "prawn", "prawns", "lobster", "lobsters", "crayfish", "mussel", "mussels", "clam", "clams",
                "scallop", "scallops", "squid", "octopus", "calamari", "cuttlefish", "surimi", "caviar", "roe", "worcestershire", "chicken", "chickens", "turkey", "duck",
                "goose", "geese", "quail", "pheasant", "guinea fowl", "lamb", "lambs", "oyster", "oysters", "crab", "crabs", "suet",
                "milk", "cream", "butter", "yogurt", "yoghurt", "dairy", "cheese", "ghee", "whey", "casein", "caseinate", "lactose", "buttermilk",
                "mascarpone", "mozzarella", "parmesan", "cheddar", "feta", "ricotta", "halloumi", "egg", "eggs", "albumen", "mayonnaise", "meringue", "honey", "beeswax", "royal jelly", "bee pollen");
        for (String diet : List.of("vegetarian", "vegan")) {
            String full = DietaryIngredientGuards.patterns(List.of(diet)).getFirst();
            Pattern original = Pattern.compile(full), necessary = Pattern.compile(DietaryIngredientGuards.necessaryPattern(full));
            for (String term : positives) for (String prefix : List.of("", "fresh ", "vegan cheese and ", "coconut milk with ", "rice (contains "))
                for (String suffix : List.of("", " or vegan alternative", ", rice", ")", " & vegetables")) {
                    String input = (prefix + term + suffix).toLowerCase(Locale.ROOT);
                    assertFalse(original.matcher(input).find() && !necessary.matcher(input).find(), diet + ": " + input);
                }
        }
    }

    @Test
    void prefilterDoesNotReplacePlantAlternativeOrBoundaryChecks() {
        for (String diet : List.of("vegetarian", "vegan")) {
            String full = DietaryIngredientGuards.patterns(List.of(diet)).getFirst();
            Pattern original = Pattern.compile(full), necessary = Pattern.compile(DietaryIngredientGuards.necessaryPattern(full));
            for (String input : List.of("vegan butter", "meat-free sausages", "coconut milk", "peanut butter", "oyster mushrooms", "eggplant", "hamper", "chickpeas")) {
                boolean caseResult = necessary.matcher(input).find() && original.matcher(input).find();
                assertEquals(original.matcher(input).find(), caseResult, diet + ": " + input);
            }
            assertFalse(necessary.matcher("onion and rice").find());
        }
        assertNull(DietaryIngredientGuards.necessaryPattern("unrecognized future pattern"));
    }

    @Test
    void changedPatternWithUnboundedBranchFallsBackToCompleteGuard() {
        for (String diet : List.of("vegetarian", "vegan")) {
            String original = DietaryIngredientGuards.patterns(List.of(diet)).getFirst();
            assertNotNull(DietaryIngredientGuards.extractNecessaryPattern(original));
            String future = original + "|unbounded contradiction";
            assertTrue(Pattern.compile(future).matcher("unbounded contradiction").find());
            assertNull(DietaryIngredientGuards.extractNecessaryPattern(future));
            assertNull(DietaryIngredientGuards.necessaryPattern(future));
            assertNull(DietaryIngredientGuards.extractNecessaryPattern(original + " "));
        }
        assertNull(DietaryIngredientGuards.extractNecessaryPattern(null));
    }
}
