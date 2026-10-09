package com.server.letMeCook.mapper;

import com.server.letMeCook.dto.recipe.RecipeCardDTO;
import com.server.letMeCook.dto.recipe.RecipeDTO;
import com.server.letMeCook.dto.recipe.RecipeIngredientDTO;
import com.server.letMeCook.model.*;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.stream.Collectors;

@Component
public class RecipeMapper {

    public static RecipeDTO toDTO(Recipe recipe) {
        RecipeDTO dto = new RecipeDTO();
        dto.setRatingAverage(recipe.getRatingAverage());
        dto.setRatingCount(recipe.getRatingCount());
        dto.setId(recipe.getId());
        dto.setTitle(recipe.getTitle());
        dto.setDescription(recipe.getDescription());
        dto.setServings(recipe.getServings());
        dto.setImageUrl(recipe.getImageUrl());
        dto.setSourceUrl(recipe.getSourceUrl());
        dto.setSourceLicense(recipe.getSourceLicense());
        dto.setSourceAuthor(recipe.getSourceAuthor());
        dto.setImageSourceUrl(recipe.getImageSourceUrl());
        dto.setImageAuthor(recipe.getImageAuthor());
        dto.setImageLicense(recipe.getImageLicense());
        dto.setImageKind(recipe.getImageKind());
        dto.setPublic(recipe.isPublic());
        dto.setAuthorName(recipe.getAuthor() != null
                ? recipe.getAuthor().getFirstName() + " " + recipe.getAuthor().getLastName()
                : recipe.getSourceAuthor() != null && !recipe.getSourceAuthor().isBlank()
                    ? recipe.getSourceAuthor() : "Unknown");
        dto.setCreatedAt(recipe.getCreatedAt());
        dto.setDirections(recipe.getDirections());
        dto.setCookingTime(recipe.getCookTime());

        dto.setCategories(recipe.getCategories().stream()
                .map(Category::getName)
                .collect(Collectors.toList()));

        dto.setDietaryPreferences(recipe.getDietaryPreferences().stream()
                .map(DietaryPreference::getName)
                .collect(Collectors.toList()));

        dto.setCuisines(recipe.getCuisines().stream()
                .map(Cuisine::getName)
                .collect(Collectors.toList()));

        dto.setIngredients(recipe.getRecipeIngredients().stream()
                .map(RecipeIngredientDTO::new)
                .collect(Collectors.toList()));

        return dto;
    }

    public static RecipeCardDTO toCardDTO(Recipe recipe) {
        RecipeCardDTO dto = new RecipeCardDTO();
        dto.setRatingAverage(recipe.getRatingAverage());
        dto.setRatingCount(recipe.getRatingCount());
        dto.setId(recipe.getId());
        dto.setTitle(recipe.getTitle());
        dto.setDescription(recipe.getDescription());
        dto.setServings(recipe.getServings());
        dto.setImageUrl(recipe.getImageUrl());
        dto.setSourceUrl(recipe.getSourceUrl());
        dto.setSourceLicense(recipe.getSourceLicense());
        dto.setSourceAuthor(recipe.getSourceAuthor());
        dto.setImageSourceUrl(recipe.getImageSourceUrl());
        dto.setImageAuthor(recipe.getImageAuthor());
        dto.setImageLicense(recipe.getImageLicense());
        dto.setImageKind(recipe.getImageKind());
        dto.setCookingTime(recipe.getCookTime());
        dto.setAuthorName(recipe.getAuthor() != null
                ? recipe.getAuthor().getFirstName() + " " + recipe.getAuthor().getLastName()
                : recipe.getSourceAuthor() != null && !recipe.getSourceAuthor().isBlank()
                    ? recipe.getSourceAuthor() : "Unknown");
        return dto;
    }
}
