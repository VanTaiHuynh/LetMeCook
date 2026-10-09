package com.server.letMeCook.service;

import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class RecipeFeedbackService {
    private final JdbcTemplate jdbc;
    private static final String VISIBLE = "(r.author_id=? OR (r.is_public=true AND public.lmc_recipe_demo_visible(r.demo_permission_confirmed,r.demo_permission_note,r.image_kind,r.image_url)))";
    private static final List<String> CATEGORIES = List.of("cost", "time", "difficulty", "overall");

    public RecipeFeedbackService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Transactional(readOnly = true)
    public Map<String, Object> ratings(List<UUID> ids, UUID owner) {
        if (ids == null || ids.isEmpty() || ids.size() > 100 || ids.stream().anyMatch(Objects::isNull))
            throw bad("Choose between 1 and 100 recipes.");
        List<UUID> unique = ids.stream().distinct().toList();
        List<Object> arguments = new ArrayList<>(unique);
        arguments.add(owner);
        String slots = String.join(",", Collections.nCopies(unique.size(), "?"));
        String query = "SELECT r.id, v.category, avg(v.value) AS average, count(v.id) AS rating_count "
            + "FROM public.recipe r LEFT JOIN public.reviews w ON w.recipe_id=r.id "
            + "LEFT JOIN public.review_ratings v ON v.review_id=w.id AND v.value BETWEEN 1 AND 5 "
            + "WHERE r.id IN (" + slots + ") AND " + VISIBLE + " GROUP BY r.id,v.category";
        Map<String, Object> result = new LinkedHashMap<>();
        jdbc.query(query, rs -> {
            String id = rs.getString("id");
            @SuppressWarnings("unchecked")
            Map<String, Object> summary = (Map<String, Object>) result.computeIfAbsent(id, ignored -> emptyRating());
            String category = rs.getString("category");
            if (category != null && CATEGORIES.contains(category)) {
                summary.put(category, rs.getDouble("average"));
                if (category.equals("overall")) summary.put("overallCount", rs.getLong("rating_count"));
            }
        }, arguments.toArray());
        return result;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> reviews(UUID recipeId, UUID owner, int page, int size, String sort, String order) {
        if (recipeId == null || page < 0 || page > 100000 || size < 1 || size > 24
                || sort == null || order == null
                || !Set.of("recent", "rating").contains(sort) || !Set.of("asc", "desc").contains(order))
            throw bad("Choose a valid review page and sort order.");
        Long visible = jdbc.queryForObject("SELECT count(*) FROM public.recipe r WHERE r.id=? AND " + VISIBLE,
            Long.class, recipeId, owner);
        if (visible == null || visible == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Recipe not found.");
        Long total = jdbc.queryForObject("SELECT count(*) FROM public.reviews w JOIN public.recipe r ON r.id=w.recipe_id WHERE r.id=? AND " + VISIBLE,
            Long.class, recipeId, owner);
        String direction = order.equals("asc") ? "ASC" : "DESC";
        String ordered = sort.equals("rating") ? "overall_rating " + direction + ", " : "";
        ordered += "w.created_at " + direction + ", w.id " + direction;
        String query = "SELECT w.id,left(w.comment,3000) AS comment,w.created_at, "
            + "left(u.first_name,80) AS first_name,left(u.last_name,80) AS last_name, "
            + "avg(CASE WHEN v.category='cost' THEN v.value END) AS cost_rating, "
            + "avg(CASE WHEN v.category='time' THEN v.value END) AS time_rating, "
            + "avg(CASE WHEN v.category='difficulty' THEN v.value END) AS difficulty_rating, "
            + "coalesce(avg(CASE WHEN v.category='overall' THEN v.value END),0) AS overall_rating "
            + "FROM public.reviews w JOIN public.recipe r ON r.id=w.recipe_id "
            + "LEFT JOIN public.user_public_profiles u ON u.id=w.user_id "
            + "LEFT JOIN public.review_ratings v ON v.review_id=w.id AND v.value BETWEEN 1 AND 5 "
            + "WHERE r.id=? AND " + VISIBLE
            + " GROUP BY w.id,w.comment,w.created_at,u.first_name,u.last_name ORDER BY " + ordered + " LIMIT ? OFFSET ?";
        List<Map<String, Object>> content = jdbc.query(query, (rs, row) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", rs.getString("id")); item.put("comment", rs.getString("comment"));
            item.put("created_at", rs.getTimestamp("created_at").toInstant().toString());
            Map<String, Object> user = new LinkedHashMap<>();
            user.put("first_name", rs.getString("first_name")); user.put("last_name", rs.getString("last_name"));
            item.put("user", user);
            List<Map<String, Object>> values = new ArrayList<>();
            for (String category : CATEGORIES) {
                Number value = (Number) rs.getObject(category + "_rating");
                if (value != null && value.doubleValue() >= 1 && value.doubleValue() <= 5)
                    values.add(Map.of("category", category, "value", value.doubleValue()));
            }
            item.put("review_ratings", values);
            return item;
        }, recipeId, owner, size, (long) page * size);
        long count = total == null ? 0 : total;
        return Map.of("content", content, "page", page, "size", size, "totalElements", count,
            "totalPages", (count + size - 1) / size);
    }

    private static Map<String, Object> emptyRating() {
        Map<String, Object> result = new LinkedHashMap<>();
        CATEGORIES.forEach(category -> result.put(category, null));
        result.put("overallCount", 0L);
        return result;
    }
    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
