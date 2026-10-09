package com.server.letMeCook.repository;

import com.server.letMeCook.model.Recipe;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface RecipeRepository extends JpaRepository<Recipe, UUID> {

    @Query("SELECT r FROM Recipe r WHERE r.isPublic = true AND (:demo = false OR " +
            "(r.demoPermissionConfirmed = true AND length(trim(coalesce(r.demoPermissionNote,''))) > 0 " +
            "AND r.imageKind = 'source' AND r.imageUrl LIKE '/recipe-images/%'))")
    Page<Recipe> findPublicCatalog(@Param("demo") boolean demo, Pageable pageable);

    @Query("SELECT r FROM Recipe r WHERE r.isPublic = true AND r.cookTime > 0 AND r.cookTime <= :maximum AND (:demo = false OR " +
            "(r.demoPermissionConfirmed = true AND length(trim(coalesce(r.demoPermissionNote,''))) > 0 " +
            "AND r.imageKind = 'source' AND r.imageUrl LIKE '/recipe-images/%'))")
    Page<Recipe> findQuickPublicCatalog(@Param("demo") boolean demo, @Param("maximum") int maximum, Pageable pageable);

    @Query("SELECT r FROM Recipe r WHERE r.isPublic = true AND (:demo = false OR " +
            "(r.demoPermissionConfirmed = true AND length(trim(coalesce(r.demoPermissionNote,''))) > 0 " +
            "AND r.imageKind = 'source' AND r.imageUrl LIKE '/recipe-images/%')) ORDER BY r.viewCount DESC,r.id")
    Page<Recipe> findTopCatalog(@Param("demo") boolean demo, Pageable pageable);

    @Query("SELECT r FROM Recipe r WHERE r.author.id = :author AND r.isPublic = true AND (:demo = false OR " +
            "(r.demoPermissionConfirmed = true AND length(trim(coalesce(r.demoPermissionNote,''))) > 0 " +
            "AND r.imageKind = 'source' AND r.imageUrl LIKE '/recipe-images/%'))")
    List<Recipe> findAuthorCatalog(@Param("author") UUID author, @Param("demo") boolean demo);


    @Query("SELECT r FROM Recipe r WHERE r.isPublic = true")
    Page<Recipe> findAllPublic(Pageable pageable);

    @Query("SELECT r FROM Recipe r WHERE r.isPublic = true ORDER BY r.viewCount DESC")
    Page<Recipe> findTopByViews(Pageable pageable);

    @Query("""
        SELECT DISTINCT r FROM Recipe r
        LEFT JOIN FETCH r.recipeIngredients ri
        LEFT JOIN FETCH ri.ingredient i
        LEFT JOIN FETCH r.categories
        LEFT JOIN FETCH r.dietaryPreferences
        LEFT JOIN FETCH r.cuisines
        LEFT JOIN FETCH r.author
        WHERE r.isPublic = true
        """)
    List<Recipe> findAllWithFullRelations();

    @Query("""
        SELECT DISTINCT r FROM Recipe r
        LEFT JOIN FETCH r.author
        WHERE r.id IN :ids AND r.isPublic = true
        """)
    List<Recipe> findCatalogBasesByIds(@Param("ids") List<UUID> ids);

    default List<Recipe> findAllWithFullRelationsByIds(List<UUID> ids){
        if(ids.isEmpty())return List.of();
        List<Recipe> recipes=findCatalogBasesByIds(ids);
        for(Recipe recipe:recipes){org.hibernate.Hibernate.initialize(recipe.getCategories());org.hibernate.Hibernate.initialize(recipe.getDietaryPreferences());org.hibernate.Hibernate.initialize(recipe.getCuisines());org.hibernate.Hibernate.initialize(recipe.getRecipeIngredients());}
        for(Recipe recipe:recipes)for(var item:recipe.getRecipeIngredients())org.hibernate.Hibernate.initialize(item.getIngredient());
        return recipes;
    }


    @Query("""
    select r.id
    from Recipe r
    where r.isPublic = true
    order by coalesce(r.viewCount, 0) desc,
             r.createdAt desc
    """)
    List<UUID> findTopPublicRecipeIds(Pageable pageable);

    // Find recipes by author ID
    List<Recipe> findByAuthorIdAndIsPublicTrue(UUID authorId);
}
