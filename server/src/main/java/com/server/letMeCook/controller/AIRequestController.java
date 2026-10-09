package com.server.letMeCook.controller;
import com.server.letMeCook.service.*;
import com.server.letMeCook.security.RequestIdentity;
import com.server.letMeCook.security.AIRequestContext;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
public class AIRequestController {
    private final AIRequestRegistry registry;private final LocalAIService worker;private final KitchenScopeAccess access;
    public AIRequestController(AIRequestRegistry registry,LocalAIService worker,KitchenScopeAccess access){this.registry=registry;this.worker=worker;this.access=access;}
    @PostMapping("/api/ai/requests/{id}/cancel") public Map<String,Object> cancel(@PathVariable UUID id,@RequestBody Map<String,Object> input,@AuthenticationPrincipal Jwt jwt){
        if(!(input.get("cancelToken") instanceof String token)||input.size()!=1)throw AIRequestContext.failure(400,"Provide this request's cancellation controls.");
        UUID actor=RequestIdentity.optionalUserId(jwt);var job=registry.authorize(id,actor,token);
        if(job.isEmpty()||job.get().finished())return Map.of("cancelled",false);
        if(job.get().scope()!=null)access.current(actor,job.get().scope());
        return worker.post("/ai/requests/"+id+"/cancel",Map.of("cancelToken",token));
    }
}
