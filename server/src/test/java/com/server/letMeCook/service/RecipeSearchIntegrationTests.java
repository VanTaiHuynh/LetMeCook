package com.server.letMeCook.service;

import com.server.letMeCook.dto.recipe.RecipeCardDTO;
import com.server.letMeCook.mapper.RecipeMapper;
import java.util.Set;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.jdbc.Sql;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

@DataJpaTest(properties = {"spring.jpa.hibernate.ddl-auto=none",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.show-sql=false"})
@Import({RecipeService.class, RecipeMapper.class})
@Sql("/search-test-schema.sql")
class RecipeSearchIntegrationTests {
    @Autowired jakarta.persistence.EntityManager entityManager;
    @Test void scalarSearchCountMatchesCombinedRelationsAcrossPagesWithoutGroupedRows(){
        UUID one=insertRecipe("combined one",true,null,"rice","lentil"),two=insertRecipe("combined two",true,null,"rice","lentil"),bad=insertRecipe("combined missing",true,null,"rice");
        for(UUID id:List.of(one,two,bad)){dietaryTags(id,"Vegetarian","Dairy free");UUID category=UUID.randomUUID(),cuisine=UUID.randomUUID();jdbc.update("INSERT INTO categories VALUES(?,'Dinner')",category);jdbc.update("INSERT INTO cuisines VALUES(?,'Asian')",cuisine);jdbc.update("INSERT INTO recipe_categories VALUES(?,?)",id,category);jdbc.update("INSERT INTO recipe_cuisines VALUES(?,?)",id,cuisine);jdbc.update("UPDATE recipe SET rating_average=4.5 WHERE id=?",id);}
        Set<UUID> found=new java.util.HashSet<>();for(int page=0;page<2;page++){var result=recipes.advancedSearch("combined",Set.of("Asian"),Set.of("rice","lentil"),Set.of("peanut"),Set.of("Dinner"),Set.of("Vegetarian","Dairy free"),true,4.0,null,PageRequest.of(page,1));assertEquals(2,result.getTotalElements());assertEquals(1,result.getContent().size());found.add(result.getContent().getFirst().getId());}assertEquals(Set.of(one,two),found);
    }
    @Test void fullDtoPageHydratesRelationsInBatchesInsteadOfPerRecipe(){
        for(int i=0;i<24;i++){UUID id=insertRecipe("batched "+i,true,null,"rice "+i,"bean "+i);dietaryTags(id,"Vegetarian");UUID category=UUID.randomUUID(),cuisine=UUID.randomUUID();jdbc.update("INSERT INTO categories VALUES(?,'Dinner')",category);jdbc.update("INSERT INTO cuisines VALUES(?,'Asian')",cuisine);jdbc.update("INSERT INTO recipe_categories VALUES(?,?)",id,category);jdbc.update("INSERT INTO recipe_cuisines VALUES(?,?)",id,cuisine);}
        var stats=entityManager.getEntityManagerFactory().unwrap(org.hibernate.SessionFactory.class).getStatistics();stats.setStatisticsEnabled(true);stats.clear();
        var page=recipes.getAllRecipeDTOs(PageRequest.of(0,24));assertEquals(24,page.getTotalElements());assertTrue(page.getContent().stream().allMatch(r->r.getIngredients().size()==2&&r.getCategories().size()==1&&r.getCuisines().size()==1));assertTrue(stats.getPrepareStatementCount()<=10,"Expected bounded batch reads, got "+stats.getPrepareStatementCount());stats.setStatisticsEnabled(false);
    }
    @Test void recommendationSeedsAreSqlBoundedAfterVisibilityAndNegativeFeedback(){
        UUID user=userWithAllergies();for(int i=0;i<40;i++){UUID id=insertRecipe("seed "+i,true,null,"rice");jdbc.update("INSERT INTO recipe_favourites VALUES(?,?,?,?)",UUID.randomUUID(),user,id,java.sql.Timestamp.from(java.time.Instant.ofEpochSecond(i)));jdbc.update("INSERT INTO recipe_browsing_history VALUES(?,?,?,?)",UUID.randomUUID(),user,id,java.sql.Timestamp.from(java.time.Instant.ofEpochSecond(i)));if(i>=30)jdbc.update("INSERT INTO recipe_disliked VALUES(?,?,?)",UUID.randomUUID(),user,id);}
        when(recommendationService.recommendForUser(anyList(),anyList(),anyList(),anySet(),anyCollection(),eq(100))).thenAnswer(c->{assertEquals(5,c.<List<?>>getArgument(0).size());assertEquals(5,c.<List<?>>getArgument(1).size());for(Object id:c.<List<?>>getArgument(0))assertTrue(jdbc.queryForObject("SELECT title FROM recipe WHERE id=?",String.class,id).matches("seed 2[5-9]"));return List.of();});
        recipes.recommendedByUserId(user);verify(recommendationService).recommendForUser(anyList(),anyList(),anyList(),anySet(),anyCollection(),eq(100));
    }
    @Autowired RecipeService recipes;
    @Autowired JdbcTemplate jdbc;
    @Autowired com.server.letMeCook.repository.RecipeBrowsingHistoryRepository history;
    @MockitoBean RecommendationService recommendationService;
    @MockitoBean PlatformService platformService;
    @MockitoBean org.springframework.web.client.RestTemplate restTemplate;

    private UUID insertRecipe(String title, boolean isPublic, UUID author, String... ingredients) {
        UUID recipe = UUID.randomUUID();
        jdbc.update("INSERT INTO recipe(id,title,description,is_public,author_id) VALUES(?,?,?, ?,?)",
                recipe, title, "", isPublic, author);
        for (String name : ingredients) {
            UUID ingredient = UUID.randomUUID();
            jdbc.update("INSERT INTO ingredients(id,name) VALUES(?,?)", ingredient, name);
            jdbc.update("INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit) VALUES(?,?,?,?,?)",
                    UUID.randomUUID(), recipe, ingredient, "1", "piece");
        }
        return recipe;
    }

    private Page<RecipeCardDTO> search(Set<String> terms) {
        return recipes.advancedSearch(null, null, terms, null, null, null, true, PageRequest.of(0, 1));
    }

    private void dietaryTags(UUID recipeId, String... names) {
        for (String name : names) {
            UUID preference = UUID.randomUUID();
            jdbc.update("INSERT INTO dietary_pref(id,name) VALUES(?,?)", preference, name);
            jdbc.update("INSERT INTO recipe_dietary_pref(recipe_id,preference_id) VALUES(?,?)", recipeId, preference);
        }
    }

    private UUID userWithAllergies(String... names) {
        UUID user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id) VALUES(?)", user);
        for (String name : names) {
            UUID ingredient = UUID.randomUUID();
            jdbc.update("INSERT INTO ingredients(id,name) VALUES(?,?)", ingredient, name);
            jdbc.update("INSERT INTO user_allergy(user_id,ingredient_id) VALUES(?,?)", user, ingredient);
        }
        return user;
    }

    @Test
    void quickCatalogExcludesUnknownTimeSlowPrivateAndUnapprovedDemoRecords() {
        UUID quick = insertRecipe("quick dinner", true, null, "rice");
        UUID slow = insertRecipe("slow dinner", true, null, "rice");
        UUID unknown = insertRecipe("unknown dinner", true, null, "rice");
        UUID secret = insertRecipe("private quick", false, null, "rice");
        jdbc.update("UPDATE recipe SET time=15 WHERE id IN (?,?)", quick, secret);
        jdbc.update("UPDATE recipe SET time=90 WHERE id=?", slow);
        var page = recipes.getAllRecipeDTOs(PageRequest.of(0, 20), 30);
        assertEquals(List.of(quick), page.getContent().stream().map(r -> r.getId()).toList());
        assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> recipes.getAllRecipeDTOs(PageRequest.of(0, 20), 0));
        when(platformService.publicDemo()).thenReturn(true);
        assertEquals(0, recipes.getAllRecipeDTOs(PageRequest.of(0, 20), 30).getTotalElements());
        jdbc.update("UPDATE recipe SET demo_permission_confirmed=true,demo_permission_note='fixture declaration',image_kind='source',image_url='/recipe-images/fixture.jpg' WHERE id=?",quick);
        assertEquals(List.of(quick), recipes.getAllRecipeDTOs(PageRequest.of(0,20),30).getContent().stream().map(r -> r.getId()).toList());
    }

    @Test
    void commonAllergenGroupsApplyToLegacySearchCountsAndPersonalizedRefill() {
        insertRecipe("milk recipe", true, null, "whole milk");
        insertRecipe("cheese recipe", true, null, "parmesan");
        UUID safe = insertRecipe("rice recipe", true, null, "rice");
        Page<RecipeCardDTO> dairy = recipes.advancedSearch(null, null, null, Set.of(" DAIRY "), null,
                null, true, PageRequest.of(0, 20));
        assertEquals(1, dairy.getTotalElements());
        assertEquals(safe, dairy.getContent().getFirst().getId());
        assertEquals(List.of(safe), recipes.recommendedByUserId(userWithAllergies("Dairy")).getContent()
                .stream().map(RecipeCardDTO::getId).toList());

        UUID peanut = insertRecipe("peanut recipe", true, null, "roasted peanut");
        UUID walnut = insertRecipe("walnut recipe", true, null, "walnut pieces");
        Page<RecipeCardDTO> treeNut = recipes.advancedSearch(null, null, null, Set.of("tree nut"), null,
                null, true, PageRequest.of(0, 20));
        assertEquals(4, treeNut.getTotalElements());
        Set<UUID> ids = treeNut.getContent().stream().map(RecipeCardDTO::getId).collect(java.util.stream.Collectors.toSet());
        assertTrue(ids.contains(peanut));
        assertFalse(ids.contains(walnut));
    }

    @Test
    void allergenTermsTreatPercentAndUnderscoreLiterallyInSearchAndRecommendations() {
        UUID milk = insertRecipe("ordinary milk", true, null, "milk powder");
        UUID cheese = insertRecipe("ordinary cheese", true, null, "cheese crumbs");
        UUID rice = insertRecipe("rice", true, null, "rice");
        insertRecipe("literal percent", true, null, "%milk powder");
        insertRecipe("literal underscore", true, null, "_cheese crumbs");
        Set<UUID> expected = Set.of(milk, cheese, rice);
        Page<RecipeCardDTO> result = recipes.advancedSearch(null, null, null, Set.of("%milk", "_cheese"),
                null, null, true, PageRequest.of(0, 20));
        assertEquals(3, result.getTotalElements());
        assertEquals(expected, result.getContent().stream().map(RecipeCardDTO::getId)
                .collect(java.util.stream.Collectors.toSet()));
        assertEquals(expected, recipes.recommendedByUserId(userWithAllergies("%milk", "_cheese")).getContent()
                .stream().map(RecipeCardDTO::getId).collect(java.util.stream.Collectors.toSet()));
    }

    @Test
    void personalizedRecommendationsEnforceHardFiltersKeepRankAndRefill() {
        UUID user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,dietary_pref) VALUES(?, ARRAY['Vegetarian','Dairy-Free'])", user);
        UUID allergen = UUID.randomUUID();
        jdbc.update("INSERT INTO ingredients(id,name) VALUES(?,?)", allergen, "peanut");
        jdbc.update("INSERT INTO user_allergy(user_id,ingredient_id) VALUES(?,?)", user, allergen);
        UUID allergyViolation = insertRecipe("peanut variant", true, null, "roasted salted peanut");
        UUID dietViolation = insertRecipe("missing dairy-free tag", true, null, "rice");
        UUID disliked = insertRecipe("disliked", true, null, "rice");
        UUID privateId = insertRecipe("private", false, user, "rice");
        UUID first = insertRecipe("ranked eligible", true, null, "rice");
        UUID refill = insertRecipe("popular eligible refill", true, null, "rice");
        dietaryTags(dietViolation, "Vegetarian");
        for (UUID recipe : List.of(allergyViolation, disliked, privateId, first, refill)) {
            dietaryTags(recipe, "Vegetarian", "Dairy free");
        }
        jdbc.update("INSERT INTO recipe_disliked(id,user_id,recipe_id) VALUES(?,?,?)", UUID.randomUUID(), user, disliked);
        jdbc.update("INSERT INTO recipe_favourites(id,user_id,recipe_id) VALUES(?,?,?)", UUID.randomUUID(), user, dietViolation);
        jdbc.update("UPDATE recipe SET view_count=100 WHERE id=?", refill);
        when(recommendationService.recommendForUser(anyList(), anyList(), anyList(), anySet(), anyCollection(), eq(100)))
                .thenReturn(List.of(allergyViolation, dietViolation, disliked, privateId, first));
        Page<RecipeCardDTO> result = recipes.recommendedByUserId(user);
        assertEquals(List.of(first, refill), result.getContent().stream().map(RecipeCardDTO::getId).toList());
        assertEquals(2, result.getTotalElements());
    }

    @Test
    void unsupportedExplicitDietReturnsEmptyWithoutRelaxingPreferences() {
        UUID user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,dietary_pref) VALUES(?, ARRAY['Kosher'])", user);
        UUID ordinary = insertRecipe("ordinary unverified recipe", true, null, "rice");
        dietaryTags(ordinary, "Vegetarian");
        assertTrue(recipes.recommendedByUserId(user).isEmpty());
        verifyNoInteractions(recommendationService);
    }

    @Test
    void dislikedFavoritesAndHistoryCannotInfluencePersonalizationOrReturnAsCandidates() {
        UUID user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,dietary_pref) VALUES(?, ARRAY['Vegetarian'])", user);
        Set<UUID> disliked = new java.util.HashSet<>();
        for (int index = 0; index < 6; index++) {
            UUID recipe = insertRecipe("disliked former favorite " + index, true, null, "rice");
            dietaryTags(recipe, "Vegetarian");
            disliked.add(recipe);
            jdbc.update("INSERT INTO recipe_disliked(id,user_id,recipe_id) VALUES(?,?,?)", UUID.randomUUID(), user, recipe);
            jdbc.update("INSERT INTO recipe_favourites(id,user_id,recipe_id,created_at) VALUES(?,?,?,CURRENT_TIMESTAMP)", UUID.randomUUID(), user, recipe);
            jdbc.update("INSERT INTO recipe_browsing_history(id,user_id,recipe_id,viewed_at) VALUES(?,?,?,CURRENT_TIMESTAMP)", UUID.randomUUID(), user, recipe);
        }
        UUID favorite = insertRecipe("current favorite", true, null, "rice");
        UUID recent = insertRecipe("current recent recipe", true, null, "rice");
        UUID eligible = insertRecipe("eligible vegetarian dinner", true, null, "rice");
        for (UUID recipe : List.of(favorite, recent, eligible)) dietaryTags(recipe, "Vegetarian");
        jdbc.update("INSERT INTO recipe_favourites(id,user_id,recipe_id,created_at) VALUES(?,?,?,CURRENT_TIMESTAMP)", UUID.randomUUID(), user, favorite);
        jdbc.update("INSERT INTO recipe_browsing_history(id,user_id,recipe_id,viewed_at) VALUES(?,?,?,CURRENT_TIMESTAMP)", UUID.randomUUID(), user, recent);
        Set<UUID> excluded = new java.util.HashSet<>(disliked);
        excluded.addAll(List.of(favorite, recent));
        when(recommendationService.recommendForUser(eq(List.of(favorite)), eq(List.of(recent)),
                eq(List.of(eligible)), eq(excluded), eq(Set.of("vegetarian")), eq(100)))
                .thenReturn(List.of(disliked.iterator().next(), favorite, recent, eligible));

        assertEquals(List.of(eligible), recipes.recommendedByUserId(user).getContent()
                .stream().map(RecipeCardDTO::getId).toList());
        verify(recommendationService).recommendForUser(eq(List.of(favorite)), eq(List.of(recent)),
                eq(List.of(eligible)), eq(excluded), eq(Set.of("vegetarian")), eq(100));
    }

    @Test
    void coldStartSendsFullEligibilityBeyondPopularity100AndKeepsWorkerRank() {
        UUID user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,dietary_pref) VALUES(?, ARRAY['Vegetarian'])", user);
        java.util.Set<UUID> expected = new java.util.HashSet<>();
        for (int index = 0; index < 120; index++) {
            UUID recipe = insertRecipe("popular eligible " + index, true, null, "rice");
            dietaryTags(recipe, "Vegetarian");
            jdbc.update("UPDATE recipe SET view_count=? WHERE id=?", 200 + index, recipe);
            expected.add(recipe);
        }
        UUID lowPopularityWinner = insertRecipe("distinct cold-start candidate", true, null, "rice");
        dietaryTags(lowPopularityWinner, "Vegetarian");
        expected.add(lowPopularityWinner);
        UUID contradiction = insertRecipe("mislabelled high-popularity ham", true, null, "Parma ham");
        dietaryTags(contradiction, "Vegetarian");
        jdbc.update("UPDATE recipe SET view_count=9999 WHERE id=?", contradiction);
        when(recommendationService.recommendForUser(eq(List.of()), eq(List.of()), anyList(), anySet(), eq(Set.of("vegetarian")), eq(100)))
                .thenAnswer(invocation -> {
                    List<UUID> complete = invocation.getArgument(2);
                    assertEquals(expected, new java.util.HashSet<>(complete));
                    assertTrue(complete.indexOf(lowPopularityWinner) >= 100);
                    assertFalse(complete.contains(contradiction));
                    return List.of(lowPopularityWinner);
                });
        var result = recipes.recommendedByUserId(user);
        assertEquals(10, result.getContent().size());
        assertEquals(lowPopularityWinner, result.getContent().getFirst().getId());
        verify(recommendationService).recommendForUser(eq(List.of()), eq(List.of()), anyList(), anySet(), eq(Set.of("vegetarian")), eq(100));
    }

    @Test
    void workerFailureRefillKeepsDemoPermissionAndLiteralAllergyConstraints() {
        UUID user = userWithAllergies("%milk");
        UUID safe = insertRecipe("approved safe", true, null, "rice");
        UUID violation = insertRecipe("literal excluded ingredient", true, null, "%milk powder");
        UUID unapproved = insertRecipe("unapproved ordinary", true, null, "rice");
        UUID privateRecipe = insertRecipe("own private recipe", false, user, "rice");
        for (UUID recipe : List.of(safe, violation)) jdbc.update("UPDATE recipe SET demo_permission_confirmed=true,demo_permission_note='test declaration',image_kind='source',image_url='/recipe-images/test.jpg' WHERE id=?", recipe);
        when(platformService.publicDemo()).thenReturn(true);
        when(recommendationService.recommendForUser(anyList(), anyList(), anyList(), anySet(), anyCollection(), eq(100)))
                .thenAnswer(invocation -> {
                    assertEquals(List.of(safe), invocation.<List<UUID>>getArgument(2));
                    return List.of();
                });
        assertEquals(List.of(safe), recipes.recommendedByUserId(user).getContent().stream().map(RecipeCardDTO::getId).toList());
    }

    @Test
    void vegetarianLabelCannotOverrideHamBeforePaginationCountOrPersonalizedRanking() {
        UUID ham=insertRecipe("A mislabeled bruschetta",true,null,"Parma ham per portion");
        UUID mixed=insertRecipe("A mixed option",true,null,"ham or vegetarian alternative");
        UUID ambiguous=insertRecipe("A mixed qualified line",true,null,"vegan cheese and ham");
        UUID bird=insertRecipe("A bird word-boundary contradiction",true,null,"chicken eggplant curry");
        UUID rice=insertRecipe("B rice dinner",true,null,"rice");
        UUID alternative=insertRecipe("C explicitly meat-free dinner",true,null,"meat-free sausages");
        UUID unlabeled=insertRecipe("D unverified rice",true,null,"rice");
        for(UUID id:List.of(ham,mixed,ambiguous,bird,rice,alternative))dietaryTags(id,"Vegetarian");
        var firstPage=PageRequest.of(0,1,Sort.by("title"));
        var first=recipes.advancedSearch(null,null,null,null,null,Set.of("vegetarian"),true,firstPage);
        assertEquals(2,first.getTotalElements());assertEquals(List.of(rice),first.getContent().stream().map(RecipeCardDTO::getId).toList());
        var second=recipes.advancedSearch(null,null,null,null,null,Set.of("vegetarian"),true,firstPage.next());
        assertEquals(2,second.getTotalElements());assertEquals(List.of(alternative),second.getContent().stream().map(RecipeCardDTO::getId).toList());
        UUID user=UUID.randomUUID();jdbc.update("INSERT INTO users(id,dietary_pref) VALUES(?,ARRAY['Vegetarian'])",user);
        UUID seed=insertRecipe("favorite seed",true,null,"rice");dietaryTags(seed,"Vegetarian");jdbc.update("INSERT INTO recipe_favourites(id,user_id,recipe_id) VALUES(?,?,?)",UUID.randomUUID(),user,seed);
        jdbc.update("UPDATE recipe SET view_count=999 WHERE id IN(?,?,?,?)",ham,mixed,ambiguous,bird);
        when(recommendationService.recommendForUser(anyList(),anyList(),anyList(),anySet(),anyCollection(),eq(100))).thenReturn(List.of(ham,mixed,ambiguous,bird,alternative,rice,unlabeled));
        assertEquals(List.of(alternative,rice),recipes.recommendedByUserId(user).getContent().stream().map(RecipeCardDTO::getId).toList());
    }

    @Test
    void veganSourceTagsRejectKnownDairyEggHoneyAndMixedClausesWithoutRejectingPlantAlternatives() {
        Set<UUID> allowed=new java.util.HashSet<>();
        for(String ingredient:List.of("rice","eggplant","peanut butter","coconut milk","vegan butter","oyster mushrooms")){
            UUID id=insertRecipe("allowed "+ingredient,true,null,ingredient);dietaryTags(id,"Vegan");allowed.add(id);
        }
        for(String ingredient:List.of("whole milk","egg yolks","honey","ghee","whey powder","Parma ham per portion","vegan cheese and ham","vegan cheese & ham","vegan cheese (contains milk)","vegan-ish ham","vegan? chicken","coconut milk with cream","butter or vegan alternative","oyster sauce")){
            UUID id=insertRecipe("contradiction "+ingredient,true,null,ingredient);dietaryTags(id,"Vegan");jdbc.update("UPDATE recipe SET view_count=999 WHERE id=?",id);
        }
        UUID vegetarianOnly=insertRecipe("vegetarian rice without explicit vegan label",true,null,"rice");dietaryTags(vegetarianOnly,"Vegetarian");
        Page<RecipeCardDTO> result=recipes.advancedSearch(null,null,null,null,null,Set.of("vegan"),true,PageRequest.of(0,20));
        assertEquals(allowed.size(),result.getTotalElements());assertEquals(allowed,result.getContent().stream().map(RecipeCardDTO::getId).collect(java.util.stream.Collectors.toSet()));
        UUID user=UUID.randomUUID();jdbc.update("INSERT INTO users(id,dietary_pref) VALUES(?,ARRAY['Vegan'])",user);
        assertEquals(allowed,recipes.recommendedByUserId(user).getContent().stream().map(RecipeCardDTO::getId).collect(java.util.stream.Collectors.toSet()));
    }

    @Test
    void twoChickenNamesCannotSatisfyChickenAndSalmonAndCountMatchesData() {
        insertRecipe("false positive", true, null, "chicken breast", "chicken thigh");
        UUID match = insertRecipe("actual match", true, null, "chicken breast", "salmon fillet");
        Page<RecipeCardDTO> result = search(Set.of(" chicken ", "SALMON"));
        assertEquals(1, result.getTotalElements());
        assertEquals(match, result.getContent().getFirst().getId());
    }

    @Test
    void overlappingRequestedTermsCanMatchTheSameActualIngredient() {
        UUID match = insertRecipe("onions", true, null, "red onion");
        Page<RecipeCardDTO> result = search(Set.of("onion", "red onion", " ONION "));
        assertEquals(1, result.getTotalElements());
        assertEquals(match, result.getContent().getFirst().getId());
    }

    @Test
    void ingredientTermsTreatSqlWildcardCharactersLiterally() {
        insertRecipe("ordinary salmon", true, null, "salmon");
        UUID match = insertRecipe("literal percent", true, null, "%salmon seasoning");
        Page<RecipeCardDTO> result = search(Set.of("%salmon"));
        assertEquals(1, result.getTotalElements());
        assertEquals(match, result.getContent().getFirst().getId());
    }

    @Test
    void privateSearchAndItsCountAreScopedToTheVerifiedOwner() {
        UUID owner = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id) VALUES(?)", owner);
        jdbc.update("INSERT INTO users(id) VALUES(?)", other);
        UUID owned = insertRecipe("owned", false, owner, "rice");
        insertRecipe("other user's private recipe", false, other, "rice");
        UUID publicId = insertRecipe("public", true, null, "rice");
        Page<RecipeCardDTO> result = recipes.advancedSearch(null, null, Set.of("rice"), null, null,
                null, false, owner, PageRequest.of(0, 1));
        assertEquals(1, result.getTotalElements());
        assertEquals(owned, result.getContent().getFirst().getId());
        Page<RecipeCardDTO> publicResult = search(Set.of("rice"));
        assertEquals(1, publicResult.getTotalElements());
        assertEquals(publicId, publicResult.getContent().getFirst().getId());
    }

    @Test
    void overallRatingThresholdAndSortAgreeWithCountAndStrictIngredientDietFilters() {
        UUID high = insertRecipe("high rated", true, null, "chicken", "salmon");
        UUID lower = insertRecipe("lower rated", true, null, "chicken", "salmon");
        UUID low = insertRecipe("below threshold", true, null, "chicken", "salmon");
        UUID wrongIngredient = insertRecipe("missing salmon", true, null, "chicken breast", "chicken thigh");
        UUID wrongDiet = insertRecipe("missing source diet", true, null, "chicken", "salmon");
        for (UUID id : List.of(high, lower, low, wrongIngredient)) dietaryTags(id, "Gluten free");
        jdbc.update("UPDATE recipe SET rating_average=5,rating_count=2 WHERE id IN (?,?,?)", high, wrongIngredient, wrongDiet);
        jdbc.update("UPDATE recipe SET rating_average=4,rating_count=1 WHERE id=?", lower);
        jdbc.update("UPDATE recipe SET rating_average=3,rating_count=1 WHERE id=?", low);
        PageRequest firstPage = PageRequest.of(0, 1, Sort.by(Sort.Direction.DESC, "ratingAverage"));
        Page<RecipeCardDTO> first = recipes.advancedSearch(null, null, Set.of("chicken", "salmon"), null,
                null, Set.of("gluten free"), true, 4.0, null, firstPage);
        assertEquals(2, first.getTotalElements());
        assertEquals(2, first.getTotalPages());
        assertEquals(high, first.getContent().getFirst().getId());
        assertEquals(5, first.getContent().getFirst().getRatingAverage());
        assertEquals(2, first.getContent().getFirst().getRatingCount());
        Page<RecipeCardDTO> second = recipes.advancedSearch(null, null, Set.of("chicken", "salmon"), null,
                null, Set.of("gluten free"), true, 4.0, null, firstPage.next());
        assertEquals(2, second.getTotalElements());
        assertEquals(lower, second.getContent().getFirst().getId());
        for (Double invalid : List.of(0.0, 5.1, Double.NaN, Double.POSITIVE_INFINITY)) {
            assertEquals(400, assertThrows(org.springframework.web.server.ResponseStatusException.class,
                    () -> recipes.advancedSearch(null, null, null, null, null, null, true, invalid, null, firstPage))
                    .getStatusCode().value());
        }
    }

    @Test
    void legacyAllCapsSqlBeforeRelationsAndDemoFilteringKeepsDeterministicVisibleIds() {
        UUID ingredient=UUID.randomUUID();jdbc.update("INSERT INTO ingredients(id,name) VALUES(?,'rice')",ingredient);
        java.util.ArrayList<UUID> ordinary=new java.util.ArrayList<>(),approved=new java.util.ArrayList<>();
        // Hidden records sort first, exposing implementations that limit first and filter afterwards.
        for(int index=1;index<=5;index++)jdbc.update("INSERT INTO recipe(id,title,description,is_public) VALUES(?,'Private','',false)",new UUID(0,index));
        for(int index=10;index<15;index++){
            UUID id=new UUID(0,index);ordinary.add(id);
            jdbc.update("INSERT INTO recipe(id,title,description,is_public) VALUES(?,'Pending','',true)",id);
        }
        for(int index=100;index<205;index++){
            UUID id=new UUID(0,index);ordinary.add(id);approved.add(id);
            jdbc.update("INSERT INTO recipe(id,title,description,is_public,demo_permission_confirmed,demo_permission_note,image_kind,image_url) VALUES(?,'Approved','',true,true,'Synthetic test declaration','source','/recipe-images/test.jpg')",id);
            jdbc.update("INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,quantity,unit) VALUES(?,?,?,'1','cup')",UUID.randomUUID(),id,ingredient);
        }
        var normal=recipes.getAllRecipesWithFullRelations();
        assertEquals(100,normal.size());assertEquals(ordinary.subList(0,100),normal.stream().map(com.server.letMeCook.dto.recipe.RecipeDTO::getId).toList());
        when(platformService.publicDemo()).thenReturn(true);
        var demo=recipes.getAllRecipesWithFullRelations();
        assertEquals(100,demo.size());assertEquals(approved.subList(0,100),demo.stream().map(com.server.letMeCook.dto.recipe.RecipeDTO::getId).toList());
        assertTrue(demo.stream().allMatch(recipe->recipe.getIngredients().size()==1&&"rice".equals(recipe.getIngredients().getFirst().getIngredientName())));
        assertEquals(demo.stream().map(com.server.letMeCook.dto.recipe.RecipeDTO::getId).toList(),recipes.getAllRecipesWithFullRelations().stream().map(com.server.letMeCook.dto.recipe.RecipeDTO::getId).toList());
    }

    @Test
    void demoModeRequiresPermissionNoteAndSourceLocalPhotoButKeepsOwnPrivateDrafts() {
        UUID owner = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id) VALUES(?)", owner);
        UUID approved = insertRecipe("approved", true, null, "rice");
        UUID unapproved = insertRecipe("unapproved", true, null, "rice");
        UUID emptyNote = insertRecipe("empty note", true, null, "rice");
        UUID remote = insertRecipe("remote photo", true, null, "rice");
        UUID illustrative = insertRecipe("illustrative photo", true, null, "rice");
        UUID draft = insertRecipe("own private draft", false, owner, "rice");
        for (UUID id : List.of(approved, emptyNote, remote, illustrative)) {
            jdbc.update("UPDATE recipe SET demo_permission_confirmed=true,demo_permission_note='Author declaration',image_kind='source',image_url='/recipe-images/original.jpg' WHERE id=?", id);
        }
        jdbc.update("UPDATE recipe SET demo_permission_note='  ' WHERE id=?", emptyNote);
        jdbc.update("UPDATE recipe SET image_url='https://example.invalid/photo.jpg' WHERE id=?", remote);
        jdbc.update("UPDATE recipe SET image_kind='illustrative' WHERE id=?", illustrative);
        assertEquals(5, search(Set.of("rice")).getTotalElements());
        when(platformService.publicDemo()).thenReturn(true);
        Page<RecipeCardDTO> visible = search(Set.of("rice"));
        assertEquals(1, visible.getTotalElements());
        assertEquals(approved, visible.getContent().getFirst().getId());
        assertTrue(recipes.getRecipeById(approved).isPresent());
        assertTrue(recipes.getRecipeById(unapproved).isEmpty());
        assertTrue(recipes.getRecipeById(draft).isEmpty());
        assertTrue(recipes.getRecipeById(draft, owner).isPresent());
        assertTrue(recipes.getRecipeById(draft, UUID.randomUUID()).isEmpty());
        assertEquals(1, recipes.getAllRecipeDTOs(PageRequest.of(0, 10)).getTotalElements());
        assertEquals(List.of(approved), recipes.recommendedByUserId(owner).getContent().stream().map(RecipeCardDTO::getId).toList());
        for (UUID id : List.of(approved, unapproved, draft)) {
            jdbc.update("INSERT INTO recipe_browsing_history(id,user_id,recipe_id,viewed_at) VALUES(?,?,?,CURRENT_TIMESTAMP)", UUID.randomUUID(), owner, id);
        }
        var recent = history.findVisibleByUserId(owner, true, PageRequest.of(0, 10));
        assertEquals(2, recent.getTotalElements());
        assertEquals(Set.of(approved, draft), recent.getContent().stream().map(row -> row.getRecipe().getId()).collect(java.util.stream.Collectors.toSet()));
    }
}
