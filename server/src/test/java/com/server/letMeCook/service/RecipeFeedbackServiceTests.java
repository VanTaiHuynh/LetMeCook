package com.server.letMeCook.service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

public class RecipeFeedbackServiceTests {
    JdbcTemplate jdbc;
    RecipeFeedbackService service;
    final UUID recipe = new UUID(0, 1), privateRecipe = new UUID(0, 2), owner = new UUID(0, 99);
    public static boolean demoVisible(Boolean approved, String note, String kind, String url) {
        return Boolean.TRUE.equals(approved) && note != null && !note.isBlank() && "source".equals(kind)
            && url != null && url.startsWith("/recipe-images/");
    }
    @BeforeEach void database() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1", "sa", ""));
        jdbc.execute("CREATE ALIAS public.lmc_recipe_demo_visible FOR 'com.server.letMeCook.service.RecipeFeedbackServiceTests.demoVisible'");
        jdbc.execute("CREATE TABLE public.recipe(id uuid primary key, author_id uuid, is_public boolean, demo_permission_confirmed boolean, demo_permission_note varchar, image_kind varchar, image_url varchar)");
        jdbc.execute("CREATE TABLE public.reviews(id uuid primary key,recipe_id uuid,user_id uuid,comment varchar,created_at timestamp with time zone)");
        jdbc.execute("CREATE TABLE public.review_ratings(id uuid primary key,review_id uuid,category varchar,value integer)");
        jdbc.execute("CREATE TABLE public.user_public_profiles(id uuid primary key,first_name varchar,last_name varchar)");
        jdbc.update("INSERT INTO public.user_public_profiles VALUES(?,?,?)", owner, "Fixture", "Reviewer");
        jdbc.update("INSERT INTO public.recipe VALUES(?,?,true,true,'Technical fixture','source','/recipe-images/fixture.jpg')", recipe, owner);
        jdbc.update("INSERT INTO public.recipe VALUES(?,?,false,false,NULL,NULL,NULL)", privateRecipe, owner);
        service = new RecipeFeedbackService(jdbc);
    }
    UUID review(UUID target, int sequence) {
        UUID id = new UUID(1, sequence);
        jdbc.update("INSERT INTO public.reviews VALUES(?,?,?,?,?)", id, target, owner, "Fixture " + sequence,
            Timestamp.from(Instant.parse("2024-01-01T00:00:00Z").plusSeconds(sequence / 5)));
        return id;
    }
    void rating(UUID review, String category, int value) {
        jdbc.update("INSERT INTO public.review_ratings VALUES(?,?,?,?)", UUID.randomUUID(), review, category, value);
    }
    @SuppressWarnings("unchecked") Map<String,Object> summary(Map<String,Object> result, UUID id) { return (Map<String,Object>)result.get(id.toString()); }
    @SuppressWarnings("unchecked") List<Map<String,Object>> content(Map<String,Object> result) { return (List<Map<String,Object>>)result.get("content"); }

    @Test void groupedRatingsKeepFourCategoriesAndDoNotLeakPrivateExistence() {
        UUID first = review(recipe, 1), second = review(recipe, 2);
        rating(first,"cost",1); rating(second,"cost",5); rating(first,"time",4); rating(second,"time",3);
        rating(first,"difficulty",2); rating(first,"overall",5);
        Map<String,Object> result=service.ratings(List.of(recipe,privateRecipe,recipe),null);
        assertEquals(Set.of(recipe.toString()),result.keySet());
        Map<String,Object> summary=summary(result,recipe);
        assertEquals(3.0,summary.get("cost")); assertEquals(3.5,summary.get("time"));
        assertEquals(2.0,summary.get("difficulty")); assertEquals(5.0,summary.get("overall")); assertEquals(1L,summary.get("overallCount"));
    }
    @Test void emptyScoresStayAbsentAndVisibilityUsesOnlyVerifiedOwnerAndCurrentDemoGate() {
        Map<String,Object> empty=summary(service.ratings(List.of(recipe),null),recipe);
        assertNull(empty.get("overall")); assertEquals(0L,empty.get("overallCount"));
        assertTrue(service.ratings(List.of(privateRecipe),null).isEmpty());
        assertTrue(service.ratings(List.of(privateRecipe),new UUID(0,100)).isEmpty());
        assertNotNull(summary(service.ratings(List.of(privateRecipe),owner),privateRecipe));
        assertEquals(404,assertThrows(ResponseStatusException.class,()->service.reviews(privateRecipe,null,0,12,"recent","desc")).getStatusCode().value());
        assertEquals(0L,service.reviews(privateRecipe,owner,0,12,"recent","desc").get("totalElements"));
        jdbc.update("UPDATE public.recipe SET demo_permission_confirmed=false WHERE id=?",recipe);
        assertTrue(service.ratings(List.of(recipe),null).isEmpty());
        assertEquals(404,assertThrows(ResponseStatusException.class,()->service.reviews(recipe,null,0,12,"recent","desc")).getStatusCode().value());
    }
    @Test void moreThanOneThousandReviewsHaveCompleteStableDatabaseOrderingAndBoundedPages() {
        for(int index=0;index<1105;index++) { UUID id=review(recipe,index); rating(id,"overall",index%5+1); }
        List<String> all = new ArrayList<>();
        for(int page=0;page<47;page++) {
            Map<String,Object> result=service.reviews(recipe,null,page,24,"recent","desc");
            assertEquals(1105L,result.get("totalElements")); assertTrue(content(result).size()<=24);
            content(result).forEach(item->all.add((String)item.get("id")));
        }
        assertEquals(1105,all.size()); assertEquals(1105,new HashSet<>(all).size());
        for(int index=0;index<1105;index++)assertEquals(new UUID(1,1104-index).toString(),all.get(index));
        List<Map<String,Object>> top=content(service.reviews(recipe,null,0,12,"rating","desc"));
        assertEquals(new UUID(1,1104).toString(),top.get(0).get("id"));
        assertEquals(new UUID(1,1099).toString(),top.get(1).get("id"));
        List<Map<String,Object>> lowest=content(service.reviews(recipe,null,0,12,"rating","asc"));
        assertEquals(new UUID(1,0).toString(),lowest.get(0).get("id"));
        assertEquals(new UUID(1,5).toString(),lowest.get(1).get("id"));
        assertFalse(content(service.reviews(recipe,null,84,12,"recent","desc")).isEmpty());
    }
    @Test void boundsAndSortWhitelistFailBeforeAnyUnboundedRead() {
        assertEquals(400,assertThrows(ResponseStatusException.class,()->service.ratings(Collections.nCopies(101,recipe),null)).getStatusCode().value());
        assertThrows(ResponseStatusException.class,()->service.ratings(Collections.singletonList(null),null));
        assertThrows(ResponseStatusException.class,()->service.reviews(recipe,null,0,25,"recent","desc"));
        assertThrows(ResponseStatusException.class,()->service.reviews(recipe,null,0,12,"rating;DROP TABLE reviews","desc"));
        assertThrows(ResponseStatusException.class,()->service.reviews(recipe,null,0,12,"recent","desc;DROP"));
        UUID large = review(recipe, 0);
        jdbc.update("UPDATE public.reviews SET comment=? WHERE id=?", "c".repeat(5000), large);
        jdbc.update("UPDATE public.user_public_profiles SET first_name=? WHERE id=?", "n".repeat(200), owner);
        Map<String,Object> item = content(service.reviews(recipe,null,0,12,"recent","desc")).get(0);
        assertEquals(3000, ((String)item.get("comment")).length());
        @SuppressWarnings("unchecked") Map<String,Object> name = (Map<String,Object>)item.get("user");
        assertEquals(80, ((String)name.get("first_name")).length());
    }
}
