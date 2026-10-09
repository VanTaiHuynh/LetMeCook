package com.server.letMeCook.service;

import com.server.letMeCook.model.RecipeDisliked;
import com.server.letMeCook.repository.RecipeDislikedRepository;
import com.server.letMeCook.repository.RecipeRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

import static org.springframework.http.HttpStatus.CONFLICT;
import static org.springframework.http.HttpStatus.NOT_FOUND;

@Service
@RequiredArgsConstructor
public class RecipeDislikedService {

    private final RecipeDislikedRepository repository;
    private final RecipeRepository recipeRepository;

    public void addDislike(UUID userId, UUID recipeId) {
        if (recipeRepository.findById(recipeId)
                .filter(recipe -> recipe.isPublic() || (recipe.getAuthor() != null
                        && userId.equals(recipe.getAuthor().getId())))
                .isEmpty()) {
            throw new ResponseStatusException(NOT_FOUND, "Recipe not found");
        }
        // Check if already disliked
        boolean alreadyDisliked = repository.findDislikedRecipeIdsByUserId(userId)
                .contains(recipeId);

        if (alreadyDisliked) {
            throw new ResponseStatusException(CONFLICT, "User already disliked this recipe.");
        }

        RecipeDisliked dislike = new RecipeDisliked();
        dislike.setUserId(userId);
        dislike.setRecipeId(recipeId);

        repository.save(dislike);
    }
}
