package com.server.letMeCook.controller;
import com.server.letMeCook.service.CreatorStorefrontService;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
@RestController
public class CreatorStorefrontController {
    private final CreatorStorefrontService service;
    public CreatorStorefrontController(CreatorStorefrontService service){this.service=service;}
    @GetMapping("/api/collections/{slug}") public CreatorStorefrontService.Collection collection(@PathVariable String slug){return service.collection(slug);}
    @GetMapping("/api/kitchen/workspace/publication") public CreatorStorefrontService.Settings settings(@RequestParam(required=false)UUID householdId,@AuthenticationPrincipal Jwt jwt){return service.settings(householdId,jwt);}
    @PutMapping("/api/kitchen/workspace/publication") public CreatorStorefrontService.Settings save(@RequestParam(required=false)UUID householdId,@RequestBody CreatorStorefrontService.Change change,@AuthenticationPrincipal Jwt jwt){return service.save(householdId,change,jwt);}
}
