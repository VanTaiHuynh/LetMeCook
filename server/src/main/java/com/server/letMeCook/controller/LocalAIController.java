package com.server.letMeCook.controller;

import com.server.letMeCook.dto.recipe.RecipeSearchFields;
import com.server.letMeCook.service.LocalAIService;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
public class LocalAIController {
    private final LocalAIService service;
    public LocalAIController(LocalAIService service) { this.service = service; }

    @GetMapping("/api/ai/status")
    public Map<String, Object> status() { return service.status(); }

    @PostMapping("/api/ai/search")
    public Map<String, Object> search(@RequestBody Map<String, Object> body) { return service.search(body); }

    @PostMapping({"/api/ai/vision", "/api/opencv/extract_image_ingredients"})
    public Map<String, Object> vision(@RequestBody Map<String, String> body) { return service.vision(body.get("imageBase64")); }

    // Compatibility for existing Sunny search links; no external model calls.
    @PostMapping("/api/opencv/extract_search_fields")
    public RecipeSearchFields parse(@RequestBody Map<String, String> body) {
        return service.extractRecipeSearchFields(body.get("prompt"));
    }
}
