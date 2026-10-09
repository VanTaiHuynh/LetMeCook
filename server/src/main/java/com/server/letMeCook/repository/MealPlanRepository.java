package com.server.letMeCook.repository;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Array;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Every account query includes the verified owner, including when the DB role bypasses RLS. */
@Repository
@Transactional(readOnly = true)
public class MealPlanRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    @org.springframework.beans.factory.annotation.Autowired
    private com.server.letMeCook.service.PlatformService platformService;

    private String demoFilter(String alias) {
        if (platformService == null || !platformService.publicDemo()) return "";
        return " AND " + alias + ".demo_permission_confirmed=true AND length(trim(coalesce(" + alias
                + ".demo_permission_note,'')))>0 AND " + alias + ".image_kind='source' AND "
                + alias + ".image_url LIKE '/recipe-images/%'";
    }

    public record SavedPlan(UUID id, UUID userId, LocalDate weekStart, int version,
                            Instant updatedAt, Map<String, Object> plan) { }

    public MealPlanRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public Map<String, Object> restrictionPreferences(UUID owner) {
        List<String> diets = new ArrayList<>();
        Set<UUID> allergyIds = new LinkedHashSet<>();
        jdbc.query("SELECT dietary_pref, user_allergy FROM public.users WHERE id = ?", rs -> {
            for (Object diet : arrayValues(rs.getArray("dietary_pref"))) {
                if (diet != null && !diet.toString().isBlank()) diets.add(diet.toString().trim());
            }
            for (Object id : arrayValues(rs.getArray("user_allergy"))) {
                if (id != null) allergyIds.add(UUID.fromString(id.toString()));
            }
        }, owner);
        Set<String> allergies = new LinkedHashSet<>(jdbc.queryForList(
                "SELECT DISTINCT i.name FROM public.user_allergy a JOIN public.ingredients i ON i.id = a.ingredient_id WHERE a.user_id = ? ORDER BY i.name",
                String.class, owner));
        if (!allergyIds.isEmpty()) {
            String placeholders = String.join(",", Collections.nCopies(allergyIds.size(), "?"));
            allergies.addAll(jdbc.queryForList("SELECT name FROM public.ingredients WHERE id IN (" + placeholders + ") ORDER BY name",
                    String.class, allergyIds.toArray()));
        }
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("dietaryPreferences", new ArrayList<>(new LinkedHashSet<>(diets)));
        context.put("allergies", new ArrayList<>(allergies));
        return context;
    }
    public Map<String,Object> preferences(UUID owner){
        Map<String,Object> context=new LinkedHashMap<>(restrictionPreferences(owner));
        context.put("favoriteRecipeIds", jdbc.queryForList(
                "SELECT f.recipe_id FROM public.recipe_favourites f JOIN public.recipe r ON r.id = f.recipe_id WHERE f.user_id = ? AND r.is_public = true" + demoFilter("r") + " ORDER BY f.created_at DESC,f.recipe_id LIMIT 100",
                UUID.class, owner).stream().map(UUID::toString).toList());
        context.put("dislikedRecipeIds", jdbc.queryForList(
                "SELECT recipe_id FROM public.recipe_disliked WHERE user_id = ? ORDER BY recipe_id",
                UUID.class, owner).stream().map(UUID::toString).toList());
        context.put("usedProfile", true);
        return context;
    }

    private static Object[] arrayValues(Array array) throws java.sql.SQLException {
        if (array == null) return new Object[0];
        try { return (Object[]) array.getArray(); } finally { array.free(); }
    }

    public Set<UUID> publicRecipeIds(Set<UUID> ids) {
        if (ids.isEmpty()) return Set.of();
        String placeholders = String.join(",", Collections.nCopies(ids.size(), "?"));
        return new HashSet<>(jdbc.queryForList(
                "SELECT r.id FROM public.recipe r WHERE r.is_public = true" + demoFilter("r") + " AND r.id IN (" + placeholders + ")", UUID.class, ids.toArray()));
    }

    public Optional<SavedPlan> find(UUID owner, LocalDate weekStart) {
        return jdbc.query("SELECT id, user_id, week_start, version, updated_at, plan FROM public.weekly_meal_plans WHERE user_id = ? AND week_start = ?",
                (rs, index) -> {
                    try {
                        return new SavedPlan(rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
                                rs.getDate("week_start").toLocalDate(), rs.getInt("version"), rs.getTimestamp("updated_at").toInstant(),
                                mapper.readValue(rs.getString("plan"), new TypeReference<Map<String, Object>>() { }));
                    } catch (java.io.IOException error) {
                        throw new IllegalStateException("Saved meal plan is not a JSON object", error);
                    }
                }, owner, java.sql.Date.valueOf(weekStart)).stream().findFirst();
    }

    @Transactional
    public SavedPlan save(UUID owner, LocalDate weekStart, int expectedVersion, Map<String, Object> canonicalPlan) {
        String json;
        try { json = mapper.writeValueAsString(canonicalPlan); }
        catch (java.io.IOException error) { throw new IllegalArgumentException("Meal plan could not be serialized", error); }
        if (json.length() > 1_000_000) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Meal plan is too large to save.");
        Instant now = Instant.now();
        if (expectedVersion == 0) {
            try {
                jdbc.update("INSERT INTO public.weekly_meal_plans(id, user_id, week_start, plan, version, created_at, updated_at) VALUES (?, ?, ?, CAST(? AS jsonb), 1, ?, ?)",
                        UUID.randomUUID(), owner, java.sql.Date.valueOf(weekStart), json, Timestamp.from(now), Timestamp.from(now));
            } catch (DuplicateKeyException error) { throw conflict(); }
        } else {
            int updated = jdbc.update("UPDATE public.weekly_meal_plans SET plan = CAST(? AS jsonb), version = version + 1, updated_at = ? WHERE user_id = ? AND week_start = ? AND version = ?",
                    json, Timestamp.from(now), owner, java.sql.Date.valueOf(weekStart), expectedVersion);
            if (updated != 1) throw conflict();
        }
        return find(owner, weekStart).orElseThrow(() -> new IllegalStateException("Saved plan is missing"));
    }

    public static ResponseStatusException conflict() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "This week has changed. Load the latest saved plan before saving again.");
    }
}
