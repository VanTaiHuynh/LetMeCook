package com.server.letMeCook.controller;

import com.server.letMeCook.service.MealPlanService;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/meal-plans")
public class MealPlanController {
    private final MealPlanService service;

    public MealPlanController(MealPlanService service) { this.service = service; }

    @PostMapping("/generate")
    public Map<String, Object> generate(@RequestBody Map<String, Object> request, @AuthenticationPrincipal Jwt jwt) {
        return service.generate(request, jwt);
    }

    @PostMapping("/recalculate")
    public Map<String, Object> recalculate(@RequestBody Map<String, Object> request, @AuthenticationPrincipal Jwt jwt) {
        return service.recalculate(request, jwt);
    }

    @PostMapping("/what-if")
    public Map<String, Object> whatIf(@RequestBody Map<String, Object> request, @AuthenticationPrincipal Jwt jwt) {
        return service.whatIf(request, jwt);
    }

    @PostMapping("/refresh-prices")
    public Map<String, Object> refreshPrices(@RequestBody Map<String, Object> request, @AuthenticationPrincipal Jwt jwt) {
        return service.refreshPrices(request, jwt);
    }

    @PostMapping
    public Map<String, Object> save(@RequestBody Map<String, Object> request, @AuthenticationPrincipal Jwt jwt) {
        return service.save(request, jwt);
    }

    @GetMapping
    public Map<String, Object> load(@RequestParam String weekStart, @AuthenticationPrincipal Jwt jwt) {
        return service.load(weekStart, jwt);
    }

    @GetMapping("/preferences")
    public Map<String, Object> preferences(@AuthenticationPrincipal Jwt jwt) {
        return service.preferences(jwt);
    }
}
