package com.server.letMeCook.service;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.repository.KitchenRepository;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;
class CreatorStorefrontServiceTests {
    JdbcTemplate jdbc;KitchenRepository repository;KitchenScopeAccess access;UUID owner=UUID.randomUUID(),scope=UUID.randomUUID();Jwt jwt;
    @BeforeEach void setup(){jdbc=mock(JdbcTemplate.class);repository=mock(KitchenRepository.class);access=mock(KitchenScopeAccess.class);jwt=Jwt.withTokenValue("test").header("alg","HS256").subject(owner.toString()).build();var own=new KitchenRepository.Scope(scope,owner,"personal","My kitchen",1,"owner");when(access.require(owner,null,KitchenScopeAccess.Access.OWNER_WRITE)).thenReturn(own);when(repository.personal(owner)).thenReturn(own);when(access.current(owner,scope)).thenReturn(own);}
    CreatorStorefrontService service(boolean enabled){return new CreatorStorefrontService(jdbc,new ObjectMapper(),repository,access,enabled);}
    @Test void disabledPublicReadDoesNotQueryAnyPrivateTables(){assertEquals(404,assertThrows(ResponseStatusException.class,()->service(false).collection("test-kitchen")).getStatusCode().value());verifyNoInteractions(jdbc,repository,access);}
    @Test void malformedPublicSlugDoesNotProbeDatabase(){for(String slug:List.of("../private","test?scope=secret","creator","A kitchen"))assertEquals(404,assertThrows(ResponseStatusException.class,()->service(true).collection(slug)).getStatusCode().value());verifyNoInteractions(jdbc);}
    @Test void anonymousOwnerEndpointRejectedBeforeAccessOrDatabase(){assertEquals(401,assertThrows(ResponseStatusException.class,()->service(true).settings(null,null)).getStatusCode().value());verifyNoInteractions(jdbc,repository,access);}
    @Test void staleVersionCannotOverwritePublication(){when(jdbc.query(anyString(),any(RowMapper.class),eq(scope))).thenReturn(List.of(new CreatorStorefrontService.Publication("test-kitchen",false,2)));assertEquals(409,assertThrows(ResponseStatusException.class,()->service(true).save(null,new CreatorStorefrontService.Change("test-kitchen",true,1L,true),jwt)).getStatusCode().value());verify(jdbc,never()).update(anyString(),any(Object[].class));}
    @Test void ownerCannotPublishWhenOperatorFlagDisabled(){when(jdbc.query(anyString(),any(RowMapper.class),eq(scope))).thenReturn(List.of());assertEquals(503,assertThrows(ResponseStatusException.class,()->service(false).save(null,new CreatorStorefrontService.Change("test-kitchen",true,0L,true),jwt)).getStatusCode().value());verify(repository,never()).records(any(),anyString(),anyInt());}
    @Test void publishingNeedsExplicitAcknowledgment(){when(jdbc.query(anyString(),any(RowMapper.class),eq(scope))).thenReturn(List.of());assertEquals(400,assertThrows(ResponseStatusException.class,()->service(true).save(null,new CreatorStorefrontService.Change("test-kitchen",true,0L,false),jwt)).getStatusCode().value());verify(repository,never()).records(any(),anyString(),anyInt());}
    @Test void unpublishingRemainsAvailableWithFeatureDisabled(){when(jdbc.query(anyString(),any(RowMapper.class),eq(scope))).thenReturn(List.of(new CreatorStorefrontService.Publication("test-kitchen",true,1)),List.of(new CreatorStorefrontService.Publication("test-kitchen",false,2)));when(jdbc.update(anyString(),eq("test-kitchen"),eq(false),eq(scope),eq(1L))).thenReturn(1);var result=service(false).save(null,new CreatorStorefrontService.Change("test-kitchen",false,1L,false),jwt);assertFalse(result.published());assertNull(result.collectionUrl());assertEquals(2,result.version());verify(access).current(owner,scope);verify(access,never()).require(any(),any(),any());}
    @Test void formerOwnerCannotUnpublishAfterRoleChangesWhileWaiting(){when(access.current(owner,scope)).thenReturn(new KitchenRepository.Scope(scope,UUID.randomUUID(),"household","Other kitchen",1,"viewer"));assertEquals(403,assertThrows(ResponseStatusException.class,()->service(false).save(null,new CreatorStorefrontService.Change("test-kitchen",false,1L,false),jwt)).getStatusCode().value());verifyNoInteractions(jdbc);}
    @Test void revokedRecipesProduce404AfterFreshRead(){when(jdbc.queryForList(anyString(),eq("test-kitchen"))).thenReturn(List.of(Map.of("scope_id",scope,"workspace","{\"name\":\"Test\"}")));when(jdbc.query(anyString(),any(RowMapper.class),eq(scope))).thenReturn(List.of());assertEquals(404,assertThrows(ResponseStatusException.class,()->service(true).collection("test-kitchen")).getStatusCode().value());verify(jdbc).query(contains("r.is_public AND r.demo_permission_confirmed"),any(RowMapper.class),eq(scope));}
}
