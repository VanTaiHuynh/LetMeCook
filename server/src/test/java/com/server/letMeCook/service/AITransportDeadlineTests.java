package com.server.letMeCook.service;
import com.server.letMeCook.security.AIRequestContext;
import com.server.letMeCook.controller.AIRequestController;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AITransportDeadlineTests {
    @Test void realLoopbackWorkerTransportForwardsControlsAndTimesOutWithinTheRequestBudget()throws Exception{
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);AtomicReference<String> requestId=new AtomicReference<>(),token=new AtomicReference<>();
        server.createContext("/ai/search",exchange->{requestId.set(exchange.getRequestHeaders().getFirst("X-Local-AI-Request-Id"));token.set(exchange.getRequestHeaders().getFirst("X-Local-AI-Cancel-Token"));exchange.getRequestBody().readAllBytes();try{Thread.sleep(2500);}catch(InterruptedException e){Thread.currentThread().interrupt();}try{byte[] response="{\"recipes\":[]}".getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,response.length);exchange.getResponseBody().write(response);}catch(java.io.IOException ignored){}finally{exchange.close();}});server.start();
        var control=new AIRequestContext.Control(UUID.randomUUID(),null,"unit-token-"+"x".repeat(32),1500);AIRequestContext.set(control);long start=System.nanoTime();
        try{var service=new LocalAIService(new RestTemplate(),"http://127.0.0.1:"+server.getAddress().getPort());var error=assertThrows(ResponseStatusException.class,()->service.search(Map.of("prompt","rice")));assertEquals(504,error.getStatusCode().value());assertTrue((System.nanoTime()-start)/1_000_000<4000);assertEquals(control.id.toString(),requestId.get());assertEquals(control.token,token.get());}finally{AIRequestContext.clear();server.stop(0);}
    }
    @Test void cancellationChecksActorSecretAndFreshScopeBeforeForwarding(){
        UUID actor=UUID.randomUUID(),id=UUID.randomUUID(),scope=UUID.randomUUID();String secret="unit-token-"+"x".repeat(32);var registry=new AIRequestRegistry();var control=new AIRequestContext.Control(id,actor,secret,150000);control.scope=scope;registry.start(control);
        var access=mock(KitchenScopeAccess.class);var worker=mock(LocalAIService.class);when(worker.post("/ai/requests/"+id+"/cancel",Map.of("cancelToken",secret))).thenReturn(Map.of("cancelled",true));var endpoint=new AIRequestController(registry,worker,access);Jwt jwt=Jwt.withTokenValue("unit").header("alg","none").subject(actor.toString()).build();
        assertThrows(ResponseStatusException.class,()->endpoint.cancel(id,Map.of("cancelToken",secret),null));verifyNoInteractions(worker);
        assertEquals(true,endpoint.cancel(id,Map.of("cancelToken",secret),jwt).get("cancelled"));verify(access).current(actor,scope);
        reset(worker);when(access.current(actor,scope)).thenThrow(AIRequestContext.failure(403,"Membership revoked"));assertEquals(403,assertThrows(ResponseStatusException.class,()->endpoint.cancel(id,Map.of("cancelToken",secret),jwt)).getStatusCode().value());verifyNoInteractions(worker);
    }
}
