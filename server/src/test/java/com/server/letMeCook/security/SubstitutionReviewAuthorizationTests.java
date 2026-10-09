package com.server.letMeCook.security;

import com.server.letMeCook.controller.SubstitutionReviewController;
import com.server.letMeCook.service.SubstitutionReviewService;
import com.server.letMeCook.service.PlatformService;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(SubstitutionReviewController.class)
@Import(SecurityConfig.class)
class SubstitutionReviewAuthorizationTests {
    @Autowired MockMvc mvc;
    @MockitoBean JwtDecoder decoder;
    @MockitoBean SubstitutionReviewService service;
    @MockitoBean PlatformService platform;
    final UUID adminId=UUID.randomUUID(),rule=UUID.randomUUID();
    Jwt token(String value,Map<String,Object> app,Map<String,Object> editable){return Jwt.withTokenValue(value).header("alg","HS256").subject(adminId.toString()).claim("app_metadata",app).claim("user_metadata",editable).build();}
    String body(){return "{\"version\":3,\"status\":\"approved\",\"reviewNote\":\"Technical QA only\",\"sourceUrl\":\"https://example.test/fixture\"}";}

    @Test void guestsAndOwnerEditorTokensCannotUseAdministrativeReviewRoutes()throws Exception{
        mvc.perform(get("/api/platform/admin/substitutions")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/platform/admin/substitutions/"+rule+"/review").contentType(MediaType.APPLICATION_JSON).content(body())).andExpect(status().isUnauthorized());
        for(String role:List.of("owner","editor")){
            when(decoder.decode(role)).thenReturn(token(role,Map.of("role",role),Map.of()));
            mvc.perform(get("/api/platform/admin/substitutions").header(HttpHeaders.AUTHORIZATION,"Bearer "+role)).andExpect(status().isForbidden());
            mvc.perform(post("/api/platform/admin/substitutions/"+rule+"/review").header(HttpHeaders.AUTHORIZATION,"Bearer "+role).contentType(MediaType.APPLICATION_JSON).content(body())).andExpect(status().isForbidden());
        }
        verifyNoInteractions(service);
    }
    @Test void editableMetadataCannotGrantReviewAuthority()throws Exception{
        when(decoder.decode("forged")).thenReturn(token("forged",Map.of(),Map.of("role","admin")));
        mvc.perform(post("/api/platform/admin/substitutions/"+rule+"/review").header(HttpHeaders.AUTHORIZATION,"Bearer forged").contentType(MediaType.APPLICATION_JSON).content(body())).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }
    @Test void trustedAppMetadataAdministratorUsesVerifiedIdentityAndAuditedEndpoint()throws Exception{
        when(decoder.decode("admin")).thenReturn(token("admin",Map.of("role","admin"),Map.of()));
        when(service.list(any())).thenReturn(Map.of("rules",List.of(),"limit",100,"truncated",false));
        mvc.perform(get("/api/platform/admin/substitutions").header(HttpHeaders.AUTHORIZATION,"Bearer admin")).andExpect(status().isOk()).andExpect(jsonPath("$.limit").value(100));
        when(service.review(eq(rule),anyMap(),any())).thenReturn(Map.of("rule",Map.of("id",rule.toString(),"version",4,"approvalStatus","approved")));
        mvc.perform(post("/api/platform/admin/substitutions/"+rule+"/review").header(HttpHeaders.AUTHORIZATION,"Bearer admin").contentType(MediaType.APPLICATION_JSON).content(body())).andExpect(status().isOk()).andExpect(jsonPath("$.rule.approvalStatus").value("approved"));
        verify(service).review(eq(rule),anyMap(),argThat(jwt->adminId.toString().equals(jwt.getSubject())));
        verify(platform).audit(adminId,"POST","/api/platform/admin/substitutions/"+rule+"/review",200);
    }
}
