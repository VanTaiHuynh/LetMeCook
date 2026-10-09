package com.server.letMeCook.controller;

import com.server.letMeCook.service.PublicCookingService;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/public/cook/recipes/{id}")
public class PublicCookingController {
    private final PublicCookingService service;
    public PublicCookingController(PublicCookingService service){this.service=service;}
    @GetMapping public Map<String,Object> recipe(@PathVariable UUID id){return service.recipe(id);}
    @PostMapping("/ask") public Map<String,Object> ask(@PathVariable UUID id,@RequestBody Map<String,Object> body){return service.ask(id,body);}
    @PostMapping("/speak") public Map<String,Object> speak(@PathVariable UUID id,@RequestBody Map<String,Object> body){return service.speak(id,body);}
    @PostMapping("/timer-cue") public Map<String,Object> timerCue(@PathVariable UUID id,@RequestBody Map<String,Object> body){return service.timerCue(id,body);}
    @PostMapping("/transcribe") public Map<String,Object> transcribe(@PathVariable UUID id,@RequestBody Map<String,Object> body){return service.transcribe(id,body);}
}
