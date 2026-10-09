package com.server.letMeCook.service;
import com.server.letMeCook.security.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.*;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class AIRequestControlTests {
    @Test void minimumClientBudgetDoesNotFailImmediatelyBecauseOfHeaderOverhead()throws Exception{
        var control=new AIRequestContext.Control(UUID.randomUUID(),null,token,1000);Thread.sleep(5);var headers=new HttpHeaders();control.headers(headers);assertEquals("1000",headers.getFirst("X-Local-AI-Timeout-Ms"));assertTrue(control.remaining()<1000);assertTrue(control.remaining()>0);
    }
    final String token="x".repeat(43);
    @Test void ownershipRequiresActorAndSecretAndRequestIdsCannotBeStolen(){
        var registry=new AIRequestRegistry();UUID id=UUID.randomUUID(),owner=UUID.randomUUID();var control=new AIRequestContext.Control(id,owner,token,1000);registry.start(control);
        assertThrows(ResponseStatusException.class,()->registry.authorize(id,UUID.randomUUID(),token));assertThrows(ResponseStatusException.class,()->registry.authorize(id,owner,"y".repeat(43)));assertTrue(registry.authorize(id,owner,token).isPresent());
        assertThrows(ResponseStatusException.class,()->registry.start(new AIRequestContext.Control(id,null,"y".repeat(43),1000)));registry.finish(control);assertTrue(registry.authorize(id,owner,token).orElseThrow().finished());
    }
    @Test void anonymousControlsStillRequireAnUnguessableSecret(){
        var registry=new AIRequestRegistry();var control=new AIRequestContext.Control(UUID.randomUUID(),null,token,1000);registry.start(control);assertThrows(ResponseStatusException.class,()->registry.authorize(control.id,null,null));assertThrows(ResponseStatusException.class,()->registry.authorize(control.id,null,"wrong".repeat(9)));assertTrue(registry.authorize(control.id,null,token).isPresent());assertTrue(registry.authorize(UUID.randomUUID(),null,token).isEmpty());
    }
    @Test void remainingDeadlineIsForwardedAndExpiredRequestsFail504(){
        var control=new AIRequestContext.Control(UUID.randomUUID(),null,token,150000);var headers=new HttpHeaders();control.headers(headers);assertEquals(control.id.toString(),headers.getFirst("X-Local-AI-Request-Id"));assertEquals(token,headers.getFirst("X-Local-AI-Cancel-Token"));assertTrue(Integer.parseInt(headers.getFirst("X-Local-AI-Timeout-Ms"))<=150000);
        assertEquals(504,assertThrows(ResponseStatusException.class,()->new AIRequestContext.Control(UUID.randomUUID(),null,token,-1).remaining()).getStatusCode().value());
    }
    @Test void invalidTimeoutTokenAndUuidAreRejectedBeforeAnyInference()throws Exception{
        for(var header:List.of(Map.of("X-Local-AI-Timeout-Ms","999"),Map.of("X-Local-AI-Timeout-Ms","180001"),Map.of("X-Local-AI-Request-Id","not-a-uuid"),Map.of("X-Local-AI-Cancel-Token",token))){var request=new MockHttpServletRequest("POST","/api/ai/search");header.forEach(request::addHeader);var response=new MockHttpServletResponse();new AIRequestControlFilter(new AIRequestRegistry()).doFilter(request,response,(r,s)->fail("Must not call inference"));assertEquals(400,response.getStatus());assertNull(AIRequestContext.current());}
    }
    @Test void contextIsClearedEvenWhenTheHandlerFails()throws Exception{
        var request=new MockHttpServletRequest("POST","/api/ai/search");request.addHeader("X-Local-AI-Request-Id",UUID.randomUUID().toString());request.addHeader("X-Local-AI-Cancel-Token",token);
        assertThrows(IllegalStateException.class,()->new AIRequestControlFilter(new AIRequestRegistry()).doFilter(request,new MockHttpServletResponse(),(r,s)->{assertNotNull(AIRequestContext.current());throw new IllegalStateException("unit");}));assertNull(AIRequestContext.current());
    }
}
