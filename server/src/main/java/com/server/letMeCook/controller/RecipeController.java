package com.server.letMeCook.controller;


import com.server.letMeCook.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.security.oauth2.jwt.Jwt;
import com.server.letMeCook.dto.recipe.RecipeCardDTO;
import com.server.letMeCook.dto.recipe.RecipeDTO;
import com.server.letMeCook.dto.recipe.RecipeSearchFields;
import com.server.letMeCook.model.DietaryPreference;
import com.server.letMeCook.model.User;
import com.server.letMeCook.service.*;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;
import com.server.letMeCook.security.RequestIdentity;


import java.util.*;

@RestController
@RequestMapping("/api/recipes")
public class RecipeController {

    private final RecipeService recipeService;
    @Autowired
    private UserRepository userRepository;
    @Value("${recommendation.url}")
    private String recommendationUrl;
    @Autowired
    private RestTemplate restTemplate;
    @Autowired
    private RecommendationService recommendationService;
    @Autowired
    public RecipeController(RecipeService recipeService) {
        this.recipeService = recipeService;
    }
    @GetMapping("/all")
    public List<RecipeDTO> getAllRecipes() {
        return recipeService.getAllRecipesWithFullRelations();
    }



    @GetMapping
    public Page<RecipeDTO> getAllRecipes(
            @PageableDefault(size = 20, page = 0, sort = "title", direction = Sort.Direction.ASC) Pageable pageable,
            @RequestParam(required = false) Integer maxCookTime
    ) {
        // Map lowercase sort keys → actual entity field names
        Map<String, String> allowedSortFieldMap = Map.of(
                "id", "id",
                "title", "title",
                "createdat", "createdAt",
                "viewcount", "viewCount",
                "cooktime", "cookTime",
                "ratingaverage", "ratingAverage",
                "rating", "ratingAverage"
        );

        List<Sort.Order> sanitizedOrders = new ArrayList<>();

        for (Sort.Order order : pageable.getSort()) {
            String requestedField = order.getProperty().toLowerCase();

            if (!allowedSortFieldMap.containsKey(requestedField)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid sort field: " + order.getProperty());
            }

            String actualField = allowedSortFieldMap.get(requestedField);
            sanitizedOrders.add(new Sort.Order(order.getDirection(), actualField));
        }

        Pageable sanitizedPageable = PageRequest.of(
                pageable.getPageNumber(),
                pageable.getPageSize(),
                Sort.by(sanitizedOrders)
        );

        return recipeService.getAllRecipeDTOs(sanitizedPageable, maxCookTime);
    }


    @GetMapping("/{id}")
    public RecipeDTO getRecipeById(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return recipeService.getRecipeById(id, RequestIdentity.optionalUserId(jwt))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Recipe not found"));
    }


    private Set<String> mergeSet(Set<String> original, Set<String> aiSuggested) {
        Set<String> result = new HashSet<>();
        if (original != null) result.addAll(original);
        if (aiSuggested != null) result.addAll(aiSuggested);
        return result.isEmpty() ? null : result;
    }



    @GetMapping("/search")
    public Page<RecipeCardDTO> advancedSearch(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Set<String> cuisines,
            @RequestParam(required = false) Set<String> ingredients,
            @RequestParam(required = false) Set<String> allergies,
            @RequestParam(required = false) Set<String> categories,
            @RequestParam(required = false) Set<String> dietaryPreferences,
            @RequestParam(required = false) Double minRating,
            @RequestParam(required = false, defaultValue = "true") Boolean isPublic,
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20, page = 0, sort = "title", direction = Sort.Direction.ASC) Pageable pageable
    ) {
        return recipeService.advancedSearch(keyword, cuisines, ingredients, allergies, categories, dietaryPreferences,
                isPublic, minRating, RequestIdentity.optionalUserId(jwt), pageable);
    }

    @GetMapping("/recommend")
    public ResponseEntity<?> recommend(
            @RequestParam(required = false, name = "recipeid") UUID recipeId,
            @RequestParam(required = false, name = "userid") UUID userId,
            @AuthenticationPrincipal Jwt jwt) {
        if (recipeId != null) {
            if (recipeService.getRecipeById(recipeId, RequestIdentity.optionalUserId(jwt)).isEmpty()) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Recipe not found");
            }
            Page<RecipeCardDTO> list = recipeService.recommendedByRecipeId(recipeId);
            return ResponseEntity.ok(list);
        }

        UUID actor = userId == null ? RequestIdentity.optionalUserId(jwt) : RequestIdentity.requireOwner(jwt, userId);
        if (actor == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sign in to get your recommendations");
        }
        return ResponseEntity.ok(recipeService.recommendedByUserId(actor));
    }

    @GetMapping("/flask-update-embed")
    public ResponseEntity<?> updateEmbedFromFlask() {
        return recommendationService.startPipeline();
    }
}
