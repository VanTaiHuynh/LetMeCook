package com.server.letMeCook.controller;

import com.server.letMeCook.service.GrowthMemoryService;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/kitchen")
public class GrowthMemoryController {
    private final GrowthMemoryService service;
    public GrowthMemoryController(GrowthMemoryService service){this.service=service;}
    @GetMapping("/taste-feedback") public Map<String,Object> feedback(@RequestParam(required=false)UUID householdId,@AuthenticationPrincipal Jwt jwt){return service.feedback(householdId,jwt);}
    @PutMapping("/sessions/{id}/taste-feedback") public Map<String,Object> feedback(@PathVariable UUID id,@RequestParam(required=false)UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.saveFeedback(householdId,id,body,jwt);}
    @GetMapping("/leftovers") public Map<String,Object> leftovers(@RequestParam(required=false)UUID householdId,@AuthenticationPrincipal Jwt jwt){return service.leftovers(householdId,jwt);}
    @PostMapping("/leftovers") public Map<String,Object> create(@RequestParam(required=false)UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.createLeftover(householdId,body,jwt);}
    @PostMapping("/leftovers/{id}/consume") public Map<String,Object> consume(@PathVariable UUID id,@RequestParam(required=false)UUID householdId,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.consume(householdId,id,body,jwt);}
    @GetMapping("/households/{id}/preference-sharing") public Map<String,Object> sharing(@PathVariable UUID id,@AuthenticationPrincipal Jwt jwt){return service.sharing(id,jwt);}
    @PutMapping("/households/{id}/preference-sharing") public Map<String,Object> sharing(@PathVariable UUID id,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.share(id,body,jwt);}
}
