package com.server.letMeCook.service;

import com.server.letMeCook.repository.KitchenRepository;
import com.server.letMeCook.repository.KitchenRepository.Record;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class SubstitutionReviewServiceTests {
    final KitchenRepository repository=mock(KitchenRepository.class);
    final SubstitutionReviewService service=new SubstitutionReviewService(repository);
    final UUID actor=UUID.randomUUID(),scope=UUID.randomUUID(),ruleId=UUID.randomUUID();
    Jwt jwt(boolean admin){return Jwt.withTokenValue("test").header("alg","HS256").subject(actor.toString()).claim("app_metadata",admin?Map.of("role","admin"):Map.of()).claim("user_metadata",Map.of("role","admin")).build();}
    Map<String,Object> declaration(){return new LinkedHashMap<>(Map.of("fromIngredient","butter","toIngredient","olive oil","ratio",0.8,"note","Authored technical fixture; no expert attestation","sourceUrl","https://example.test/declared-source","reviewed",true,"approvalStatus","pending"));}
    Record record(long version,Map<String,Object> body){return new Record(ruleId,scope,"swap",version,body,UUID.randomUUID(),Instant.now(),Instant.now());}
    Map<String,Object> review(){return new LinkedHashMap<>(Map.of("version",3,"status","approved","reviewNote","Technical QA curation only; no expert or pilot claim","sourceUrl","https://example.test/technical-review"));}
    void existing(){Record current=record(3,declaration());when(repository.swapForReview(ruleId)).thenReturn(Optional.of(current));when(repository.record(scope,ruleId,"swap")).thenReturn(Optional.of(current));}

    @Test void editableAdminClaimAndGuestsCannotReadOrApprovePrivateRules(){
        for(Jwt caller:Arrays.asList(null,jwt(false))){
            assertThrows(ResponseStatusException.class,()->service.list(caller));
            assertThrows(ResponseStatusException.class,()->service.review(ruleId,review(),caller));
        }
        verifyNoInteractions(repository);
    }
    @Test void approvalUsesPersistedDeclarationVerifiedReviewerAndExactVersion(){
        existing();Map<String,Object> input=review();input.put("fromIngredient","forged");input.put("ratio",500);input.put("approvalReviewedBy",UUID.randomUUID().toString());
        when(repository.update(eq(scope),eq(ruleId),eq("swap"),eq(3L),anyMap())).thenAnswer(call->Optional.of(record(4,call.getArgument(4))));
        Map<?,?> result=(Map<?,?>)service.review(ruleId,input,jwt(true)).get("rule");
        ArgumentCaptor<Map<String,Object>> saved=ArgumentCaptor.forClass(Map.class);
        verify(repository).update(eq(scope),eq(ruleId),eq("swap"),eq(3L),saved.capture());
        assertEquals("butter",saved.getValue().get("fromIngredient"));assertEquals(0.8,saved.getValue().get("ratio"));
        assertEquals("https://example.test/declared-source",saved.getValue().get("sourceUrl"));
        assertEquals(actor.toString(),saved.getValue().get("approvalReviewedBy"));assertDoesNotThrow(()->Instant.parse((String)saved.getValue().get("approvalReviewedAt")));
        assertEquals("administrator curation; no expert credential attestation",saved.getValue().get("approvalReviewType"));
        assertEquals("approved",result.get("approvalStatus"));assertEquals(4L,result.get("version"));assertEquals(scope.toString(),result.get("scopeId"));
        InOrder locks=inOrder(repository);locks.verify(repository).swapForReview(ruleId);locks.verify(repository).lock(scope);locks.verify(repository).record(scope,ruleId,"swap");
        verify(repository).revise(scope);
    }
    @Test void rejectionIsRecordedSeparatelyFromTheUsersReviewDeclaration(){
        existing();Map<String,Object> input=review();input.put("status","rejected");
        when(repository.update(eq(scope),eq(ruleId),eq("swap"),eq(3L),anyMap())).thenAnswer(call->Optional.of(record(4,call.getArgument(4))));
        Map<?,?> result=(Map<?,?>)service.review(ruleId,input,jwt(true)).get("rule");
        assertEquals(true,result.get("reviewed"));assertEquals("rejected",result.get("approvalStatus"));assertEquals(actor.toString(),result.get("approvalReviewedBy"));
    }
    @Test void staleReviewOrFinalCasRaceCannotSucceed(){
        existing();Map<String,Object> stale=review();stale.put("version",2);
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->service.review(ruleId,stale,jwt(true))).getStatusCode());
        verify(repository,never()).update(any(),any(),anyString(),anyLong(),anyMap());
        when(repository.update(eq(scope),eq(ruleId),eq("swap"),eq(3L),anyMap())).thenReturn(Optional.empty());
        assertEquals(HttpStatus.CONFLICT,assertThrows(ResponseStatusException.class,()->service.review(ruleId,review(),jwt(true))).getStatusCode());
        verify(repository,never()).revise(any());
    }
    @Test void decisionNeedsSourceNoteAndValidVersionBeforeDatabaseRead(){
        for(Map.Entry<String,Object> field:Map.<String,Object>of("version",0,"status","pending","reviewNote"," ","sourceUrl","javascript:alert(1)").entrySet()){
            Map<String,Object> input=review();input.put(field.getKey(),field.getValue());
            assertEquals(HttpStatus.BAD_REQUEST,assertThrows(ResponseStatusException.class,()->service.review(ruleId,input,jwt(true))).getStatusCode());
        }
        Map<String,Object> credentials=review();credentials.put("sourceUrl","https://user:secret@example.test/source");
        assertEquals(HttpStatus.BAD_REQUEST,assertThrows(ResponseStatusException.class,()->service.review(ruleId,credentials,jwt(true))).getStatusCode());
        Map<String,Object> relative=review();relative.put("sourceUrl","/relative/path");
        assertEquals(HttpStatus.BAD_REQUEST,assertThrows(ResponseStatusException.class,()->service.review(ruleId,relative,jwt(true))).getStatusCode());
        verifyNoInteractions(repository);
    }
    @Test void administratorListIsBoundedAndDoesNotExposeOtherKindsOfKitchenData(){
        List<Record> records=new ArrayList<>();for(int index=0;index<101;index++)records.add(record(index+1,declaration()));
        when(repository.swapsForReview(101)).thenReturn(records);
        Map<String,Object> result=service.list(jwt(true));assertEquals(100,((List<?>)result.get("rules")).size());assertEquals(true,result.get("truncated"));
        verify(repository).swapsForReview(101);verify(repository,never()).records(any(),anyString(),anyInt());
    }
}
