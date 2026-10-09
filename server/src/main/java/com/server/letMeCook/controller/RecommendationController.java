package com.server.letMeCook.controller;

import com.server.letMeCook.service.RecommendationService;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/recipes/recommendation")
public class RecommendationController {
    private final RecommendationService recommendationService;
    public RecommendationController(RecommendationService recommendationService){this.recommendationService=recommendationService;}

    @PostMapping({"/embed/update","/pipeline/run"})
    public ResponseEntity<Map<String,Object>> startPipeline(){return recommendationService.startPipeline();}
    @GetMapping("/pipeline/run")
    public ResponseEntity<Map<String,Object>> runLegacyPipeline(){return recommendationService.startPipeline();}
    @GetMapping({"/embed/status","/pipeline/status"})
    public Map<String,Object> pipelineStatus(){return recommendationService.pipelineStatus();}
    @PostMapping("/embed/add")
    public ResponseEntity<Map<String,Object>> addEmbedding(@RequestBody Map<String,Object> body){return recommendationService.addEmbedding(body);}
    @PostMapping("/embed/remove")
    public ResponseEntity<Map<String,Object>> removeEmbedding(@RequestBody Map<String,Object> body){return recommendationService.removeEmbeddings(body);}
    @GetMapping("/cache/info")
    public Map<String,Object> getCacheStatus(){return recommendationService.getCacheInfo();}
}
