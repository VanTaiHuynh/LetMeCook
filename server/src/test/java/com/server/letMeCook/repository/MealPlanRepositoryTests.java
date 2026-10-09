package com.server.letMeCook.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

/** Database-backed ownership and competing-write tests. Production RLS is verified separately in PostgreSQL. */
class MealPlanRepositoryTests {
    private JdbcTemplate jdbc;
    private MealPlanRepository repository;
    private final UUID owner = UUID.randomUUID();
    private final UUID other = UUID.randomUUID();
    private final LocalDate week = LocalDate.of(2026, 10, 12);

    @BeforeEach void setup() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource("jdbc:h2:mem:plans_" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", ""));
        jdbc.execute("CREATE TABLE public.weekly_meal_plans (id uuid PRIMARY KEY, user_id uuid NOT NULL, week_start date NOT NULL, plan jsonb NOT NULL, version integer NOT NULL, created_at timestamp NOT NULL, updated_at timestamp NOT NULL, UNIQUE(user_id, week_start))");
        // H2 encodes JDBC text casts as a JSON string; unwrap only in this test adapter.
        ObjectMapper h2Mapper = new ObjectMapper() {
            @Override public <T> T readValue(String content, TypeReference<T> type) throws JsonProcessingException {
                JsonNode value = readTree(content);
                return super.readValue(value.isTextual() ? value.asText() : content, type);
            }
        };
        repository = new MealPlanRepository(jdbc, h2Mapper);
    }

    private Map<String, Object> plan(String marker) { return Map.of("weekStart", week.toString(), "meals", List.of(), "checkedItems", List.of(), "marker", marker); }

    @Test void sameWeekIsIsolatedByOwnerAndWrongOwnerCannotOverwrite() {
        repository.save(owner, week, 0, plan("owner"));
        assertTrue(repository.find(other, week).isEmpty());
        assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class, () -> repository.save(other, week, 1, plan("intrusion"))).getStatusCode());
        repository.save(other, week, 0, plan("other"));
        assertEquals("owner", repository.find(owner, week).orElseThrow().plan().get("marker"));
        assertEquals("other", repository.find(other, week).orElseThrow().plan().get("marker"));
        assertNotEquals(repository.find(owner, week).orElseThrow().id(), repository.find(other, week).orElseThrow().id());
    }

    @Test void competingVersionUpdatesAllowOneWriterAndRejectTheStaleWriter() throws Exception {
        repository.save(owner, week, 0, plan("original"));
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService threads = Executors.newFixedThreadPool(2);
        try {
            List<Future<String>> results = new ArrayList<>();
            for (String marker : List.of("first", "second")) results.add(threads.submit(() -> {
                ready.countDown(); assertTrue(start.await(5, TimeUnit.SECONDS));
                try { repository.save(owner, week, 1, plan(marker)); return "saved"; }
                catch (ResponseStatusException error) { assertEquals(HttpStatus.CONFLICT, error.getStatusCode()); return "conflict"; }
            }));
            assertTrue(ready.await(5, TimeUnit.SECONDS)); start.countDown();
            List<String> outcomes = List.of(results.get(0).get(10, TimeUnit.SECONDS), results.get(1).get(10, TimeUnit.SECONDS));
            assertEquals(1, Collections.frequency(outcomes, "saved"));
            assertEquals(1, Collections.frequency(outcomes, "conflict"));
            assertEquals(2, repository.find(owner, week).orElseThrow().version());
            assertEquals(HttpStatus.CONFLICT, assertThrows(ResponseStatusException.class, () -> repository.save(owner, week, 0, plan("replacement"))).getStatusCode());
        } finally { start.countDown(); threads.shutdownNow(); }
    }

    @Test void profileArraysAndNormalizedAllergiesAreMergedOnlyForCurrentOwner() {
        jdbc.execute("CREATE TABLE public.users(id uuid PRIMARY KEY, dietary_pref varchar ARRAY, user_allergy uuid ARRAY)");
        jdbc.execute("CREATE TABLE public.ingredients(id uuid PRIMARY KEY, name varchar)");
        jdbc.execute("CREATE TABLE public.user_allergy(user_id uuid, ingredient_id uuid)");
        jdbc.execute("CREATE TABLE public.recipe(id uuid PRIMARY KEY, is_public boolean)");
        jdbc.execute("CREATE TABLE public.recipe_favourites(user_id uuid, recipe_id uuid,created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP)");
        jdbc.execute("CREATE TABLE public.recipe_disliked(user_id uuid, recipe_id uuid)");
        UUID peanut = UUID.randomUUID(), egg = UUID.randomUUID(), favorite = UUID.randomUUID(), foreignFavorite = UUID.randomUUID(), dislike = UUID.randomUUID();
        jdbc.update("INSERT INTO public.ingredients VALUES (?, ?), (?, ?)", peanut, "peanut", egg, "egg");
        jdbc.update("INSERT INTO public.users VALUES (?, ARRAY['Vegetarian'], ARRAY[CAST(? AS uuid)]), (?, ARRAY['Vegan'], ARRAY[CAST(? AS uuid)])", owner, peanut, other, egg);
        jdbc.update("INSERT INTO public.user_allergy VALUES (?, ?)", owner, egg);
        jdbc.update("INSERT INTO public.recipe VALUES (?, true), (?, true)", favorite, foreignFavorite);
        jdbc.update("INSERT INTO public.recipe_favourites(user_id,recipe_id) VALUES (?, ?), (?, ?)", owner, favorite, other, foreignFavorite);
        jdbc.update("INSERT INTO public.recipe_disliked VALUES (?, ?), (?, ?)", owner, dislike, other, foreignFavorite);
        Map<String, Object> profile = repository.preferences(owner);
        assertEquals(List.of("Vegetarian"), profile.get("dietaryPreferences"));
        assertEquals(Set.of("egg", "peanut"), new HashSet<>((List<String>) profile.get("allergies")));
        assertEquals(List.of(favorite.toString()), profile.get("favoriteRecipeIds"));
        assertEquals(List.of(dislike.toString()), profile.get("dislikedRecipeIds"));
        for(int i=0;i<150;i++){UUID id=UUID.randomUUID();jdbc.update("INSERT INTO public.recipe VALUES(?,true)",id);jdbc.update("INSERT INTO public.recipe_favourites(user_id,recipe_id) VALUES(?,?)",owner,id);}
        assertEquals(100,((List<?>)repository.preferences(owner).get("favoriteRecipeIds")).size());
    }
}
