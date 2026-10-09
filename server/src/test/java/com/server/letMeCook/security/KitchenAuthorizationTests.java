package com.server.letMeCook.security;

import com.server.letMeCook.controller.KitchenController;
import com.server.letMeCook.service.KitchenService;
import com.server.letMeCook.service.PlatformService;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(KitchenController.class)
@Import(SecurityConfig.class)
class KitchenAuthorizationTests {
    @Autowired MockMvc mvc;
    @MockitoBean JwtDecoder decoder;
    @MockitoBean KitchenService service;
    @MockitoBean PlatformService platform;
    @BeforeEach void config(){when(platform.config()).thenReturn(Map.of("kitchenEnabled",true,"voiceEnabled",true,"publicDemo",false));}
    @Test void allKitchenReadWriteAndVoiceRoutesRequireAuthentication()throws Exception{
        for(String path:new String[]{"/api/kitchen/bootstrap","/api/kitchen/shopping","/api/kitchen/evidence","/api/kitchen/evidence/export","/api/kitchen/ledger"})mvc.perform(get(path)).andExpect(status().isUnauthorized());
        for(String path:new String[]{"/api/kitchen/pantry","/api/kitchen/suggestions","/api/kitchen/coverage","/api/kitchen/voice/transcribe","/api/kitchen/voice/speak","/api/kitchen/households","/api/kitchen/invites/accept","/api/kitchen/cohorts/enroll","/api/kitchen/cohorts/"+UUID.randomUUID()+"/withdraw"})mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isUnauthorized());
        mvc.perform(put("/api/kitchen/shopping").contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isUnauthorized());verifyNoInteractions(service);
    }
    @Test void controllerUsesVerifiedSubjectAndExplicitHouseholdScope()throws Exception{
        UUID user=UUID.randomUUID(),scope=UUID.randomUUID();when(service.bootstrap(eq(scope),any())).thenReturn(Map.of("scope",Map.of("name","Test")));
        mvc.perform(get("/api/kitchen/bootstrap").param("householdId",scope.toString()).param("userId",UUID.randomUUID().toString()).with(jwt().jwt(token->token.subject(user.toString())))).andExpect(status().isOk());
        verify(service).bootstrap(eq(scope),argThat(token->user.toString().equals(token.getSubject())));
    }
    @Test void mutationAcceptsBodyScopeButRejectsConflictingScopeSelectors()throws Exception{
        UUID user=UUID.randomUUID(),scope=UUID.randomUUID();when(service.savePantry(eq(scope),isNull(),anyMap(),any())).thenReturn(Map.of("id",UUID.randomUUID().toString(),"version",1));
        String body="{\"householdId\":\""+scope+"\",\"userId\":\"someone-else\"}";
        mvc.perform(post("/api/kitchen/pantry").contentType(MediaType.APPLICATION_JSON).content(body).with(jwt().jwt(token->token.subject(user.toString())))).andExpect(status().isOk());
        verify(service).savePantry(eq(scope),isNull(),anyMap(),argThat(token->user.toString().equals(token.getSubject())));
        mvc.perform(post("/api/kitchen/pantry").param("householdId",UUID.randomUUID().toString()).contentType(MediaType.APPLICATION_JSON).content(body).with(jwt().jwt(token->token.subject(user.toString())))).andExpect(status().isBadRequest());
        verify(service,times(1)).savePantry(any(),any(),any(),any());
    }
    @Test void evidenceExportIgnoresCallerUserAndHouseholdSelectors()throws Exception{
        UUID user=UUID.randomUUID();when(service.exportEvidence(any())).thenReturn(Map.of("retentionDays",90,"events",java.util.List.of()));
        mvc.perform(get("/api/kitchen/evidence/export").param("userId",UUID.randomUUID().toString()).param("householdId",UUID.randomUUID().toString()).with(jwt().jwt(token->token.subject(user.toString())))).andExpect(status().isOk());
        verify(service).exportEvidence(argThat(token->user.toString().equals(token.getSubject())));verify(service,never()).bootstrap(any(),any());
    }
    @Test void namedCohortRoutesUseVerifiedSubjectAndRejectMismatchedScope()throws Exception{
        UUID user=UUID.randomUUID(),scope=UUID.randomUUID(),enrollment=UUID.randomUUID();String body="{\"householdId\":\""+scope+"\",\"cohortName\":\"Pilot\",\"confirmed\":true}";
        when(service.enrollCohort(eq(scope),anyMap(),any())).thenReturn(Map.of("cohort",Map.of("id",enrollment.toString())));
        mvc.perform(post("/api/kitchen/cohorts/enroll").contentType(MediaType.APPLICATION_JSON).content(body).with(jwt().jwt(token->token.subject(user.toString())))).andExpect(status().isOk());
        verify(service).enrollCohort(eq(scope),anyMap(),argThat(token->user.toString().equals(token.getSubject())));
        mvc.perform(post("/api/kitchen/cohorts/"+enrollment+"/withdraw").param("householdId",UUID.randomUUID().toString()).contentType(MediaType.APPLICATION_JSON).content(body).with(jwt().jwt(token->token.subject(user.toString())))).andExpect(status().isBadRequest());verify(service,never()).withdrawCohort(any(),any(),anyMap(),any());
        when(service.evidence(eq(scope),eq("Pilot"),any())).thenReturn(Map.of("fixedCohort",Map.of("reason","notMature")));
        mvc.perform(get("/api/kitchen/evidence").param("householdId",scope.toString()).param("cohortName","Pilot").with(jwt().jwt(token->token.subject(user.toString())))).andExpect(status().isOk());verify(service).evidence(eq(scope),eq("Pilot"),argThat(token->user.toString().equals(token.getSubject())));
    }
}
