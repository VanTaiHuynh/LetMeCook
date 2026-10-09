package com.server.letMeCook.controller;
import com.server.letMeCook.service.PlatformService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
@RestController @RequestMapping("/api/platform")
public class PlatformController {
 private final PlatformService service;
 public PlatformController(PlatformService service){this.service=service;}
 @GetMapping("/image-access") public org.springframework.http.ResponseEntity<Void> image(@RequestHeader(value="X-Original-URI",defaultValue="")String path){service.imageAccess(path.split("\\?",2)[0]);return org.springframework.http.ResponseEntity.noContent().build();}
 @GetMapping("/config") public Map<String,Object> config(){return service.config();}
 @PostMapping("/contact") public Map<String,Object> contact(@RequestBody Map<String,Object> body,HttpServletRequest request){return service.contact(body,request.getRemoteAddr());}
 @PostMapping("/newsletter") public Map<String,Object> subscribe(@RequestBody Map<String,Object> body,HttpServletRequest request){return service.subscribe(body,request.getRemoteAddr());}
 @PostMapping("/newsletter/confirm") public Map<String,Object> confirm(@RequestBody Map<String,Object> body){return service.newsletterToken((String)body.get("token"),false);}
 @PostMapping("/newsletter/unsubscribe") public Map<String,Object> unsubscribe(@RequestBody Map<String,Object> body){return service.newsletterToken((String)body.get("token"),true);}
 @GetMapping("/admin") public Map<String,Object> admin(@AuthenticationPrincipal Jwt jwt){return service.operations(jwt);}
 @PutMapping("/admin/settings") public Map<String,Object> settings(@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.settings(body,jwt);}
 @PatchMapping("/admin/contacts/{id}") public Map<String,Object> contactStatus(@PathVariable UUID id,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.contactStatus(id,body,jwt);}
 @PostMapping("/admin/catalog/{id}") public Map<String,Object> catalog(@PathVariable UUID id,@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.reviewCatalog(id,body,jwt);}
 @PostMapping("/admin/aliases") public Map<String,Object> aliases(@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.alias(body,jwt);}
 @PostMapping("/admin/newsletter") public Map<String,Object> dispatch(@RequestBody Map<String,Object> body,@AuthenticationPrincipal Jwt jwt){return service.dispatch(body,jwt);}
}
