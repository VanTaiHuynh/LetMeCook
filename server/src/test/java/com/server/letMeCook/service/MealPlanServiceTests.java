package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.repository.MealPlanRepository;
import com.server.letMeCook.repository.MealPlanRepository.SavedPlan;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class MealPlanServiceTests {
    private UUID leftoversContext(){
        UUID leftover=UUID.randomUUID();var context=mock(PlanningContextPort.class);service.setPlanningContexts(context);var platform=mock(PlatformService.class);when(platform.config()).thenReturn(Map.of("kitchenEnabled",true));org.springframework.test.util.ReflectionTestUtils.setField(service,"platformService",platform);
        when(context.load(eq(owner),isNull(),anyBoolean(),any())).thenReturn(new PlanningContextPort.Context("local-ai.v2",Map.of("confirmedLeftovers",List.of(Map.of("id",leftover.toString(),"version",1,"recipeId",recipe.toString(),"servingsAvailable",2,"cookedOn","2026-10-08","useBy","2026-10-14")))));return leftover;
    }
    private Map<String,Object> reusedPlan(UUID id,int servings){var result=plan();result.put("meals",List.of(Map.of("dayIndex",0,"date",week.toString(),"recipe",Map.of("id",recipe.toString()),"reuse",Map.of("leftoverId",id.toString(),"version",1,"recipeId",recipe.toString(),"servingsUsed",servings))));result.put("shoppingList",List.of());return result;}
    @Test void canonicalLeftoverSelectionsPreserveVersionsAndAuthoritativeSettingsWithoutDebits(){
        UUID id=leftoversContext();var input=selection();input.put("useLeftovers",true);input.put("meals",List.of(Map.of("dayIndex",0,"recipeId",recipe.toString(),"leftoverId",id.toString(),"leftoverVersion",1)));
        when(worker.post(eq("/ai/meal-plan/recalculate"),anyMap())).thenAnswer(c->{Map<String,Object> body=c.getArgument(1);assertEquals(id.toString(),((Map<?,?>)((List<?>)body.get("meals")).getFirst()).get("leftoverId"));return reusedPlan(id,2);});
        var result=service.recalculate(input,jwt);assertEquals(true,((Map<?,?>)result.get("settings")).get("useLeftovers"));assertEquals(0,((List<?>)result.get("shoppingList")).size());verify(repository,never()).save(any(),any(),anyInt(),anyMap());
    }
    @Test void unavailableLeftoverQuantityOrUnrequestedReuseCannotBeSaved(){
        UUID id=leftoversContext();var input=selection();input.put("useLeftovers",true);input.put("meals",List.of(Map.of("dayIndex",0,"recipeId",recipe.toString(),"leftoverId",id.toString(),"leftoverVersion",1)));when(worker.post(anyString(),anyMap())).thenReturn(reusedPlan(id,3));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,assertThrows(ResponseStatusException.class,()->service.recalculate(input,jwt)).getStatusCode());input.put("useLeftovers",false);assertEquals(HttpStatus.BAD_REQUEST,assertThrows(ResponseStatusException.class,()->service.recalculate(input,jwt)).getStatusCode());verify(repository,never()).save(any(),any(),anyInt(),anyMap());
    }
    private final UUID owner = UUID.randomUUID();
    private final UUID other = UUID.randomUUID();
    private final UUID recipe = UUID.randomUUID();
    private final UUID disliked = UUID.randomUUID();
    private final LocalDate week = LocalDate.of(2026, 10, 12);
    private LocalAIService worker;
    private MealPlanRepository repository;
    private MealPlanService service;
    private Jwt jwt;

    @BeforeEach void setup() {
        worker = mock(LocalAIService.class);
        repository = mock(MealPlanRepository.class);
        service = new MealPlanService(worker, repository, new ObjectMapper());
        jwt = Jwt.withTokenValue("test-session").header("alg", "HS256").subject(owner.toString()).build();
        when(repository.preferences(owner)).thenReturn(Map.of("dietaryPreferences", List.of("Vegetarian"), "allergies", List.of("peanut"),
                "favoriteRecipeIds", List.of(recipe.toString()), "dislikedRecipeIds", List.of(disliked.toString()), "usedProfile", true));
        when(repository.publicRecipeIds(anySet())).thenAnswer(invocation -> invocation.getArgument(0));
    }

    private Map<String, Object> request() {
        return new LinkedHashMap<>(Map.of("weekStart", week.toString(), "servings", 2, "maxCookTime", 45, "prompt", "without egg",
                "dietaryPreferences", List.of(), "excludedIngredients", List.of(), "useProfile", true));
    }

    private Map<String, Object> intent() {
        return Map.of("allergies", List.of("egg"), "_parsed", Map.of("allergies", List.of("egg")), "_signature", "signed-by-local-worker");
    }

    private Map<String, Object> selection() {
        Map<String, Object> input = request();
        input.put("intent", intent());
        input.put("meals", List.of(Map.of("dayIndex", 0, "recipeId", recipe.toString())));
        input.put("checkedItems", List.of("tomato|g", "nonexistent-item"));
        input.put("version", 0);
        return input;
    }

    private Map<String, Object> plan() {
        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("weekStart", week.toString());
        plan.put("servings", 2);
        Map<String, Object> settings = request();
        settings.remove("weekStart"); settings.remove("servings");
        plan.put("settings", settings);
        plan.put("intent", intent());
        plan.put("meals", List.of(Map.of("dayIndex", 0, "date", week.toString(), "recipe", Map.of("id", recipe.toString(), "title", "Canonical tomato dinner"))));
        plan.put("alternatives", List.of());
        plan.put("shoppingList", List.of(Map.of("key", "tomato|g", "name", "tomato", "quantityText", "200 g")));
        plan.put("checkedItems", List.of("tomato|g", "nonexistent-item"));
        plan.put("local", true);
        return plan;
    }

    @Test void suppliedIdentityOrProfileCannotOverrideCurrentJwtContext() {
        Map<String, Object> input = request();
        input.put("userId", other.toString());
        input.put("profile", Map.of("allergies", List.of(), "favoriteRecipeIds", List.of(other.toString())));
        when(worker.post(eq("/ai/meal-plan/generate"), anyMap())).thenReturn(plan());
        service.generate(input, jwt);
        ArgumentCaptor<Map<String, Object>> capture = ArgumentCaptor.forClass(Map.class);
        verify(worker).post(eq("/ai/meal-plan/generate"), capture.capture());
        assertFalse(capture.getValue().containsKey("userId"));
        assertEquals(List.of("peanut"), ((Map<?, ?>) capture.getValue().get("profile")).get("allergies"));
        verify(repository,times(2)).preferences(owner);
        verify(repository, never()).preferences(other);
    }

    @Test void guestGenerationCannotLoadAnAccountProfile() {
        when(worker.post(eq("/ai/meal-plan/generate"), anyMap())).thenReturn(plan());
        service.generate(request(), null);
        ArgumentCaptor<Map<String, Object>> capture = ArgumentCaptor.forClass(Map.class);
        verify(worker).post(eq("/ai/meal-plan/generate"), capture.capture());
        assertEquals(false, ((Map<?, ?>) capture.getValue().get("profile")).get("usedProfile"));
        verify(repository, never()).preferences(any());
    }

    @Test void profileOptOutStillExcludesCurrentAccountDislikes() {
        Map<String, Object> input = request(); input.put("useProfile", false);
        when(worker.post(eq("/ai/meal-plan/generate"), anyMap())).thenReturn(plan());
        service.generate(input, jwt);
        ArgumentCaptor<Map<String, Object>> capture = ArgumentCaptor.forClass(Map.class);
        verify(worker).post(eq("/ai/meal-plan/generate"), capture.capture());
        Map<?, ?> context = (Map<?, ?>) capture.getValue().get("profile");
        assertEquals(List.of(), context.get("allergies"));
        assertEquals(List.of(), context.get("favoriteRecipeIds"));
        assertEquals(List.of(disliked.toString()), context.get("dislikedRecipeIds"));
    }

    @Test void invalidSettingsOrMealSelectionsNeverReachWorker() {
        List<Map<String, Object>> invalid = new ArrayList<>();
        for (Map.Entry<String, Object> field : Map.<String, Object>of("weekStart", "2026-02-30", "servings", 2.5, "maxCookTime", 4, "useProfile", "true", "prompt", "x".repeat(2001)).entrySet()) {
            Map<String, Object> input = request(); input.put(field.getKey(), field.getValue()); invalid.add(input);
        }
        for (Map<String, Object> input : invalid) assertEquals(HttpStatus.BAD_REQUEST,
                assertThrows(ResponseStatusException.class, () -> service.generate(input, jwt)).getStatusCode());
        Map<String, Object> duplicate = selection();
        duplicate.put("meals", List.of(Map.of("dayIndex", 0, "recipeId", recipe.toString()), Map.of("dayIndex", 1, "recipeId", recipe.toString())));
        assertThrows(ResponseStatusException.class, () -> service.recalculate(duplicate, jwt));
        duplicate.put("meals", List.of(Map.of("dayIndex", 7, "recipeId", recipe.toString())));
        assertThrows(ResponseStatusException.class, () -> service.recalculate(duplicate, jwt));
        verifyNoInteractions(worker);
    }

    @Test void savesCanonicalDataAndSignedIntentNotCallerSnapshots() {
        Map<String, Object> input = selection();
        input.put("userId", other.toString());
        input.put("shoppingList", List.of(Map.of("key", "injected-item", "quantityText", "fake")));
        input.put("recipe", Map.of("title", "Injected title", "sourceUrl", "private-source"));
        when(repository.find(owner, week)).thenReturn(Optional.empty());
        when(worker.post(eq("/ai/meal-plan/recalculate"), anyMap())).thenReturn(plan());
        when(repository.save(eq(owner), eq(week), eq(0), anyMap())).thenAnswer(invocation ->
                new SavedPlan(UUID.randomUUID(), owner, week, 1, Instant.now(), invocation.getArgument(3)));
        Map<String, Object> result = service.save(input, jwt);
        assertEquals(1, result.get("version"));
        assertEquals(List.of("tomato|g"), result.get("checkedItems"));
        assertEquals("Canonical tomato dinner", ((Map<?, ?>) ((Map<?, ?>) ((List<?>) result.get("meals")).get(0)).get("recipe")).get("title"));
        ArgumentCaptor<Map<String, Object>> capture = ArgumentCaptor.forClass(Map.class);
        verify(worker).post(eq("/ai/meal-plan/recalculate"), capture.capture());
        assertEquals(intent(), capture.getValue().get("intent"));
        assertEquals("without egg", capture.getValue().get("prompt"));
        assertFalse(capture.getValue().containsKey("shoppingList"));
        assertFalse(capture.getValue().containsKey("recipe"));
        verify(repository, never()).save(eq(other), any(), anyInt(), any());
    }

    @Test void staleAndNewVersionCannotOverwriteExistingWeek() {
        when(repository.find(owner, week)).thenReturn(Optional.of(new SavedPlan(UUID.randomUUID(), owner, week, 3, Instant.now(), plan())));
        Map<String, Object> input = selection(); input.put("version", 2);
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class, () -> service.save(input, jwt)).getStatusCode());
        input.put("version", 0);
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class, () -> service.save(input, jwt)).getStatusCode());
        verifyNoInteractions(worker);
        verify(repository, never()).save(any(), any(), anyInt(), any());
    }

    @Test void finalCompareAndSetConflictIsNotReturnedAsSuccessfulSave() {
        when(repository.find(owner, week)).thenReturn(Optional.empty());
        when(worker.post(eq("/ai/meal-plan/recalculate"), anyMap())).thenReturn(plan());
        when(repository.save(eq(owner), eq(week), eq(0), anyMap())).thenThrow(MealPlanRepository.conflict());
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class, () -> service.save(selection(), jwt)).getStatusCode());
    }

    @Test void loadRevalidatesSavedIdsRatherThanReturningStoredRecipeSnapshot() {
        Map<String, Object> stored = plan();
        stored.put("meals", List.of(Map.of("dayIndex", 0, "recipe", Map.of("id", recipe.toString(), "title", "Stale/private title"))));
        UUID planId = UUID.randomUUID();
        when(repository.find(owner, week)).thenReturn(Optional.of(new SavedPlan(planId, owner, week, 4, Instant.now(), stored)));
        when(worker.post(eq("/ai/meal-plan/recalculate"), anyMap())).thenReturn(plan());
        Map<?, ?> refreshed = (Map<?, ?>) service.load(week.toString(), jwt).get("plan");
        assertEquals(planId.toString(), refreshed.get("id"));
        assertEquals(4, refreshed.get("version"));
        assertEquals("Canonical tomato dinner", ((Map<?, ?>) ((Map<?, ?>) ((List<?>) refreshed.get("meals")).get(0)).get("recipe")).get("title"));
        verify(repository,times(2)).find(owner, week);
        verify(repository, never()).find(eq(other), any());
    }

    @Test void privateOrDislikedCanonicalRecipesCannotBeSaved() {
        when(repository.find(owner, week)).thenReturn(Optional.empty());
        when(worker.post(eq("/ai/meal-plan/recalculate"), anyMap())).thenReturn(plan());
        when(repository.publicRecipeIds(anySet())).thenReturn(Set.of());
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, assertThrows(ResponseStatusException.class, () -> service.save(selection(), jwt)).getStatusCode());
        verify(repository, never()).save(any(), any(), anyInt(), any());
    }

    @Test void invalidOwnedWeekReturnsOnlyReplacementMetadataAndPreservesSaveCompareAndSet() {
        UUID planId = UUID.randomUUID();
        Map<String,Object> stored = plan();
        stored.put("privateNote", "do not return an obsolete snapshot");
        SavedPlan record = new SavedPlan(planId, owner, week, 4, Instant.now(), stored);
        when(repository.find(owner, week)).thenReturn(Optional.of(record));
        when(worker.post(eq("/ai/meal-plan/recalculate"), anyMap())).thenThrow(
                new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Private recipe details must not be echoed"));

        Map<String,Object> loaded = service.load(week.toString(), jwt);
        assertEquals(Set.of("plan", "invalidSavedPlan"), loaded.keySet());
        assertNull(loaded.get("plan"));
        Map<?,?> metadata = (Map<?,?>)loaded.get("invalidSavedPlan");
        assertEquals(Set.of("id", "version", "weekStart", "invalid", "message"), metadata.keySet());
        assertEquals(planId.toString(), metadata.get("id"));
        assertEquals(4, metadata.get("version"));
        assertEquals(week.toString(), metadata.get("weekStart"));
        assertEquals(true, metadata.get("invalid"));
        assertEquals("This saved plan no longer meets current recipe or preference requirements. Generate a new plan to replace it.", metadata.get("message"));

        // A freshly generated, valid replacement uses that version; the old invalid selection is not saved.
        Map<String,Object> replacement = selection();
        replacement.put("version", metadata.get("version"));
        doReturn(plan()).when(worker).post(eq("/ai/meal-plan/recalculate"), anyMap());
        when(repository.save(eq(owner), eq(week), eq(4), anyMap())).thenAnswer(invocation ->
                new SavedPlan(planId, owner, week, 5, Instant.now(), invocation.getArgument(3)));
        assertEquals(5, service.save(replacement, jwt).get("version"));
        verify(repository).save(eq(owner), eq(week), eq(4), argThat(savedPlan -> !savedPlan.containsKey("privateNote")));
        replacement.put("version", 0);
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class, () -> service.save(replacement, jwt)).getStatusCode());
    }

    @Test void invalidWeekMetadataCannotBeLoadedByAnotherAccount() {
        when(repository.find(owner, week)).thenReturn(Optional.of(new SavedPlan(UUID.randomUUID(), owner, week, 4, Instant.now(), plan())));
        when(repository.find(other, week)).thenReturn(Optional.empty());
        Jwt foreign = Jwt.withTokenValue("other-session").header("alg", "HS256").subject(other.toString()).build();
        Map<String,Object> response = service.load(week.toString(), foreign);
        assertEquals(Set.of("plan"), response.keySet());
        assertNull(response.get("plan"));
        verify(repository, never()).find(owner, week);
        verifyNoInteractions(worker);
    }

    @Test void invalidSavedSettingsAreRecoverableButWorkerOutagesAreNotReportedAsInvalidPlans() {
        UUID planId = UUID.randomUUID();
        Map<String,Object> malformed = plan(); malformed.put("settings", Map.of("maxCookTime", 4));
        when(repository.find(owner, week)).thenReturn(Optional.of(new SavedPlan(planId, owner, week, 4, Instant.now(), malformed)));
        assertNull(service.load(week.toString(), jwt).get("plan"));
        verifyNoInteractions(worker);

        when(repository.find(owner, week)).thenReturn(Optional.of(new SavedPlan(planId, owner, week, 4, Instant.now(), plan())));
        for (HttpStatus status : List.of(HttpStatus.BAD_GATEWAY, HttpStatus.SERVICE_UNAVAILABLE, HttpStatus.TOO_MANY_REQUESTS, HttpStatus.FORBIDDEN)) {
            doThrow(new ResponseStatusException(status, "Temporary planner failure")).when(worker).post(eq("/ai/meal-plan/recalculate"), anyMap());
            assertEquals(status, assertThrows(ResponseStatusException.class, () -> service.load(week.toString(), jwt)).getStatusCode());
        }
    }

    @Test void missingWeekReturnsExplicitNullAndProtectedOperationsRejectGuests() {
        when(repository.find(owner, week)).thenReturn(Optional.empty());
        assertTrue(service.load(week.toString(), jwt).containsKey("plan"));
        assertNull(service.load(week.toString(), jwt).get("plan"));
        assertEquals(HttpStatus.UNAUTHORIZED, assertThrows(ResponseStatusException.class, () -> service.save(selection(), null)).getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED, assertThrows(ResponseStatusException.class, () -> service.load(week.toString(), null)).getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED, assertThrows(ResponseStatusException.class, () -> service.preferences(null)).getStatusCode());
        verifyNoInteractions(worker);
    }

    @Test void whatIfPreviewPreservesSignedConditionsAndAuthoritativeIdentityWithoutSaving() {
        Map<String,Object> input = selection();
        Map<String,Object> signed = new LinkedHashMap<>(intent());
        signed.put("_requirements", Map.of("mustUseIngredients", List.of("rice"), "mustUseScope", "perMeal"));
        signed.put("_pricing", Map.of("version", 1, "quotes", List.of(), "usedQuoteIds", List.of()));
        input.put("intent", signed);
        input.put("maxCookTime", 15);
        input.put("profile", Map.of("allergies", List.of()));
        Map<String,Object> replacement = plan();
        UUID changed = UUID.randomUUID();
        replacement.put("meals", List.of(Map.of("dayIndex", 0, "date", week.toString(), "recipe", Map.of("id", changed.toString()))));
        when(worker.post(eq("/ai/meal-plan/what-if"), anyMap())).thenReturn(replacement);
        Map<String,Object> result = service.whatIf(input, jwt);
        assertEquals(changed.toString(), ((Map<?,?>)((Map<?,?>)((List<?>)result.get("meals")).getFirst()).get("recipe")).get("id"));
        ArgumentCaptor<Map<String,Object>> capture = ArgumentCaptor.forClass(Map.class);
        verify(worker).post(eq("/ai/meal-plan/what-if"), capture.capture());
        assertEquals(signed, capture.getValue().get("intent"));
        assertEquals(15, capture.getValue().get("maxCookTime"));
        assertEquals(List.of("peanut"), ((Map<?,?>)capture.getValue().get("profile")).get("allergies"));
        verify(repository, never()).save(any(), any(), anyInt(), any());
        verify(repository, never()).find(any(), any());
    }

    @Test void priceRefreshRequiresAuthenticationAndKeepsExactSelectedMealsAndSignedPins() {
        Map<String,Object> input = selection();
        assertEquals(HttpStatus.UNAUTHORIZED, assertThrows(ResponseStatusException.class, () -> service.refreshPrices(input, null)).getStatusCode());
        when(worker.post(eq("/ai/meal-plan/refresh-prices"), anyMap())).thenReturn(plan());
        service.refreshPrices(input, jwt);
        verify(worker).post(eq("/ai/meal-plan/refresh-prices"), argThat(body -> intent().equals(body.get("intent"))));
        Map<String,Object> changed = plan();
        changed.put("meals", List.of(Map.of("dayIndex",0,"date",week.toString(),"recipe",Map.of("id",UUID.randomUUID().toString()))));
        when(worker.post(eq("/ai/meal-plan/refresh-prices"), anyMap())).thenReturn(changed);
        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException.class, () -> service.refreshPrices(input, jwt)).getStatusCode());
        verify(repository, never()).save(any(), any(), anyInt(), any());
    }

    @Test void priceRefreshCannotBeEnabledByAnUnsignedFlagOnRecalculate() {
        Map<String,Object> input = selection();
        input.put("refreshPrices", true);
        when(worker.post(eq("/ai/meal-plan/recalculate"), anyMap())).thenReturn(plan());
        service.recalculate(input, jwt);
        verify(worker).post(eq("/ai/meal-plan/recalculate"), argThat(body -> !body.containsKey("refreshPrices")));
        verify(worker, never()).post(eq("/ai/meal-plan/refresh-prices"), anyMap());
    }
}
