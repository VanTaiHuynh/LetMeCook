package com.server.letMeCook.controller;

import com.server.letMeCook.service.ReadinessService;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/health")
public class ReadinessController {
    private final ReadinessService readiness;
    public ReadinessController(ReadinessService readiness) { this.readiness = readiness; }

    @GetMapping("/live")
    public Map<String, Object> live() { return Map.of("status", "alive", "local", true); }

    @GetMapping("/ready")
    public ResponseEntity<?> ready() { return response(readiness.database()); }

    @GetMapping("/ai")
    public ResponseEntity<?> ai(@RequestParam(defaultValue = "recommendation") String capability) {
        try { return response(readiness.ai(capability)); }
        catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(Map.of("error", "Choose a supported AI capability."));
        }
    }

    private ResponseEntity<?> response(ReadinessService.Result result) {
        return ResponseEntity.status(result.ready() ? 200 : 503)
                .body(Map.of("status", result.ready() ? "ready" : "unavailable", "checks", result.checks(), "local", true));
    }
}
