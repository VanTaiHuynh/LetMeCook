package com.server.letMeCook.controller;

import com.server.letMeCook.dto.recipe.RecipeCardDTO;
import com.server.letMeCook.dto.recipe.RecipeDTO;
import com.server.letMeCook.service.RecipeService;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class RecipeRecommendationControllerTests {
    private Jwt jwt(UUID actor) {
        return Jwt.withTokenValue("unit-only").header("alg","none").subject(actor.toString()).build();
    }
    @Test void noSelectorUsesTheVerifiedJwtActorAndPreservesThePageEnvelope() {
        UUID actor=UUID.randomUUID();RecipeService service=mock(RecipeService.class);Page<RecipeCardDTO> page=Page.empty();
        when(service.recommendedByUserId(actor)).thenReturn(page);
        var response=new RecipeController(service).recommend(null,null,jwt(actor));
        assertEquals(HttpStatus.OK,response.getStatusCode());assertSame(page,response.getBody());verify(service).recommendedByUserId(actor);verifyNoMoreInteractions(service);
    }
    @Test void legacyOwnSelectorWorksButForgedOrUnsignedAccountSelectorsNeverReachTheService() {
        UUID actor=UUID.randomUUID(),other=UUID.randomUUID();RecipeService service=mock(RecipeService.class);when(service.recommendedByUserId(actor)).thenReturn(Page.empty());
        var controller=new RecipeController(service);assertEquals(HttpStatus.OK,controller.recommend(null,actor,jwt(actor)).getStatusCode());
        assertEquals(HttpStatus.FORBIDDEN,assertThrows(ResponseStatusException.class,()->controller.recommend(null,other,jwt(actor))).getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED,assertThrows(ResponseStatusException.class,()->controller.recommend(null,actor,null)).getStatusCode());
        verify(service).recommendedByUserId(actor);verifyNoMoreInteractions(service);
    }
    @Test void guestOrInvalidIdentityWithoutSelectorIsUnauthorizedBeforeAnyRecipeRead() {
        RecipeService service=mock(RecipeService.class);var controller=new RecipeController(service);
        assertEquals(HttpStatus.UNAUTHORIZED,assertThrows(ResponseStatusException.class,()->controller.recommend(null,null,null)).getStatusCode());
        var invalid=Jwt.withTokenValue("unit-only").header("alg","none").subject("invalid-user").build();
        assertEquals(HttpStatus.UNAUTHORIZED,assertThrows(ResponseStatusException.class,()->controller.recommend(null,null,invalid)).getStatusCode());verifyNoInteractions(service);
    }
    @Test void guestRecipeSimilarityStillChecksFreshVisibilityAndDoesNotRequestAccountRanking() {
        UUID recipe=UUID.randomUUID(),missing=UUID.randomUUID();RecipeService service=mock(RecipeService.class);Page<RecipeCardDTO> page=Page.empty();
        when(service.getRecipeById(recipe,null)).thenReturn(Optional.of(new RecipeDTO()));when(service.recommendedByRecipeId(recipe)).thenReturn(page);
        when(service.getRecipeById(missing,null)).thenReturn(Optional.empty());var controller=new RecipeController(service);
        assertSame(page,controller.recommend(recipe,null,null).getBody());
        assertEquals(HttpStatus.NOT_FOUND,assertThrows(ResponseStatusException.class,()->controller.recommend(missing,null,null)).getStatusCode());
        verify(service).getRecipeById(recipe,null);verify(service).recommendedByRecipeId(recipe);verify(service).getRecipeById(missing,null);verifyNoMoreInteractions(service);
    }
}
