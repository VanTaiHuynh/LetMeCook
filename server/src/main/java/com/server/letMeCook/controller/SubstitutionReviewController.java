package com.server.letMeCook.controller;

import com.server.letMeCook.service.SubstitutionReviewService;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/platform/admin/substitutions")
public class SubstitutionReviewController {
    private final SubstitutionReviewService service;
    public SubstitutionReviewController(SubstitutionReviewService service){this.service=service;}
    @GetMapping public Map<String,Object> list(@AuthenticationPrincipal Jwt jwt){return service.list(jwt);}
    @PostMapping("/{id}/review") public Map<String,Object> review(@PathVariable UUID id,@RequestBody Map<String,Object> input,@AuthenticationPrincipal Jwt jwt){return service.review(id,input,jwt);}
}
