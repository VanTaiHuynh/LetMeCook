package com.server.letMeCook.dto.recipe;

import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RecipeCardDTO {

    private UUID id;
    private String title;
    private String description;
    private String authorName;
    private float servings;
    private String imageUrl;
    private String sourceUrl;
    private String sourceLicense;
    private String sourceAuthor;
    private String imageSourceUrl;
    private String imageAuthor;
    private String imageLicense;
    private String imageKind;
    private int cookingTime;
    private double ratingAverage;
    private int ratingCount;

}
