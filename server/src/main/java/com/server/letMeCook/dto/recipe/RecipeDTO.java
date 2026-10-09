package com.server.letMeCook.dto.recipe;

import com.server.letMeCook.model.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Getter @Setter
public class RecipeDTO {
    private UUID id;
    private String title;
    private String description;
    private double ratingAverage;
    private int ratingCount;
    private float servings;
    private String imageUrl;
    private String sourceUrl;
    private String sourceLicense;
    private String sourceAuthor;
    private String imageSourceUrl;
    private String imageAuthor;
    private String imageLicense;
    private String imageKind;
    private boolean isPublic;
    private String authorName;
    private LocalDateTime createdAt;
    private String directions;
    private int cookingTime;
    private List<String> categories;
    private List<String> dietaryPreferences;
    private List<String> cuisines;
    private List<RecipeIngredientDTO> ingredients;
}
