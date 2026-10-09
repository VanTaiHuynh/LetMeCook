package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.repository.KitchenRepository.Recipe;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

/** Keep the completed food bound to the same source used to start cooking. */
final class CookSourceVersion {
    private CookSourceVersion() { }
    static String of(Recipe recipe,ObjectMapper mapper) {
        try {
            String source=recipe.title()+"\n"+recipe.directions()+"\n"+recipe.servings()+"\n"+mapper.writeValueAsString(recipe.ingredients());
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8)));
        } catch (java.io.IOException | java.security.NoSuchAlgorithmException error) {
            throw new IllegalStateException("The cooking source could not be versioned",error);
        }
    }
}
