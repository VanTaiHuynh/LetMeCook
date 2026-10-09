package com.server.letMeCook.controller;

import com.server.letMeCook.service.RecipeDislikedService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import com.server.letMeCook.security.RequestIdentity;

import java.util.UUID;

@RestController
@RequestMapping("/api/dislikes")
@RequiredArgsConstructor
public class RecipeDislikedController {

    private final RecipeDislikedService service;

    @PostMapping
    public ResponseEntity<String> dislikeRecipe(
            @RequestParam UUID userId,
            @RequestParam UUID recipeId,
            @AuthenticationPrincipal Jwt jwt
    ) {
        service.addDislike(RequestIdentity.requireOwner(jwt, userId), recipeId);
        return ResponseEntity.ok("Disliked successfully.");
    }
}
