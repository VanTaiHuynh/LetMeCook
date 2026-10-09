package com.server.letMeCook.security;

import com.server.letMeCook.controller.PublicCookingController;
import com.server.letMeCook.service.PublicCookingService;
import com.server.letMeCook.service.PlatformService;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(PublicCookingController.class)
@Import(SecurityConfig.class)
class PublicCookingAuthorizationTests {
    @Autowired MockMvc mvc;@MockitoBean JwtDecoder decoder;@MockitoBean PublicCookingService service;@MockitoBean PlatformService platform;
    @Test void guestCookingCapabilitiesAreAnonymousAndPrivateSessionRoutesRemainProtected()throws Exception{
        String base="/api/public/cook/recipes/"+UUID.randomUUID();mvc.perform(get(base)).andExpect(status().isOk());
        for(String action:new String[]{"ask","speak","timer-cue","transcribe"})mvc.perform(post(base+"/"+action).contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isOk());
        mvc.perform(post(base+"/complete").contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/kitchen/sessions/"+UUID.randomUUID())).andExpect(status().isUnauthorized());
    }
}
