package com.server.letMeCook.controller;

import com.server.letMeCook.security.RequestIdentity;
import com.server.letMeCook.service.RecipeFeedbackService;
import java.util.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/recipes")
public class RecipeFeedbackController {
    private final RecipeFeedbackService service;
    public RecipeFeedbackController(RecipeFeedbackService service) { this.service = service; }

    @GetMapping("/feedback/ratings")
    public Map<String, Object> ratings(@RequestParam List<UUID> ids, @AuthenticationPrincipal Jwt jwt) {
        return Map.of("ratings", service.ratings(ids, RequestIdentity.optionalUserId(jwt)));
    }

    @GetMapping("/{recipeId}/feedback/reviews")
    public Map<String, Object> reviews(@PathVariable UUID recipeId,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "12") int size,
            @RequestParam(defaultValue = "recent") String sort, @RequestParam(defaultValue = "desc") String order,
            @AuthenticationPrincipal Jwt jwt) {
        return service.reviews(recipeId, RequestIdentity.optionalUserId(jwt), page, size, sort, order);
    }
}
