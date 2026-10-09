package com.server.letMeCook.security;

import com.server.letMeCook.controller.MealPlanController;
import com.server.letMeCook.service.MealPlanService;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(MealPlanController.class)
@Import(SecurityConfig.class)
class MealPlanAuthorizationTests {
    @MockitoBean private com.server.letMeCook.service.PlatformService platformService;
    @Autowired MockMvc mvc;
    @MockitoBean JwtDecoder decoder;
    @MockitoBean MealPlanService service;

    @Test void onlyGenerateAndRecalculatePostsAllowGuests() throws Exception {
        when(service.generate(anyMap(), isNull())).thenReturn(Map.of("local", true));
        when(service.recalculate(anyMap(), isNull())).thenReturn(Map.of("local", true));
        mvc.perform(post("/api/meal-plans/generate").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/meal-plans/recalculate").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/meal-plans").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/meal-plans").param("weekStart", "2026-10-12")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/meal-plans/preferences")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/meal-plans/generate")).andExpect(status().isUnauthorized());
        verify(service, never()).save(any(), any());
        verify(service, never()).load(any(), any());
        verify(service, never()).preferences(any());
    }

    @Test void optionalJwtIsVerifiedAndPassedAsTheOnlyIdentity() throws Exception {
        UUID owner = UUID.randomUUID();
        when(service.generate(anyMap(), any(Jwt.class))).thenReturn(Map.of("local", true));
        mvc.perform(post("/api/meal-plans/generate").with(jwt().jwt(token -> token.subject(owner.toString())))
                .contentType(MediaType.APPLICATION_JSON).content("{\"userId\":\"another-account\"}"))
                .andExpect(status().isOk());
        verify(service).generate(anyMap(), argThat(token -> owner.toString().equals(token.getSubject())));
        when(decoder.decode("invalid-session")).thenThrow(new BadJwtException("Invalid signature"));
        mvc.perform(post("/api/meal-plans/generate").header("Authorization", "Bearer invalid-session")
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
        verify(service, times(1)).generate(any(), any());
    }
}
