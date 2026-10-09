package com.server.letMeCook.controller;

import java.util.Map;
import java.util.LinkedHashMap;
import com.server.letMeCook.security.RequestIdentity;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.server.letMeCook.model.User;
import com.server.letMeCook.repository.UserRepository;

@RestController
@RequestMapping("/api")
public class ProfileController {

    @Autowired
    private UserRepository userRepository;

    @GetMapping("/profile")
    public ResponseEntity<?> getProfile(@AuthenticationPrincipal Jwt jwt) {
        User user = userRepository.findById(RequestIdentity.optionalUserId(jwt)).orElse(null);

        if (user == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(Map.of("error", "User not found"));
        }

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("full_name", user.getFirstName() + " " + user.getLastName());
        response.put("email", user.getEmail());
        response.put("cooking_skill", user.getCookingLvl());
        response.put("dietary_preg", user.getDietaryPref()); // Keep the existing client contract.
        response.put("dietary_pref", user.getDietaryPref());
        response.put("about_me", user.getAboutMe());
        response.put("image_url", user.getImageUrl());
        
        return ResponseEntity.ok(response);
    }
    
}
