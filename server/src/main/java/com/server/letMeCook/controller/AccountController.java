package com.server.letMeCook.controller;
import com.server.letMeCook.service.AccountReadService;
import com.server.letMeCook.security.RequestIdentity;
import com.server.letMeCook.dto.recipe.RecipeCardDTO;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController @RequestMapping("/api/account")
public class AccountController {
    private final AccountReadService service;public AccountController(AccountReadService service){this.service=service;}
    @GetMapping("/profile") public AccountReadService.Profile profile(@AuthenticationPrincipal Jwt jwt){return service.profile(actor(jwt));}
    @GetMapping("/summary") public AccountReadService.Summary summary(@AuthenticationPrincipal Jwt jwt){return service.summary(actor(jwt));}
    @GetMapping("/recipes") public Page<RecipeCardDTO> recipes(@RequestParam(defaultValue="0")int page,@RequestParam(defaultValue="24")int size,@AuthenticationPrincipal Jwt jwt){return service.recipes(actor(jwt),page,size,false);}
    @GetMapping("/favorites") public Page<RecipeCardDTO> favorites(@RequestParam(defaultValue="0")int page,@RequestParam(defaultValue="24")int size,@AuthenticationPrincipal Jwt jwt){return service.recipes(actor(jwt),page,size,true);}
    @GetMapping("/recipes/{id}/state") public AccountReadService.State state(@PathVariable UUID id,@AuthenticationPrincipal Jwt jwt){return service.state(actor(jwt),id);}
    private static UUID actor(Jwt jwt){UUID id=RequestIdentity.optionalUserId(jwt);if(id==null)throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Sign in to view your account.");return id;}
}
