package com.server.letMeCook.repository;

import com.server.letMeCook.model.RecipeBrowsingHistory;
import com.server.letMeCook.model.User;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface RecipeBrowsingHistoryRepository extends JpaRepository<RecipeBrowsingHistory, UUID> {
    @Query("""
       SELECT h.recipe.id FROM RecipeBrowsingHistory h JOIN h.recipe r WHERE h.user.id=:user
       AND ((r.isPublic=true AND (:demo=false OR (r.demoPermissionConfirmed=true AND
         length(trim(coalesce(r.demoPermissionNote,'')))>0 AND r.imageKind='source' AND r.imageUrl LIKE '/recipe-images/%')))
         OR (r.isPublic=false AND r.author.id=:user))
       AND NOT EXISTS(SELECT d.id FROM RecipeDisliked d WHERE d.userId=:user AND d.recipeId=r.id)
       ORDER BY h.viewedAt DESC,h.id
       """)
    List<UUID> findRecommendationSeeds(@Param("user")UUID user,@Param("demo")boolean demo,Pageable pageable);
    List<RecipeBrowsingHistory> findByUserIdOrderByViewedAtDesc(UUID userId);

    @Query("""
        SELECT h FROM RecipeBrowsingHistory h JOIN h.recipe r
        WHERE h.user.id = :userId AND ((r.isPublic = true AND (:demo = false OR
          (r.demoPermissionConfirmed = true AND length(trim(coalesce(r.demoPermissionNote,''))) > 0
           AND r.imageKind = 'source' AND r.imageUrl LIKE '/recipe-images/%')))
          OR (r.isPublic = false AND r.author.id = :userId))
        ORDER BY h.viewedAt DESC
        """)
    Page<RecipeBrowsingHistory> findVisibleByUserId(@Param("userId") UUID userId, @Param("demo") boolean demo, Pageable pageable);
}
