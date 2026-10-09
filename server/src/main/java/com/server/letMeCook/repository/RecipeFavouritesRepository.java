package com.server.letMeCook.repository;

import com.server.letMeCook.model.RecipeFavourites;
import com.server.letMeCook.model.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface RecipeFavouritesRepository extends JpaRepository<RecipeFavourites, UUID> {
    @org.springframework.data.jpa.repository.Query("""
       SELECT f.recipe.id FROM RecipeFavourites f JOIN f.recipe r WHERE f.user.id=:user
       AND ((r.isPublic=true AND (:demo=false OR (r.demoPermissionConfirmed=true AND
         length(trim(coalesce(r.demoPermissionNote,'')))>0 AND r.imageKind='source' AND r.imageUrl LIKE '/recipe-images/%')))
         OR (r.isPublic=false AND r.author.id=:user))
       AND NOT EXISTS(SELECT d.id FROM RecipeDisliked d WHERE d.userId=:user AND d.recipeId=r.id)
       ORDER BY f.createdAt DESC,f.id
       """)
    List<UUID> findRecommendationSeeds(@org.springframework.data.repository.query.Param("user")UUID user,
        @org.springframework.data.repository.query.Param("demo")boolean demo,org.springframework.data.domain.Pageable pageable);
    List<RecipeFavourites> findByUserIdOrderByCreatedAtDesc(UUID userId);
}
