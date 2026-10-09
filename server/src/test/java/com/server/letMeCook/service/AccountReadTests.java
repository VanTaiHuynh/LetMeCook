package com.server.letMeCook.service;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.jdbc.Sql;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@DataJpaTest(properties={"spring.jpa.hibernate.ddl-auto=none","spring.jpa.database-platform=org.hibernate.dialect.H2Dialect","spring.jpa.show-sql=false"})
@Import({AccountReadService.class,com.server.letMeCook.repository.MealPlanRepository.class,com.fasterxml.jackson.databind.ObjectMapper.class}) @Sql("/search-test-schema.sql")
class AccountReadTests {
    @Autowired AccountReadService service;@Autowired JdbcTemplate jdbc;@MockitoBean PlatformService platform;
    UUID owner,other;
    @BeforeEach void setup(){owner=UUID.randomUUID();other=UUID.randomUUID();jdbc.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS user_allergy UUID ARRAY");jdbc.execute("CREATE TABLE IF NOT EXISTS reviews(id UUID PRIMARY KEY,user_id UUID,recipe_id UUID)");jdbc.update("INSERT INTO users(id,first_name,last_name,dietary_pref) VALUES(?,'Test','Owner',ARRAY['Vegetarian'])",owner);jdbc.update("INSERT INTO users(id,first_name,last_name) VALUES(?,'Other','Member')",other);}
    UUID recipe(UUID author,boolean visible){UUID id=UUID.randomUUID();jdbc.update("INSERT INTO recipe(id,title,description,is_public,author_id,created_at) VALUES(?,'Dinner','',?,?,CURRENT_TIMESTAMP)",id,visible,author);return id;}
    void favorite(UUID actor,UUID recipe){jdbc.update("INSERT INTO recipe_favourites(id,user_id,recipe_id,created_at) VALUES(?,?,?,CURRENT_TIMESTAMP)",UUID.randomUUID(),actor,recipe);}
    @Test void profileAllergyPairsKeepIdsAndNamesTogetherIncludingLegacyArray(){UUID a=UUID.randomUUID(),b=UUID.randomUUID();jdbc.update("INSERT INTO ingredients VALUES(?,'peanut')",a);jdbc.update("INSERT INTO ingredients VALUES(?,'milk')",b);jdbc.update("INSERT INTO user_allergy VALUES(?,?)",owner,a);jdbc.update("UPDATE users SET user_allergy=ARRAY[CAST(? AS UUID)] WHERE id=?",b,owner);var result=service.profile(owner);assertEquals("account.v1",result.contractVersion());assertEquals(Set.of(a,b),new HashSet<>(result.allergyIngredientIds()));assertEquals(Set.of("peanut","milk"),new HashSet<>(result.allergyIngredients().stream().map(AccountReadService.AllergyIngredient::name).toList()));assertEquals(owner,result.id());}
    @Test void ownedPrivateRecipesArePagedButOtherPrivateFavoritesAreExcludedBeforeCounts(){UUID own=recipe(owner,false),secret=recipe(other,false),publicId=recipe(other,true);favorite(owner,own);favorite(owner,secret);favorite(owner,publicId);jdbc.update("INSERT INTO reviews VALUES(?,?,?)",UUID.randomUUID(),owner,publicId);var summary=service.summary(owner);assertEquals(1,summary.recipeCount());assertEquals(2,summary.favoriteCount());assertEquals(1,summary.reviewCount());assertEquals(List.of(own),service.recipes(owner,0,24,false).getContent().stream().map(r->r.getId()).toList());assertEquals(2,service.recipes(owner,0,1,true).getTotalElements());assertEquals(1,service.recipes(owner,1,1,true).getContent().size());assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.state(owner,secret));assertTrue(service.state(owner,own).owned());assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.recipes(owner,0,25,false));}
    @Test void demoWithdrawalChangesFavoriteProjectionAndCountTogether(){UUID own=recipe(owner,false),visible=recipe(other,true);favorite(owner,own);favorite(owner,visible);when(platform.publicDemo()).thenReturn(true);assertEquals(1,service.recipes(owner,0,24,true).getTotalElements());assertEquals(1,service.summary(owner).favoriteCount());jdbc.update("UPDATE recipe SET demo_permission_confirmed=true,demo_permission_note='unit declared',image_kind='source',image_url='/recipe-images/unit.jpg' WHERE id=?",visible);assertEquals(2,service.recipes(owner,0,24,true).getTotalElements());jdbc.update("UPDATE recipe SET demo_permission_confirmed=false WHERE id=?",visible);assertEquals(1,service.recipes(owner,0,24,true).getTotalElements());}
}
