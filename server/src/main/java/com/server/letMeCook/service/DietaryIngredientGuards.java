package com.server.letMeCook.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Negative checks for known source contradictions, never dietary certification. */
final class DietaryIngredientGuards {
    private static final Map<String,String> REGEX = load();
    private static final Map<String,Pattern> COMPILED = compile();
    private static final String TERM_START = "(?<![a-z0-9_])";
    private static final String TERM_END = "(?![a-z0-9_])";
    private static final Set<String> VERIFIED_PATTERN_HASHES = Set.of(
            "39ff396b67a32429d4cc3a8acd6c8e9008c7f7eefc7b288be3889f04e68dfc8e",
            "7ca5458322c99535ad6f08faad170057d39964b645187c2a3866f7b9deab0f02");
    private static final Map<String,String> NECESSARY_TERMS = necessaryTerms();
    private DietaryIngredientGuards() { }

    private static Map<String,String> load() {
        try (InputStream source=DietaryIngredientGuards.class.getResourceAsStream("/dietary-ingredient-guards.json")) {
            if(source==null)throw new IllegalStateException("Shared dietary ingredient patterns are unavailable");
            Map<String,String> patterns=new ObjectMapper().readValue(source,new TypeReference<>(){});
            if(!patterns.keySet().equals(Set.of("vegetarian","vegan"))||patterns.values().stream().anyMatch(value->value==null||value.isBlank()))throw new IllegalStateException("Shared dietary ingredient patterns are invalid");
            return Map.copyOf(patterns);
        } catch(java.io.IOException error) {
            throw new IllegalStateException("Shared dietary ingredient patterns could not be read",error);
        }
    }

    private static Map<String,Pattern> compile() {
        Map<String,Pattern> compiled=new LinkedHashMap<>();
        REGEX.forEach((diet,regex)->compiled.put(diet,Pattern.compile(regex)));
        return Map.copyOf(compiled);
    }

    static List<String> patterns(Collection<String> diets) {
        Set<String> patterns=new LinkedHashSet<>();
        if(diets!=null)for(String diet:diets){String regex=REGEX.get(normalize(diet));if(regex!=null)patterns.add(regex);}
        return List.copyOf(patterns);
    }

    static boolean compatible(String ingredient,Collection<String> diets) {
        String name=ingredient==null?"":ingredient.toLowerCase(Locale.ROOT);
        if(diets!=null)for(String diet:diets){Pattern pattern=COMPILED.get(normalize(diet));if(pattern!=null&&pattern.matcher(name).find())return false;}
        return true;
    }

    private static Map<String,String> necessaryTerms() {
        Map<String,String> result = new LinkedHashMap<>();
        for (String full : REGEX.values()) {
            String necessary = extractNecessaryPattern(full);
            if (necessary != null) result.put(full, necessary);
        }
        return Map.copyOf(result);
    }

    static String extractNecessaryPattern(String fullPattern) {
        if (fullPattern == null) return null;
        try {
            String hash = java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(fullPattern.getBytes(StandardCharsets.UTF_8)));
            // New patterns need independent implication/parity verification before opt-in.
            // An unknown or changed pattern always uses the complete SQL guard directly.
            if (!VERIFIED_PATTERN_HASHES.contains(hash)) return null;
        } catch (java.security.NoSuchAlgorithmException unavailable) {
            return null;
        }
        Pattern positiveTerm = Pattern.compile(Pattern.quote(TERM_START) + "(.*?)" + Pattern.quote(TERM_END));
        var matcher = positiveTerm.matcher(fullPattern);
        Set<String> terms = new LinkedHashSet<>();
        while (matcher.find()) terms.add(matcher.group(1));
        return terms.isEmpty() ? null : TERM_START + "(?:" + String.join("|", terms) + ")" + TERM_END;
    }

    static String necessaryPattern(String fullPattern) {
        return NECESSARY_TERMS.get(fullPattern);
    }

    private static String normalize(String diet) {
        return diet==null?"":diet.trim().toLowerCase(Locale.ROOT).replace("-","").replace(" ","");
    }
}
