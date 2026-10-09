package com.server.letMeCook.model;


import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonManagedReference;
import jakarta.persistence.*;
import lombok.Data;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.GenericGenerator;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

@Entity
@Table (name = "recipe")
@Getter @Setter
public class Recipe {

    @Id
    @GeneratedValue(generator = "UUID")
    @GenericGenerator(name = "UUID", strategy = "org.hibernate.id.UUIDGenerator")
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @Column(name = "title")
    private String title = "";

    @Column(name = "description", columnDefinition = "TEXT")
    private String description = "";

    @Column(name = "servings")
    private float servings = 0;

    @Column(name = "image_url")
    private String imageUrl = "";

    @Column(name = "source_url", columnDefinition = "TEXT")
    private String sourceUrl;

    @Column(name = "source_license", columnDefinition = "TEXT")
    private String sourceLicense;

    @Column(name = "source_author", columnDefinition = "TEXT")
    private String sourceAuthor;

    @Column(name = "image_source_url", columnDefinition = "TEXT")
    private String imageSourceUrl;

    @Column(name = "image_author", columnDefinition = "TEXT")
    private String imageAuthor;

    @Column(name = "image_license", columnDefinition = "TEXT")
    private String imageLicense;

    @Column(name = "image_kind", columnDefinition = "TEXT")
    private String imageKind;

    @Column(name = "demo_permission_confirmed")
    private boolean demoPermissionConfirmed = false;

    @Column(name = "demo_permission_note", columnDefinition = "TEXT")
    private String demoPermissionNote;

    @Column(name = "rating_average")
    private double ratingAverage = 0;

    @Column(name = "rating_count")
    private int ratingCount = 0;

    @Column(name = "is_public")
    private boolean isPublic = true;

    @Column(name="created_at")
    private LocalDateTime createdAt;

    @Column(name = "directions",columnDefinition = "TEXT")
    private String directions = "";

    @Column(name="view_count")
    private int viewCount = 0;


    @Column(name ="time")
    int cookTime = 0;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "author_id", referencedColumnName = "id")
    private User author;

    @ManyToMany(fetch = FetchType.LAZY)
    @org.hibernate.annotations.BatchSize(size=50)
    @JoinTable(
            name = "recipe_dietary_pref",
            joinColumns = @JoinColumn(name = "recipe_id"),
            inverseJoinColumns = @JoinColumn(name = "preference_id")
    )
    private Set<DietaryPreference> dietaryPreferences = new HashSet<>();

    @ManyToMany
    @org.hibernate.annotations.BatchSize(size=50)
    @JoinTable(
            name = "recipe_categories",
            joinColumns = @JoinColumn(name = "recipe_id"),
            inverseJoinColumns = @JoinColumn(name = "category_id")
    )
    private Set<Category> categories = new HashSet<>();

    @ManyToMany
    @org.hibernate.annotations.BatchSize(size=50)
    @JoinTable(
            name = "recipe_cuisines",
            joinColumns = @JoinColumn(name = "recipe_id"),
            inverseJoinColumns = @JoinColumn(name = "cuisine_id")
    )
    private Set<Cuisine> cuisines = new HashSet<>();

    @OneToMany(mappedBy = "recipe", cascade = CascadeType.ALL, orphanRemoval = true)
    @org.hibernate.annotations.BatchSize(size=50)
    private Set<RecipeIngredient> recipeIngredients = new HashSet<>();

}
