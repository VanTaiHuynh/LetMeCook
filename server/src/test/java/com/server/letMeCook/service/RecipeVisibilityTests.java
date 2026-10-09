package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.dto.user.UserPublicDTO;
import com.server.letMeCook.mapper.RecipeMapper;
import com.server.letMeCook.model.Recipe;
import com.server.letMeCook.model.User;
import com.server.letMeCook.repository.RecipeRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class RecipeVisibilityTests {
    @Test
    void privateRecipeIsVisibleOnlyToItsAuthor() {
        RecipeRepository repository = mock(RecipeRepository.class);
        RecipeService service = new RecipeService(repository, mock(RecommendationService.class), new RecipeMapper());
        User author = new User();
        author.setId(UUID.randomUUID());
        Recipe recipe = new Recipe();
        recipe.setId(UUID.randomUUID());
        recipe.setAuthor(author);
        recipe.setPublic(false);
        when(repository.findById(recipe.getId())).thenReturn(Optional.of(recipe));
        assertTrue(service.getRecipeById(recipe.getId()).isEmpty());
        assertTrue(service.getRecipeById(recipe.getId(), UUID.randomUUID()).isEmpty());
        assertTrue(service.getRecipeById(recipe.getId(), author.getId()).isPresent());
        recipe.setPublic(true);
        assertTrue(service.getRecipeById(recipe.getId()).isPresent());
    }

    @Test
    void demoDetailKeepsOwnPublicRecipeButNeverPublishesItWithoutApproval() {
        RecipeRepository repository=mock(RecipeRepository.class);
        RecipeService service=new RecipeService(repository,mock(RecommendationService.class),new RecipeMapper());
        PlatformService platform=mock(PlatformService.class);when(platform.publicDemo()).thenReturn(true);
        ReflectionTestUtils.setField(service,"platformService",platform);
        User author=new User();author.setId(UUID.randomUUID());
        Recipe recipe=new Recipe();recipe.setId(UUID.randomUUID());recipe.setAuthor(author);recipe.setPublic(true);
        when(repository.findById(recipe.getId())).thenReturn(Optional.of(recipe));
        UUID foreign=UUID.randomUUID();
        assertTrue(service.getRecipeById(recipe.getId(),author.getId()).isPresent());
        assertTrue(service.getRecipeById(recipe.getId(),foreign).isEmpty());
        assertTrue(service.getRecipeById(recipe.getId()).isEmpty());
        assertFalse(service.isPublicCatalogRecipe(recipe));
        recipe.setDemoPermissionConfirmed(true);recipe.setDemoPermissionNote("Synthetic test declaration");
        recipe.setImageKind("source");recipe.setImageUrl("/recipe-images/test.jpg");
        assertTrue(service.getRecipeById(recipe.getId(),foreign).isPresent());
        assertTrue(service.getRecipeById(recipe.getId()).isPresent());
        recipe.setPublic(false);
        assertTrue(service.getRecipeById(recipe.getId(),author.getId()).isPresent());
        assertTrue(service.getRecipeById(recipe.getId(),foreign).isEmpty());
        assertTrue(service.getRecipeById(recipe.getId()).isEmpty());
    }

    @Test
    void recommendationFiltersPrivateRowsAndKeepsSimilarityOrder() {
        RecipeRepository repository = mock(RecipeRepository.class);
        RecommendationService recommendations = mock(RecommendationService.class);
        RecipeService service = new RecipeService(repository, recommendations, new RecipeMapper());
        Recipe first = new Recipe(); first.setId(UUID.randomUUID());
        Recipe second = new Recipe(); second.setId(UUID.randomUUID());
        Recipe hidden = new Recipe(); hidden.setId(UUID.randomUUID()); hidden.setPublic(false);
        UUID seed = UUID.randomUUID();
        List<UUID> order = List.of(first.getId(), hidden.getId(), second.getId());
        when(recommendations.recommendByRecipeId(seed, 10)).thenReturn(order);
        when(repository.findAllWithFullRelationsByIds(order)).thenReturn(List.of(second, hidden, first));
        assertEquals(List.of(first.getId(), second.getId()), service.recommendedByRecipeId(seed).getContent()
                .stream().map(card -> card.getId()).toList());
    }

    @Test
    void privateSearchRejectsGuestBeforeQueryingDatabase() {
        RecipeService service = new RecipeService(mock(RecipeRepository.class), mock(RecommendationService.class), new RecipeMapper());
        ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.advancedSearch(
                null, null, null, null, null, null, false, PageRequest.of(0, 10)));
        assertEquals(401, error.getStatusCode().value());
    }

    @Test
    void publicUserRepresentationNeverContainsEmail() throws Exception {
        User user = new User(); user.setEmail("private@example.test");
        String json = new ObjectMapper().writeValueAsString(UserPublicDTO.from(user));
        assertFalse(json.contains("email"));
        assertFalse(json.contains("private@example.test"));
    }
}
