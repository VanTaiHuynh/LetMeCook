package com.server.letMeCook.security;

import com.server.letMeCook.controller.*;
import com.server.letMeCook.dto.recipe.RecipeDTO;
import com.server.letMeCook.model.User;
import com.server.letMeCook.repository.UserRepository;
import com.server.letMeCook.service.*;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.RequestDispatcher;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest({RecipeController.class, RecipeBrowsingHistoryController.class, RecipeDislikedController.class,
        RecommendationController.class, UserController.class, ProfileController.class})
@Import({SecurityConfig.class, ApiAuthorizationTests.AiTestEndpoints.class})
class ApiAuthorizationTests {
    @MockitoBean private com.server.letMeCook.service.PlatformService platformService;
    private static final UUID OWNER = UUID.randomUUID();
    private static final UUID OTHER = UUID.randomUUID();
    private static final UUID RECIPE = UUID.randomUUID();
    @Autowired MockMvc mvc;
    @MockitoBean JwtDecoder decoder;
    @MockitoBean RecipeService recipes;
    @MockitoBean RecipeBrowsingHistoryService history;
    @MockitoBean RecipeDislikedService dislikes;
    @MockitoBean RecommendationService recommendations;
    @MockitoBean UserService users;
    @MockitoBean UserRepository userRepository;
    @MockitoBean org.springframework.web.client.RestTemplate restTemplate;

    @RestController
    static class AiTestEndpoints {
        @GetMapping("/api/ai/status") String status() { return "ok"; }
        @PostMapping({"/api/ai/search", "/api/ai/vision"}) String extract() { return "ok"; }
        @DeleteMapping("/api/ai/admin") String delete() { return "ok"; }
    }

    @Test
    void onlyApprovedLocalAiRoutesAllowGuests() throws Exception {
        mvc.perform(get("/api/ai/status")).andExpect(status().isOk());
        mvc.perform(post("/api/ai/search")).andExpect(status().isOk());
        mvc.perform(post("/api/ai/vision")).andExpect(status().isOk());
        mvc.perform(delete("/api/ai/admin")).andExpect(status().isUnauthorized());
    }

    @Test
    void internalErrorDispatchPreservesGuestValidationStatusWithoutOpeningErrorPath() throws Exception {
        mvc.perform(get("/error")).andExpect(status().isUnauthorized());
        mvc.perform(get("/error").requestAttr(RequestDispatcher.ERROR_STATUS_CODE, 422)
                .requestAttr(RequestDispatcher.ERROR_REQUEST_URI, "/api/ai/search")
                .with(request -> { request.setDispatcherType(DispatcherType.ERROR); return request; }))
                .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.status").value(422));
    }

    @Test
    void personalHistoryRequiresAuthenticationAndMatchingSubject() throws Exception {
        mvc.perform(get("/api/recently-viewed/" + OWNER)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/recently-viewed/" + OWNER).with(jwt().jwt(token -> token.subject(OTHER.toString()))))
                .andExpect(status().isForbidden());
        verifyNoInteractions(history);
        when(history.getRecentlyViewedRecipeCards(eq(OWNER), any())).thenReturn(Page.empty());
        mvc.perform(get("/api/recently-viewed/" + OWNER).with(jwt().jwt(token -> token.subject(OWNER.toString()))))
                .andExpect(status().isOk());
        verify(history).getRecentlyViewedRecipeCards(eq(OWNER), any());
    }

    @Test
    void aUserCannotWriteAnotherUsersDislikes() throws Exception {
        mvc.perform(post("/api/dislikes").param("userId", OWNER.toString()).param("recipeId", RECIPE.toString())
                .with(jwt().jwt(token -> token.subject(OTHER.toString())))).andExpect(status().isForbidden());
        verifyNoInteractions(dislikes);
        mvc.perform(post("/api/dislikes").param("userId", OWNER.toString()).param("recipeId", RECIPE.toString())
                .with(jwt().jwt(token -> token.subject(OWNER.toString())))).andExpect(status().isOk());
        verify(dislikes).addDislike(OWNER, RECIPE);
    }

    @Test
    void personalizedRecommendationsCannotBeReadByGuestsOrOtherUsers() throws Exception {
        mvc.perform(get("/api/recipes/recommend").param("userid", OWNER.toString()))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/recipes/recommend").param("userid", OWNER.toString())
                .with(jwt().jwt(token -> token.subject(OTHER.toString())))).andExpect(status().isForbidden());
        verifyNoInteractions(recipes);
        when(recipes.recommendedByUserId(OWNER)).thenReturn(Page.empty());
        mvc.perform(get("/api/recipes/recommend").param("userid", OWNER.toString())
                .with(jwt().jwt(token -> token.subject(OWNER.toString())))).andExpect(status().isOk());
        verify(recipes).recommendedByUserId(OWNER);
    }

    @Test
    void recipeReadsPassOnlyVerifiedViewerIdAndHideMissingOrPrivateRecipes() throws Exception {
        when(recipes.getRecipeById(RECIPE, null)).thenReturn(Optional.empty());
        mvc.perform(get("/api/recipes/" + RECIPE)).andExpect(status().isNotFound());
        mvc.perform(get("/api/recipes/recommend").param("recipeid", RECIPE.toString()))
                .andExpect(status().isNotFound());
        verify(recipes, never()).recommendedByRecipeId(any());
        when(recipes.getRecipeById(RECIPE, OWNER)).thenReturn(Optional.of(new RecipeDTO()));
        mvc.perform(get("/api/recipes/" + RECIPE).with(jwt().jwt(token -> token.subject(OWNER.toString()))))
                .andExpect(status().isOk());
        verify(recipes).getRecipeById(RECIPE, OWNER);
    }

    @Test
    void cacheAdministrationRejectsGuestsAndUserControlledAdminClaims() throws Exception {
        mvc.perform(post("/api/recipes/recommendation/embed/remove")
                .contentType(MediaType.APPLICATION_JSON).content("{\"ids\":[]}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/recipes/recommendation/pipeline/run")
                .with(jwt().jwt(token -> token.subject(OWNER.toString())))).andExpect(status().isForbidden());
        Jwt forged = Jwt.withTokenValue("forged").header("alg", "HS256").subject(OWNER.toString())
                .claim("user_metadata", Map.of("role", "admin")).claim("role", "admin").build();
        when(decoder.decode("forged")).thenReturn(forged);
        mvc.perform(get("/api/recipes/recommendation/pipeline/run")
                .header(HttpHeaders.AUTHORIZATION, "Bearer forged")).andExpect(status().isForbidden());
        verifyNoInteractions(recommendations, restTemplate);
        Jwt admin = Jwt.withTokenValue("admin").header("alg", "HS256").subject(OWNER.toString())
                .claim("app_metadata", Map.of("role", "admin")).build();
        when(decoder.decode("admin")).thenReturn(admin);
        when(recommendations.startPipeline()).thenReturn(org.springframework.http.ResponseEntity.accepted().body(Map.of("started",true)));
        mvc.perform(get("/api/recipes/recommendation/pipeline/run")
                .header(HttpHeaders.AUTHORIZATION, "Bearer admin")).andExpect(status().isAccepted());
        verify(recommendations).startPipeline();
    }

    @Test
    void profileUsesSubjectRatherThanEmailClaimAndSupportsBlankFields() throws Exception {
        User user = new User();
        user.setId(OWNER);
        user.setEmail("owner@example.test");
        user.setAboutMe(null);
        when(userRepository.findById(OWNER)).thenReturn(Optional.of(user));
        mvc.perform(get("/api/profile").with(jwt().jwt(token -> token.subject(OWNER.toString())
                        .claim("email", "someone-else@example.test"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.email").value("owner@example.test"));
        verify(userRepository).findById(OWNER);
        verify(userRepository, never()).findByEmail(any());
    }
}
