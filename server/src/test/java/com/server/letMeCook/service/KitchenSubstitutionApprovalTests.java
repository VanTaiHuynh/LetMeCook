package com.server.letMeCook.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.server.letMeCook.repository.KitchenRepository;
import com.server.letMeCook.repository.KitchenRepository.Record;
import com.server.letMeCook.repository.KitchenRepository.Scope;
import com.server.letMeCook.repository.KitchenRepository.Recipe;
import com.server.letMeCook.repository.MealPlanRepository;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;
import static com.server.letMeCook.repository.KitchenRepository.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class KitchenSubstitutionApprovalTests {
    final KitchenRepository repository=mock(KitchenRepository.class);
    final LocalAIService worker=mock(LocalAIService.class);
    final MealPlanRepository profiles=mock(MealPlanRepository.class);
    final PlatformService platform=mock(PlatformService.class);
    final UUID user=UUID.randomUUID(),household=UUID.randomUUID(),recipeId=UUID.randomUUID();
    final Jwt jwt=Jwt.withTokenValue("test").header("alg","HS256").subject(user.toString()).build();
    KitchenService service;
    Record record(Map<String,Object> body){return new Record(UUID.randomUUID(),household,"swap",1,body,user,Instant.now(),Instant.now());}
    @BeforeEach void setup(){
        service=new KitchenService(repository,worker,mock(MealPlanService.class),profiles,new ObjectMapper());service.setPlatformService(platform);
        when(platform.collaborationEnabled()).thenReturn(true);when(repository.records(any(),anyString(),anyInt())).thenReturn(List.of());
        when(repository.access(household,user)).thenReturn(Optional.of(new Scope(household,user,"household","Technical fixture",1,"owner")));
        when(repository.recipe(recipeId,user)).thenReturn(Optional.of(new Recipe(recipeId,user,true,"Technical source rice","Serve.",null,"",2,List.of())));
    }
    @Test void ownerAndEditorCannotForgeCurationStatusOnCreation(){
        for(String role:List.of("owner","editor")){
            when(repository.access(household,user)).thenReturn(Optional.of(new Scope(household,user,"household","Technical fixture",1,role)));
            when(repository.insert(eq(household),eq(user),eq("swap"),anyMap())).thenAnswer(call->record(call.getArgument(3)));
            Map<String,Object> result=service.saveSwap(household,map("fromIngredient","butter","toIngredient","olive oil","ratio",0.8,"sourceUrl","https://example.test/fixture","reviewed",true,"approvalStatus","approved","approvalNote","forged","approvalReviewedBy",user.toString()),jwt);
            assertEquals("pending",result.get("approvalStatus"));assertFalse(result.containsKey("approvalNote"));assertFalse(result.containsKey("approvalReviewedBy"));assertEquals(true,result.get("reviewed"));
        }
        ArgumentCaptor<Map<String,Object>> body=ArgumentCaptor.forClass(Map.class);verify(repository,times(2)).insert(eq(household),eq(user),eq("swap"),body.capture());
        assertTrue(body.getAllValues().stream().allMatch(value->"pending".equals(value.get("approvalStatus"))));verifyNoInteractions(worker);
    }
    @Test void pendingRejectedAndLegacySelfReviewedRulesCannotReachWorkerEvenWithForgedRequestStatus(){
        for(String state:List.of("pending","rejected","legacy")){
            Map<String,Object> body=map("reviewed",true,"fromIngredient","rice","toIngredient","beans","ratio",1);
            if(!state.equals("legacy"))body.put("approvalStatus",state);
            Record swap=record(body);when(repository.record(household,swap.id(),"swap")).thenReturn(Optional.of(swap));
            assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,assertThrows(ResponseStatusException.class,()->service.previewSwap(household,map("recipeId",recipeId.toString(),"swapId",swap.id().toString(),"servings",2,"approvalStatus","approved"),jwt)).getStatusCode());
        }
        verifyNoInteractions(worker,profiles);
    }
}
