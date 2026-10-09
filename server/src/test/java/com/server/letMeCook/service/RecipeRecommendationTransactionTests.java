package com.server.letMeCook.service;

import com.server.letMeCook.dto.recipe.RecipeCardDTO;
import com.server.letMeCook.mapper.RecipeMapper;
import java.util.List;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@DataJpaTest(properties = {"spring.jpa.hibernate.ddl-auto=none",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.show-sql=false"})
@Import({RecipeService.class, RecipeMapper.class, InferenceTransactions.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@Sql("/search-test-schema.sql")
class RecipeRecommendationTransactionTests {
    @Autowired RecipeService recipes;
    @Autowired JdbcTemplate jdbc;
    @Autowired DataSource dataSource;
    @MockitoBean RecommendationService worker;
    @MockitoBean PlatformService platform;
    @MockitoBean org.springframework.web.client.RestTemplate restTemplate;
    UUID user;

    @BeforeEach void setup() {
        jdbc.update("DELETE FROM recipe_favourites");jdbc.update("DELETE FROM recipe_browsing_history");
        jdbc.update("DELETE FROM recipe_disliked");jdbc.update("DELETE FROM user_allergy");
        jdbc.update("DELETE FROM recipe_ingredients");jdbc.update("DELETE FROM recipe_dietary_pref");
        jdbc.update("DELETE FROM recipe_categories");jdbc.update("DELETE FROM recipe_cuisines");
        jdbc.update("DELETE FROM recipe");jdbc.update("DELETE FROM users");
        user=UUID.randomUUID();jdbc.update("INSERT INTO users(id) VALUES(?)",user);
    }
    UUID recipe(String title,int popularity) {
        UUID id=UUID.randomUUID();jdbc.update("INSERT INTO recipe(id,title,description,is_public,view_count) VALUES(?,?,?,true,?)",id,title,"",popularity);return id;
    }
    void withoutConnection() {
        assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
        assertFalse(TransactionSynchronizationManager.hasResource(dataSource));
    }

    @Test void similarRecipesReleaseConnectionDuringInferenceAndRecheckPublicVisibility() {
        UUID withdrawn=recipe("Withdrawn",100),visible=recipe("Visible",1);
        when(worker.recommendByRecipeId(visible,10)).thenAnswer(call->{
            withoutConnection();jdbc.update("UPDATE recipe SET is_public=false WHERE id=?",withdrawn);
            return List.of(withdrawn,visible);
        });
        assertEquals(List.of(visible),recipes.recommendedByRecipeId(visible).getContent().stream().map(RecipeCardDTO::getId).toList());
    }

    @Test void personalizedRankingReleasesConnectionAndRejectsNewDislikeDuringInference() {
        UUID dinner=recipe("Dinner",1);
        when(worker.recommendForUser(anyList(),anyList(),anyList(),anySet(),anyCollection(),eq(100))).thenAnswer(call->{
            withoutConnection();jdbc.update("INSERT INTO recipe_disliked(id,user_id,recipe_id) VALUES(?,?,?)",UUID.randomUUID(),user,dinner);
            return List.of(dinner);
        });
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->recipes.recommendedByUserId(user)).getStatusCode());
    }

    @Test void personalizedRankingRechecksWholeEligibleScopeAndRefillsAfterWithdrawal() {
        UUID withdrawn=recipe("Withdrawn",100),ranked=recipe("Ranked",1),refill=recipe("Refill",5);
        when(worker.recommendForUser(anyList(),anyList(),anyList(),anySet(),anyCollection(),eq(100))).thenAnswer(call->{
            withoutConnection();jdbc.update("UPDATE recipe SET is_public=false WHERE id=?",withdrawn);
            return List.of(withdrawn,ranked);
        });
        assertEquals(List.of(ranked,refill),recipes.recommendedByUserId(user).getContent().stream().map(RecipeCardDTO::getId).toList());
    }
}
